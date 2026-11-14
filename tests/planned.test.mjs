// "Remind me to pay…" (the owner, 14 November 2026): something to pay on a day ahead is a bill only when it repeats.
// A one-off payment is planned for its day in its own category: set aside until then, spending in that category on
// the day (not out of that day's share), with a reminder. A bill's reminder belongs to the bill.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-14");
const { store } = await app();
const A = await import("../supabase/functions/koti/agent.js");
const E = await import("../js/engine.js");
const B = await import("../js/brain.js");
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const TODAY = "2026-11-14";
const M = A.modelFromRows({ settings: { monthStart: 1, startDate: "2026-11-01", startBalance: 1000 },
  income: [{ id: "sal", name: "Salary", amount: 3100, frequency: "monthly", pay_day: 30, active: true, missed: [] }],
  cats: [{ id: "fun", name: "Fun", budget: null }] });

test("plan_payment: an amount, a day after today and one of their categories", () => {
  const ok = A.action(M, TODAY, "plan_payment", { what: "Concert tickets", amount: 80, date: "2026-11-20", category: "Fun", note: "Two tickets", remind_days_before: 1 });
  assert.deepEqual(ok, { type: "payment", payee: "Concert tickets", amount: 80, date: "2026-11-20", category: "Fun", note: "Two tickets", remindDaysBefore: 1 });
  assert.match(A.action(M, TODAY, "plan_payment", { what: "Tickets", amount: null, date: "2026-11-20", category: null, note: null, remind_days_before: null }).error, /needs its amount.*offer a reminder/);
  assert.match(A.action(M, TODAY, "plan_payment", { what: "Tickets", amount: 80, date: TODAY, category: null, note: null, remind_days_before: null }).error, /after today/);
  assert.equal(A.action(M, TODAY, "add_bill", { name: "Domain", amount: 15, frequency: "yearly", due_day: 10, due_date: null, autopay: false, starts: "2027-01-10", remind_days_before: 3 }).remindDaysBefore, 3);
  assert.match(B.describeAction(ok).sub, /Fri 20 Nov · Fun · set aside until then · reminder 1 day before/);
});

test("the rules: a repeating payment is a bill, a one-off is a planned payment, and no money is just a reminder", () => {
  const p = A.systemPrompt(M, TODAY);
  assert.match(p, /If it repeats.*it's a bill: add_bill with starts on that day and remind_days_before/);
  assert.match(p, /If it's a one-off payment.*it's not a bill: plan_payment/);
  assert.match(p, /If you can't tell whether it repeats, ask once/);
  assert.match(p, /A reminder with no money in it \("call mum"\) is add_reminder only/);
});

test("a planned payment is set aside until its day, then spending in its category, not out of that day's share", () => {
  const tx = { id: "p1", date: "2026-11-20", amount: 80, kind: "expense", categoryId: "fun", payee: "Concert tickets", source: "planned" };
  const base = { settings: { monthStart: 1, startDate: "2026-11-01", startBalance: 1000 }, income: [{ id: "sal", name: "Salary", amount: 3100, frequency: "monthly", payDay: 30, active: true, missed: [] }],
    bills: [], categories: [{ id: "fun", name: "Fun", budget: null }], goals: [], lists: [], items: [], transactions: [] };
  const withIt = { ...base, transactions: [tx] };
  assert.equal(E.state(withIt, "2026-11-14").left, E.state(base, "2026-11-14").left - 8000, "set aside before its day");
  assert.equal(E.state(withIt, "2026-11-20").left, E.state(withIt, "2026-11-19").left, "paying it on the day changes nothing that was left");
  assert.equal(E.dayShare(withIt, "2026-11-20").spent, 0, "not out of that day's share");
  assert.equal(E.spending(withIt, "2026-11-20", "2026-11-20").byCat.fun, 8000, "but it is spending on fun");
  const snap = A.snapshot(A.modelFromRows({ settings: base.settings, income: [{ id: "sal", name: "Salary", amount: 3100, frequency: "monthly", pay_day: 30, active: true, missed: [] }], cats: [{ id: "fun", name: "Fun" }],
    tx: [{ id: "p1", date: "2026-11-20", amount: 80, kind: "expense", category_id: "fun", payee: "Concert tickets", source: "planned" }] }), TODAY);
  assert.deepEqual(snap.plannedPayments, [{ what: "Concert tickets", amount: 80, on: "2026-11-20", category: "Fun" }]);
});

test("Plan it: the payment for its day and a reminder before it; Undo takes both back", async () => {
  const r = await B.doAction({ type: "payment", payee: "Concert tickets", amount: 80, date: "2026-11-20", category: "Fun", note: "Two tickets", remindDaysBefore: 1 });
  assert.equal(r.done, true);
  const tx = store.model.transactions.find(t => t.payee === "Concert tickets");
  assert.deepEqual([tx.date, tx.amount, store.model.categories.find(c => c.id === tx.categoryId).name, tx.source], ["2026-11-20", 80, "Fun", "planned"]);
  const rem = store.model.reminders.find(x => /Concert tickets/.test(x.title));
  assert.deepEqual([rem.when, rem.date, rem.hour], ["once", "2026-11-19", 9]);
  r.undo();
  assert.equal(store.model.transactions.some(t => t.payee === "Concert tickets"), false);
  assert.equal(store.model.reminders.some(x => /Concert tickets/.test(x.title)), false);
});

test("a bill's reminder is made once the bill is saved, tied to it", () => {
  const b = read("js/brain.js"), p = read("js/plan.js");
  assert.match(b, /when: "before", aboutKind: "bill", aboutId: saved\.id, beforeDays: a\.remindDaysBefore/);
  assert.match(p, /if \(onSaved\) try \{ onSaved\(saved\); \}/);
});
