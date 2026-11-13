// What a chat on 14 November 2026 showed Koti couldn't do, and the owner asked for:
// - "After my next pay and the bills, what's left?" got €2,100, added up in its head (it was €2,024), and called two
//   lunches from the next pay "bills". Now: month_ahead (the engine's next month, bill by bill), calculate (exact
//   arithmetic), and the snapshot says what comes out of the next pay is purchases.
// - Bills it was told about were "remembered" instead of saved: the rules say add_bill for each.
// - "Can I see a table breakdown?" got a sentence: answers can carry a table.
// - "Koti can ask for review at the end of conversations to improve": How did Koti do?, kept with your settings,
//   and what could be better goes into Koti's instructions next time.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-14");
const { store } = await app();
const A = await import("../supabase/functions/koti/agent.js");
const F = await import("../js/feedback.js");
const { historyOf } = await import("../js/brain.js");

const TODAY = "2026-11-14";
const bills = [["Phone", 15, 5], ["GitHub Pro", 8, 10], ["Claude", 50, 12], ["Render", 8, 15], ["HSL ticket", 67, 1], ["Rent", 910, 1]]
  .map(([name, amount, d], k) => ({ id: "b" + k, name, amount, frequency: "monthly", due_day: d, anchor_month: 1, autopay: true, active: true }));
const M = A.modelFromRows({
  settings: { monthStart: 1, startDate: "2026-11-01", startBalance: 1500, kotiFeedback: [{ id: "f1", good: false, note: "Show the sums, don't guess", at: "2026-11-13" }, { id: "f2", good: true, note: null }] },
  income: [{ id: "sal", name: "Salary", amount: 3100, frequency: "monthly", pay_day: 30, active: true, missed: [] }],
  cats: [{ id: "eat", name: "Eating out", budget: null }], bills,
  tx: [{ id: "l1", date: "2026-11-13", amount: 9, kind: "expense", category_id: "eat", note: "lunch", from_pay: "2026-11-30" },
       { id: "l2", date: "2026-11-13", amount: 9, kind: "expense", category_id: "eat", note: "lunch", from_pay: "2026-11-30" }],
});

test("calculate: exact, and nothing but arithmetic", () => {
  assert.equal(A.calc("3100 - (15 + 8 + 50 + 8 + 67 + 910) - 18"), 2024);
  assert.equal(A.calc("10,50 * 2"), 21);
  assert.equal(A.calc("1/0"), null);
  assert.equal(A.calc("process.exit()"), null);
  assert.deepEqual(A.look(M, TODAY, "calculate", { expression: "3100 - 1058" }), { expression: "3100 - 1058", result: 2042 });
});

test("month_ahead: next month bill by bill, from the engine, after what comes out of the pay", () => {
  const r = A.look(M, TODAY, "month_ahead", { months_ahead: 1 });
  assert.equal(r.month.from, "2026-12-01");
  assert.equal(r.billsTotal, 1058);
  assert.deepEqual(r.bills.map(b => b.bill).sort(), ["Claude", "GitHub Pro", "HSL ticket", "Phone", "Render", "Rent"]);
  assert.equal(r.startsWith.lessSpendingFromNextPay, 18);
  assert.equal(r.startsWith.payStillToCome, 3100);
  assert.equal(r.leftAfterAll, Math.round((r.startsWith.total - 1058) * 100) / 100);
});

test("the snapshot says what comes out of the next pay is purchases, with what they were", () => {
  const s = A.snapshot(M, TODAY).spendingToComeOutOfNextPay;
  assert.equal(s.total, 18);
  assert.deepEqual(s.purchases.map(p => [p.what, p.amount, p.comesOutOn]), [["lunch", 9, "2026-11-30"], ["lunch", 9, "2026-11-30"]]);
});

test("the rules: calculate to combine, month_ahead for after payday, bills saved not remembered, tables, and their notes", () => {
  const p = A.systemPrompt(M, TODAY);
  assert.match(p, /to combine figures, call calculate/);
  assert.match(p, /call month_ahead/);
  assert.match(p, /propose add_bill for each.*never remember them/);
  assert.match(p, /put them in table/);
  assert.match(p, /could be better in earlier chats[\s\S]*Show the sums, don't guess/);
  assert.ok(["month_ahead", "calculate"].every(n => A.LOOK.some(t => t.function.name === n)));
});

test("a table comes back cleaned, and goes into the next turn as text", async () => {
  const sent = [];
  const f = async (_u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: "Your bills:", follow_ups: [], done: false,
    table: { columns: ["Bill", "Amount"], rows: [["Phone", "€15", "extra"], ["Total", "€1,058"]] } }) } }] }) }; };
  const r = await A.runAgent({ fetch: f, key: "k", M, today: TODAY, history: [{ role: "user", content: "table please" }] });
  assert.deepEqual(r.table, { columns: ["Bill", "Amount"], rows: [["Phone", "€15"], ["Total", "€1,058"]] });
  assert.ok(sent[0].response_format.json_schema.schema.required.includes("table"));
  assert.equal(A.tableOf({ columns: [], rows: [] }), null);
  const h = historyOf([{ role: "user", content: "table please" }, { role: "assistant", content: "Your bills:", table: r.table }]);
  assert.match(h[1].content, /Phone \| €15[\s\S]*Total \| €1,058/);
});

test("How did Koti do?: asked after a real chat, once a day, and kept with the settings", () => {
  const chat = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "thanks" }];
  assert.equal(F.shouldAsk([{ role: "user", content: "thanks" }]), false, "one line isn't a conversation");
  assert.equal(F.shouldAsk(chat), true);
  F.rateChat({ good: false, note: "Too many questions", title: "Bills" });
  assert.equal(F.shouldAsk(chat), false, "once a day");
  assert.deepEqual(F.feedback().map(f => [f.good, f.note]), [[false, "Too many questions"]]);
  assert.match(A.systemPrompt(A.modelFromRows({ settings: store.model.settings }), TODAY), /Too many questions/);
  F.forgetFeedback(F.feedback()[0].id);
  assert.equal(F.feedback().length, 0);
});
