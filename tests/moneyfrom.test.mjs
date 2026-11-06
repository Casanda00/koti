// The owner's rule (6 November 2026): when someone says where the money came from, it isn't taken from today's
// money; when they don't, it is. Pay or salary, upcoming or not, comes out of the next pay (tests/nextpay.test.mjs);
// savings come out of a savings goal. And Koti doesn't say "your money stays as it is": it says where it came from.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const E = await import("../js/engine.js");
const { parseExpense, NEXT_PAY, FROM_SAVINGS } = await import("../js/voice.js");
const C = await import("../js/composer.js");
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const TODAY = "2027-03-10";
const model = (txs = []) => ({
  settings: { monthStart: 1, startDate: "2027-03-01", startBalance: 500 },
  income: [{ id: "sal", name: "Salary", amount: 2000, frequency: "monthly", payDay: 25, active: true, missed: [] }],
  bills: [], lists: [], items: [], reminders: [],
  goals: [{ id: "trip", name: "Holiday fund", target: 1000, saved: 300, monthly: 100 }],
  categories: [{ id: "fun", name: "Fun", budget: 200 }],
  transactions: txs,
});
const shoes = { id: "tx1", date: TODAY, amount: 60, kind: "expense", categoryId: "fun", note: "shoes" };
const fromTrip = { id: "sav:trip:spend-tx1", date: TODAY, amount: 60, kind: "income", categoryId: E.SAVINGS_CAT, payee: "Holiday fund", note: "For shoes" };

test("from savings: today's money doesn't drop, the goal does", () => {
  const before = E.state(model(), TODAY), after = E.state(model([shoes, fromTrip]), TODAY);
  assert.equal(after.now, before.now, "the balance");
  assert.equal(after.left, before.left, "left until payday");
  assert.equal(E.goalSaved(model([shoes, fromTrip]), model().goals[0]), 30000 - 6000, "the Holiday fund");
});
test("from savings: this month's savings plan doesn't ask for it back", () => {
  const plain = { ...fromTrip, id: "sav:trip:t-1" };   // "Taken from savings" by hand is different: the plan still wants its €100
  assert.equal(E.state(model([shoes, fromTrip]), TODAY).savingsDue, E.state(model(), TODAY).savingsDue);
  assert.ok(E.state(model([plain]), TODAY).savingsDue > E.state(model(), TODAY).savingsDue);
});
test("from savings: it still counts as spending on fun", () => {
  assert.equal(E.spending(model([shoes, fromTrip]), "2027-03-01", "2027-03-31").byCat.fun, 6000);
});
test("not said: today's money", () => {
  assert.equal(E.state(model([shoes]), TODAY).left, E.state(model(), TODAY).left - 6000);
});

test("the phone's rules hear where it came from", () => {
  const h = s => parseExpense(s, { categories: [] });
  assert.equal(h("paid 11 from my salary for lunch").fromNextPay, true);
  assert.equal(h("maksoin 20 palkasta").fromNextPay, true);
  assert.equal(h("shoes 60 from my savings").fromSavings, true);
  assert.equal(h("flight 120 out of the holiday fund").fromSavings, true);
  assert.equal(h("kahvi 4 säästöistä").fromSavings, true);
  for (const t of ["Lidl 23,40", "paid 11 by card for lunch"]) { assert.equal(h(t).fromNextPay, false, t); assert.equal(h(t).fromSavings, false, t); }
  assert.equal(h("shoes 60 from my savings").note, "shoes", "the note is what it was");
  assert.ok(NEXT_PAY.test("from my salary") && FROM_SAVINGS.test("from my savings"));
});

test("the sentence says where it came from, and never that the money stays as it is", () => {
  assert.equal(C.localReply({ amount: 60, date: TODAY, note: "shoes", categoryId: "fun", goalName: "Holiday fund" }, [{ id: "fun", name: "Fun" }]), "€60.00 for shoes, today, from Holiday fund.");
  assert.match(C.localReply({ amount: 11, date: TODAY, note: "lunch", categoryId: "fun", fromPay: "2027-03-25" }, [{ id: "fun", name: "Fun" }]), /^€11\.00 for lunch, today, from your pay on Thursday 25 March\.$/);
  for (const f of ["js/composer.js", "js/money.js", "js/talk.js"]) assert.doesNotMatch(read(f), /stays? as it is/i, f);
  assert.match(read("supabase/functions/hear/index.ts"), /Never say their money "stays as it is"/);
});

test("the AI is asked where it came from, with the person's goals", () => {
  const src = read("supabase/functions/hear/index.ts");
  assert.match(src, /"from_next_pay", "from_savings", "goal"/);
  assert.match(src, /whether or not they say upcoming or next: "from my salary"/);
  assert.match(src, /Their savings goals:/);
  assert.match(read("js/hear.js"), /goals: store\.model\.goals\.map\(g => g\.name\)/);
});

test("from savings: today's share isn't spent by it either", () => {
  const before = E.dayShare(model(), TODAY), after = E.dayShare(model([shoes, fromTrip]), TODAY);
  assert.equal(after.left, before.left);
  assert.equal(after.spent, 0);
});
