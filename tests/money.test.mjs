// What's yours to spend: the bills, debts, payments and savings that are set aside before payday.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-26");
const A = await app();
const { store } = A, S = store.model;
const L = () => A.monthLedger(A.money.periodFor(new Date()));
const reset = (bal = 1000, start = "2026-11-01") => { S.settings.startBalance = bal; S.settings.startDate = start; S.settings.monthStart = 1; S.bills = []; S.transactions = []; S.goals = []; S.income = []; };

test("rent due after the budget month but before payday is set aside (FIN-1)", () => {
  reset(1150);
  S.income = [{ id: "sal", name: "Salary", amount: 2400, frequency: "monthly", payDay: 25, active: true, missed: [], position: 0 }];
  S.bills = [{ id: "rent", name: "Rent", amount: 850, frequency: "monthly", dueDay: 1, anchorMonth: 1, active: true, autopay: false, dues: {}, position: 0 }];
  S.transactions = [{ id: "bill:rent:2026-11-01", date: "2026-11-01", amount: 850, kind: "expense", categoryId: "cat-bills", billId: "rent", billDue: "2026-11-01" },
                    { id: "inc:sal:2026-11-25", date: "2026-11-25", amount: 2400, kind: "income", incomeId: "sal", incomeDue: "2026-11-25" }];
  const l = L();
  assert.equal(l.now, 2700);
  assert.equal(l.left, 1850, "December's rent is reserved");
});

test("an unpaid bill older than 12 months still counts (FIN-3)", () => {
  setToday("2027-03-10"); reset(1000, "2025-01-01");
  S.bills = [{ id: "fine", name: "Parking fine", amount: 80, frequency: "once", dueDate: "2025-02-15", dueDay: 15, anchorMonth: 2, active: true, dues: {}, position: 0 },
             { id: "tv", name: "TV licence", amount: 100, frequency: "once", dueDate: "2026-12-15", dueDay: 15, anchorMonth: 12, active: true, dues: {}, position: 1 }];
  assert.equal(L().due, 180);
});

test("pausing a bill doesn't erase what it already owes (FIN-5)", () => {
  setToday("2027-03-10"); reset(1000, "2027-02-01");
  S.bills = [{ id: "ph", name: "Phone", amount: 30, frequency: "monthly", dueDay: 5, anchorMonth: 1, active: false, dues: {}, position: 0, startDate: "2027-02-01" }];
  assert.equal(A.overdueBills().length, 1, "February is still owed");
  assert.equal(L().due, 60, "February and 5 March, both gone by");
});

test("a payment dated later isn't in the account yet, but is set aside (FIN-4)", () => {
  setToday("2027-03-10"); reset(1000, "2027-03-01");
  S.transactions = [{ id: "fut", date: "2027-03-28", amount: 500, kind: "expense", categoryId: "cat-shopping" }];
  const l = L();
  assert.equal(l.now, 1000);
  assert.equal(l.left, 500);
});

test("this month's savings plan is set aside until the money is moved (FIN-7)", () => {
  setToday("2027-03-10"); reset(1000, "2027-03-01");
  S.goals = [{ id: "g", name: "Rainy day", target: 1000, saved: 0, monthly: 200, position: 0 }];
  assert.equal(L().left, 800);
  store.put("transactions", { id: "sav1", date: "2027-03-10", amount: 200, kind: "expense", categoryId: "savings", payee: "Rainy day" });
  const l = L();
  assert.equal(l.now, 800, "moving it lowers the account");
  assert.equal(l.left, 800, "and the reserve is used, not counted twice");
  assert.equal(A.money.totals(A.money.periodFor(new Date())).spend, 0, "it isn't spending");
});

test("bill dates: the 31st, February and leap years", () => {
  const b31 = { id: "b31", name: "Loan", amount: 100, frequency: "monthly", dueDay: 31, anchorMonth: 1, active: true, dues: {} };
  S.bills = [b31];
  const dues = (y, m) => A.plan.occurrences(A.money.periodFor(new Date(y, m, 10))).map(o => o.due);
  assert.deepEqual(dues(2027, 1), ["2027-02-28"]);
  assert.deepEqual(dues(2028, 1), ["2028-02-29"]);
  assert.deepEqual(dues(2027, 3), ["2027-04-30"]);
});
