// Going over today's amount (6 November 2026): Today shows it negative, and says what each day is from tomorrow,
// worked out again from what's left until payday. Before, it said only "You have spent €57 of €50".
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const E = await import("../js/engine.js");
const { overLine } = await import("../js/now.js");

const TODAY = "2027-03-10", PAYDAY = "2027-03-25";   // 15 days, today included
const model = (txs = []) => ({
  settings: { monthStart: 1, startDate: "2027-03-01", startBalance: 750 },
  income: [{ id: "sal", name: "Salary", amount: 2000, frequency: "monthly", payDay: 25, active: true, missed: [] }],
  bills: [], goals: [], lists: [], items: [], reminders: [], categories: [{ id: "fun", name: "Fun" }],
  transactions: txs,
});
const spend = (amount, date = TODAY, id = "t" + amount) => ({ id, date, amount, kind: "expense", categoryId: "fun" });

test("over today: left is negative by what went over", () => {
  const D = E.dayShare(model([spend(80)]), TODAY);
  assert.equal(D.share, 5000, "€750 over 15 days");
  assert.equal(D.left, -3000);
});
test("over today: tomorrow's amount is what's left shared over the days after today", () => {
  const D = E.dayShare(model([spend(80)]), TODAY);
  assert.equal(D.tomorrow, Math.round((75000 - 8000) / 14));   // €47.86 a day, down from €50
  assert.ok(D.tomorrow < D.share);
});
test("the amount promised for tomorrow is the one Koti gives tomorrow", () => {
  const m = model([spend(80)]), today = E.dayShare(m, TODAY), tomorrow = E.dayShare(m, E.addDays(TODAY, 1));
  assert.equal(tomorrow.share, today.tomorrow);
});
test("under today's share, tomorrow's amount grows", () => {
  const D = E.dayShare(model([spend(20)]), TODAY);
  assert.ok(D.left > 0 && D.tomorrow > D.share);
});
test("payday tomorrow: no amount for tomorrow (the pay sets it)", () => {
  assert.equal(E.dayShare(model([spend(80, "2027-03-24", "late")]), "2027-03-24").tomorrow, null);
});

test("what Today says", () => {
  const L = { left: 670 };
  assert.equal(overLine({ left: 12, spent: 38, share: 50, tomorrow: 50.86 }, L), "You have spent €38 of €50");
  assert.equal(overLine({ left: -30, spent: 80, share: 50, tomorrow: 47.86 }, L), "€30 over today. From tomorrow, €48 a day instead of €50.");
  assert.equal(overLine({ left: -30, spent: 80, share: 50, tomorrow: null }, L), "€30 over today. Payday is tomorrow.");
  assert.equal(overLine({ left: -30, spent: 80, share: 50, tomorrow: 0 }, { left: -40 }), "€30 over today. You're €40 over until payday, so there's nothing to spend each day until then.");
});
