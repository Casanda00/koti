// Pinned figures: what Koti calculates today for a set of households, each worked out by hand in the comment
// above it. These are the baseline for moving every money sum into one engine (Phase 1 of the architecture
// review): a figure that changes there must change here too, in the same pull request, with the reason.
// Where today's figure is known to be wrong, the test says so and pins it anyway, so the fix is seen.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2027-03-10");   // a Wednesday
const A = await app();
const { store } = A, S = store.model;
const { payDateFor, LAST_WORKING_DAY } = await import("../js/paydays.js");
const { dayShare } = await import("../js/receipt.js");
const { spentBetween } = await import("../js/spent.js");
const P = () => A.money.periodFor(new Date());
const L = () => A.monthLedger(P());
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const reset = (bal = 1000, start = "2027-03-01") => {
  setToday("2027-03-10");
  Object.assign(S.settings, { startBalance: bal, startDate: start, monthStart: 1, rollover: false });
  S.bills = []; S.transactions = []; S.goals = []; S.income = []; S.items = []; S.lists = [];
  S.categories = [{ id: "cat-groceries", name: "Groceries", budget: 400, position: 0 }, { id: "cat-shopping", name: "Shopping", budget: 150, position: 1 }];
};
const salary = (payDay = 25, amount = 2400) => ({ id: "sal", name: "Salary", amount, frequency: "monthly", payDay, active: true, missed: [], position: 0 });
const bill = (id, amount, dueDay, extra = {}) => ({ id, name: id, amount, frequency: "monthly", dueDay, anchorMonth: 1, active: true, autopay: false, dues: {}, position: 0, ...extra });
const tx = (id, date, amount, categoryId, extra = {}) => ({ id, date, amount, kind: "expense", categoryId, payee: id, ...extra });

/* Spec §20.9, "Can I afford €500?". Balance €2,000; €1,000 rent due on the 20th, before payday on the 25th;
   a €300-a-month savings plan not yet moved. Left until payday = 2000 − 1000 − 300 = €700, so €500 fits and
   leaves €200. The spec also has a €500 minimum reserve: Koti has no such setting, so it does not count here. */
test("§20.9 can I afford €500: €700 left, so yes, with €200 to spare", () => {
  reset(2000);
  S.income = [salary()];
  S.bills = [bill("rent", 1000, 20)];
  S.goals = [{ id: "g", name: "Buffer", target: 3000, saved: 0, monthly: 300, position: 0 }];
  const l = L();
  assert.equal(l.now, 2000);
  assert.equal(l.due, 1000);
  assert.equal(l.savingsDue, 300);
  assert.equal(l.left, 700);
  assert.equal(l.until, "2027-03-24", "money has to last until the day before payday");
  assert.equal(l.left - 500, 200);
});

/* Spending: a €50 receipt split into €30 of food and a €15 lamp, the €5 not itemised staying with the receipt's
   own category (groceries); a €10 refund in shopping; €100 moved to savings and a +€20 bank correction, neither
   of which is spending. Groceries 30 + 5 = 35, shopping 15 − 10 = 5, total 40.
   Balance: 1000 − 50 + 10 − 100 + 20 = 880. */
test("receipt lines, refunds, savings and corrections", () => {
  reset(1000);
  S.transactions = [
    tx("r1", "2027-03-05", 50, "cat-groceries", { lines: [{ name: "Food", price: 30, categoryId: "cat-groceries" }, { name: "Lamp", price: 15, categoryId: "cat-shopping" }] }),
    { ...tx("ref", "2027-03-06", 10, "cat-shopping"), kind: "refund" },
    tx("sav", "2027-03-07", 100, "savings"),
    { ...tx("adj", "2027-03-08", 20, "adjust"), kind: "income" },
  ];
  const t = A.money.totals(P());
  assert.equal(t.byCat["cat-groceries"], 35);
  assert.equal(t.byCat["cat-shopping"], 5);
  assert.equal(t.spend, 40);
  assert.equal(spentBetween("2027-03-01", "2027-03-10").total, 40, "the Spent screen agrees");
  const l = L();
  assert.equal(l.now, 880);
  assert.equal(l.saved, 100);
  assert.equal(l.adjust, 20);
});

