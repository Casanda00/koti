// The owner, 14 November 2026: bills set up in a chat "starting next month" were asked about on Today ("Did you
// pay…?") this month, and tapping Paid put them in today's payments. Koti didn't know when a bill starts, what Today
// was asking, or that a bill is paid from money already set aside.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-14");
const { store } = await app();
const A = await import("../supabase/functions/koti/agent.js");
const E = await import("../js/engine.js");
const R = await import("../js/receipt.js");
const P = await import("../js/plan.js");
const B = await import("../js/brain.js");
const TODAY = "2026-11-14";
const rows = bills => A.modelFromRows({ settings: { monthStart: 1, startDate: "2026-11-01", startBalance: 2000 },
  income: [{ id: "sal", name: "Salary", amount: 3100, frequency: "monthly", pay_day: 30, active: true, missed: [] }], bills });
const rent = (extra = {}) => ({ id: "rent", name: "Rent", amount: 910, frequency: "monthly", due_day: 1, anchor_month: 11, autopay: false, active: true, ...extra });

test("a bill set up today starts at its next due date, or the date they gave; nothing is owed before", () => {
  const M = rows([]);
  const a = A.action(M, TODAY, "add_bill", { name: "Rent", amount: 910, frequency: "monthly", due_day: 1, due_date: null, autopay: false, starts: null });
  assert.equal(a.startDate, "2026-12-01", "the 1st has gone this month: the first one is in December");
  assert.equal(A.action(M, TODAY, "add_bill", { name: "Gym", amount: 30, frequency: "monthly", due_day: 20, due_date: null, autopay: false, starts: null }).startDate, "2026-11-20");
  assert.equal(A.action(M, TODAY, "add_bill", { name: "Gym", amount: 30, frequency: "monthly", due_day: 20, due_date: null, autopay: false, starts: "2027-01-20" }).startDate, "2027-01-20");
  assert.match(B.describeAction(a).sub, /first one Tue 1 Dec/);
  assert.equal(P.firstDueOf(1, TODAY), "2026-12-01");
  assert.equal(P.firstDueOf(31, "2027-02-10"), "2027-02-28");
});

test("Today asks about a bill only once it has started, and Koti sees what Today asks", () => {
  const started = rows([rent({ start_date: "2026-11-01" })]), later = rows([rent({ start_date: "2026-12-01" })]);
  assert.deepEqual(A.snapshot(started, TODAY).askingOnToday.map(x => [x.asks, x.bill, x.due]), [["Did you pay it?", "Rent", "2026-11-01"]]);
  assert.deepEqual(A.snapshot(later, TODAY).askingOnToday, []);
  assert.equal(E.state(later, TODAY).left, E.state(rows([]), TODAY).left, "nothing set aside this month for a bill that starts in December");
  assert.equal(A.look(later, TODAY, "bills").bills[0].starts, "2026-12-01");
});

test("the rules: bills are set aside, start on their first due date, and Not owed is the answer for one that hadn't started", () => {
  const p = A.systemPrompt(rows([]), TODAY);
  assert.match(p, /marking a bill paid doesn't change what they have left today/);
  assert.match(p, /A bill starts on its first due date/);
  assert.match(p, /the answer is Not owed, never Paid/);
  assert.ok(["change_bill", "bill_not_owed"].every(n => A.ACT.some(t => t.function.name === n)));
});

test("change_bill and bill_not_owed are checked against their bills", () => {
  const M = rows([rent({ start_date: "2026-11-01" })]);
  assert.deepEqual(A.action(M, TODAY, "change_bill", { bill: "rent", amount: null, due_day: null, starts: "2026-12-01", autopay: null, paused: null }), { type: "change_bill", bill: "Rent", billId: "rent", changes: { startDate: "2026-12-01" } });
  assert.match(A.action(M, TODAY, "change_bill", { bill: "Gym", amount: 5, due_day: null, starts: null, autopay: null, paused: null }).error, /No bill called/);
  assert.equal(A.action(M, TODAY, "bill_not_owed", { bill: "Rent", due: "2026-11-01" }).amount, 910);
  assert.match(A.action(M, TODAY, "bill_not_owed", { bill: "Rent", due: "2026-11-05" }).error, /isn't due/);
});

test("marked Paid by mistake: Not owed takes the payment off, and Undo puts it back", async () => {
  const b = store.put("bills", { id: "rent", name: "Rent", amount: 910, frequency: "monthly", dueDay: 1, anchorMonth: 11, autopay: false, active: true, startDate: "2026-11-01" });
  P.markPaid({ bill: b, due: "2026-11-01", amount: 910 }, TODAY, true);   // what Paid on Today does
  assert.ok(E.billOccurrence(store.model, b, "2026-11-01").paid);
  const r = await B.doAction({ type: "bill_not_owed", bill: "Rent", billId: "rent", due: "2026-11-01", amount: 910, wasPaid: true });
  assert.equal(r.done, true);
  const o = E.billOccurrence(store.model, store.model.bills[0], "2026-11-01");
  assert.equal(o.paid, null); assert.equal(o.skipped, true);
  r.undo();
  const u = E.billOccurrence(store.model, store.model.bills[0], "2026-11-01");
  assert.ok(u.paid); assert.equal(u.skipped, false);
});

test("Today's payments: a bill paid today is listed as paid from money set aside, and not in the total", () => {
  store.put("transactions", { id: "lidl", date: TODAY, amount: 16.33, kind: "expense", payee: "Lidl" });
  const body = R.paymentsBody("today");
  assert.match(body.total[1], /16[.,]33/);
  assert.match(body.bills[1], /910/);
  assert.ok(body.rows.some(r => /Rent/.test(r) && /Bill, paid from money set aside/.test(r)));
});
