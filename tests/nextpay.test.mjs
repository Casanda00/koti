// "I paid €11 for lunch from my upcoming salary" (6 November 2026). Before this, the AI dropped "from my upcoming
// salary" and the €11 came off today's money as if it had already left the account. Now the expense keeps the day it
// was bought (Spent and the Eating out budget count it then), and the balance counts it on the payday it comes out of.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const E = await import("../js/engine.js");
const { parseExpense, NEXT_PAY } = await import("../js/voice.js");

const TODAY = "2027-03-10", PAYDAY = "2027-03-25";
const model = (txs = []) => ({
  settings: { monthStart: 1, startDate: "2027-03-01", startBalance: 500 },
  income: [{ id: "sal", name: "Salary", amount: 2000, frequency: "monthly", payDay: 25, active: true, missed: [] }],
  bills: [], goals: [], lists: [], items: [], reminders: [],
  categories: [{ id: "eat", name: "Eating out", budget: 200 }],
  transactions: txs,
});
const lunch = (extra = {}) => ({ id: "tx1", date: TODAY, amount: 11, kind: "expense", categoryId: "eat", payee: null, note: "lunch", ...extra });

test("today's money doesn't drop when it comes out of the next pay", () => {
  const before = E.state(model(), TODAY), plain = E.state(model([lunch()]), TODAY), later = E.state(model([lunch({ fromPay: PAYDAY })]), TODAY);
  assert.equal(plain.left, before.left - 1100, "an ordinary expense comes off today's money");
  assert.equal(later.left, before.left, "from the next pay: today's money stays as it is");
  assert.equal(later.now, before.now, "and the account balance too");
  assert.equal(later.owedSum, 1100);
  assert.deepEqual(later.owed.map(t => t.id), ["tx1"]);
});

test("today's share isn't spent by it either", () => {
  const before = E.dayShare(model(), TODAY), later = E.dayShare(model([lunch({ fromPay: PAYDAY })]), TODAY), plain = E.dayShare(model([lunch()]), TODAY);
  assert.equal(later.left, before.left);
  assert.equal(later.spent, 0);
  assert.equal(plain.spent, 1100, "an ordinary expense is spent today");
});

test("it still counts in Spent and the category on the day it was bought", () => {
  const S = E.spending(model([lunch({ fromPay: PAYDAY })]), "2027-03-01", "2027-03-31");
  assert.equal(S.byCat.eat, 1100);
  assert.equal(S.byDay[TODAY], 1100);
});

test("the balance counts it on payday, so the next pay starts that much lower", () => {
  const m = model([lunch({ fromPay: PAYDAY })]), plain = model([lunch()]);
  assert.equal(E.balanceAt(m, "2027-03-24"), E.balanceAt(model(), "2027-03-24"), "not before payday");
  assert.equal(E.balanceAt(m, PAYDAY), E.balanceAt(plain, PAYDAY), "on payday it has left, like any other expense");
  const after = E.state(m, "2027-03-26");
  assert.equal(after.owedSum, 0, "nothing is waiting once the pay has come");
});

test("the plan for next month starts lower by what is waiting for the pay", () => {
  const april = E.periodOf("2027-04-05", 1);
  assert.equal(E.month(model([lunch({ fromPay: PAYDAY })]), april, TODAY).start, E.month(model(), april, TODAY).start - 1100);
});

test("only an expense dated before its payday counts this way", () => {
  assert.equal(E.fromNextPay(lunch({ fromPay: PAYDAY })), true);
  assert.equal(E.fromNextPay(lunch({ fromPay: TODAY })), false, "not on the day itself");
  assert.equal(E.fromNextPay(lunch({ kind: "refund", fromPay: PAYDAY })), false);
  assert.equal(E.moneyDay(lunch({ fromPay: PAYDAY })), PAYDAY);
});

test("the phone's own rules spot it", () => {
  const cats = [{ id: "eat", name: "Eating out" }];
  for (const t of ["I paid 11e from my upcoming salary for lunch", "lunch 12 from next pay", "borrowed 30 until payday", "maksoin 20 seuraavasta palkasta", "Lidl 30 from my next salary"]) assert.ok(NEXT_PAY.test(t), t);
  // The owner's rule (6 November 2026): said where it came from, it isn't today's money. "From my salary" counts, upcoming or not.
  for (const t of ["paid 11 from my salary", "maksoin 20 palkasta"]) assert.ok(NEXT_PAY.test(t), t);
  for (const t of ["Lidl 23,40", "salary came, lunch 10", "paid 11 by card for lunch"]) assert.ok(!NEXT_PAY.test(t), t);
  const h = parseExpense("I paid 11e from my upcoming salary for lunch", { categories: cats });
  assert.equal(h.amount, 11); assert.equal(h.fromNextPay, true); assert.equal(h.payee, null, "the salary isn't the shop");
  const n = parseExpense("lunch 12 from next pay", { categories: cats });
  assert.equal(n.amount, 12); assert.equal(n.fromNextPay, true);
  assert.ok(!/pay/i.test(n.note || ""), `the note is what it was, not when it's paid: ${n.note}`);
  assert.equal(parseExpense("Lidl 23,40", { categories: cats }).fromNextPay, false);
});

test("the AI is asked for it, and told the payday", () => {
  const src = readFileSync(new URL("../supabase/functions/hear/index.ts", import.meta.url), "utf8");
  assert.match(src, /"from_next_pay"/);
  assert.match(src, /Their next payday:/);
  assert.match(src, /fromNextPay: s\.from_next_pay === true/);
  const client = readFileSync(new URL("../js/hear.js", import.meta.url), "utf8");
  assert.match(client, /nextPay: \(nextPay\(store\.model, todayISO\(\)\)/);
});

test("it is stored and synced", () => {
  const sync = readFileSync(new URL("../js/sync.js", import.meta.url), "utf8");
  assert.match(sync, /fromPay: r\.from_pay/); assert.match(sync, /from_pay: t\.fromPay/);
});

// The morning and evening messages read the database themselves: without from_pay they would count next-pay spending
// today, and say money is tighter than the app does.
test("the reminders read it from the database the way the app does", async () => {
  const R = await import("../supabase/functions/send-reminders/reminders.js");
  const m = R.modelOf({ tx: [{ id: "tx1", date: "2027-03-10", amount: "11.00", kind: "expense", category_id: "eat", from_pay: "2027-03-25" }] });
  assert.equal(m.transactions[0].fromPay, "2027-03-25");
  const idx = readFileSync(new URL("../supabase/functions/send-reminders/index.ts", import.meta.url), "utf8");
  assert.match(idx, /transactions\?select=[^`]*\bfrom_pay\b/, "the column is fetched");
});