/* Roll over: Groceries has €400 a month. February spent €450, so March starts €50 short: €350. With roll over off,
   it stays €400. */
test("budget roll over carries overspending into the next month", () => {
  reset(1000, "2027-02-01");
  S.transactions = [tx("feb", "2027-02-10", 450, "cat-groceries")];
  assert.equal(A.effectiveBudgets(P()).byId["cat-groceries"], 400);
  S.settings.rollover = true;
  assert.equal(A.effectiveBudgets(P()).byId["cat-groceries"], 350);
  assert.equal(A.effectiveBudgets(P()).byId["cat-shopping"], 300, "an unspent €150 carries over too");
});

/* Paydays move to the working day before a weekend or a Finnish public holiday. */
test("paydays: weekends, Good Friday, Midsummer Eve, the last working day", () => {
  const day = (pd, y, m) => iso(payDateFor(pd, y, m));
  assert.equal(day(25, 2027, 8), "2027-09-24", "Saturday 25 September → Friday");
  assert.equal(day(26, 2027, 2), "2027-03-25", "Good Friday 26 March → Thursday");
  assert.equal(day(25, 2027, 5), "2027-06-24", "Midsummer Eve 25 June → Thursday");
  assert.equal(day(LAST_WORKING_DAY, 2027, 11), "2027-12-31", "31 December 2027 is a Friday");
  assert.equal(day(LAST_WORKING_DAY, 2027, 9), "2027-10-29", "31 October 2027 is a Sunday");
  assert.equal(day(31, 2027, 1), "2027-02-26", "the 31st in February 2027 is Sunday the 28th → Friday 26th");
});

/* Today's share. Balance €1,000, nothing owed, payday on the 25th: 15 days away. €20 spent today on food.
   This morning there was 1000 left; 1000 ÷ 15 = 66.67 a day; 66.67 − 20 = 46.67 left today. */
test("today's share of what's left until payday", () => {
  reset(1000);
  S.income = [salary()];
  S.transactions = [tx("lunch", "2027-03-10", 20, "cat-groceries")];
  const D = dayShare();
  assert.equal(D.days, 15);
  assert.equal(D.morning, 1000);
  assert.equal(Math.round(D.share * 100) / 100, 66.67);
  assert.equal(Math.round(D.left * 100) / 100, 46.67);
});

/* A direct debit due on the 5th: from that day it waits for "It went out". Until then the €40 is still set aside;
   "It didn't" keeps it owed; "It went out" records the payment, which lowers the balance instead. */
test("a direct debit stays set aside until it is confirmed", () => {
  reset(1000);
  S.income = [salary()];
  S.bills = [bill("gym", 40, 5, { autopay: true })];
  let o = L().dueThisMonth[0];
  assert.equal(A.plan.awaitingDebit(o), true);
  assert.equal(L().left, 960);
  A.plan.setFailed(o);
  o = L().dueThisMonth[0];
  assert.equal(A.plan.awaitingDebit(o), false);
  assert.equal(L().left, 960, "a failed debit is still owed");
  A.plan.markPaid(o);
  assert.equal(L().dueThisMonth.length, 0);
  assert.equal(L().now, 960);
  assert.equal(L().left, 960);
});

/* "Income" means two things today. The ledger counts only what has arrived (€0 before payday); the month total
   also counts this month's expected salary (€2,400). Pinned so the engine has to choose one name for each. */
test("KNOWN: income received and income expected share one word", () => {
  reset(1000);
  S.income = [salary()];
  assert.equal(L().income, 0);
  assert.equal(A.money.totals(P()).income, 2400);
});

/* Floating point. Two purchases of €0.10 and €0.20 are €0.30 of spending. Until the screens moved onto the engine
   (Phase 1, step 3) the sum was done in floats and came out as 0.30000000000000004; it is exact now. */
test("money is added up in whole cents: €0.10 + €0.20 is €0.30", () => {
  reset(1000);
  S.transactions = [tx("a", "2027-03-02", 0.1, "cat-groceries"), tx("b", "2027-03-03", 0.2, "cat-groceries")];
  assert.equal(A.money.totals(P()).spend, 0.3);
  assert.equal(L().now, 999.7);
});
