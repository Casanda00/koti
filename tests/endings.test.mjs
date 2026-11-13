// Two things the owner saw on 13 November 2026:
// 1. Two lunches said to come out of the next pay were listed in Today's payments and counted in its total, as if
//    they were today's money. They are listed with the day they come out, and kept out of the total.
// 2. "That's all" got another "Anything else?". Koti now knows a chat is ending: it says goodbye and the chat closes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-13");
const { store } = await app();
const R = await import("../js/receipt.js");
const A = await import("../supabase/functions/koti/agent.js");
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("Today's payments: lunches from the next pay are marked, and not in today's total", () => {
  store.put("income", { id: "sal", name: "Salary", amount: 3100, frequency: "monthly", payDay: 30, active: true, missed: [] });
  store.put("transactions", { id: "l1", date: "2026-11-13", amount: 9, kind: "expense", note: "lunch", fromPay: "2026-11-30" });
  store.put("transactions", { id: "l2", date: "2026-11-13", amount: 9, kind: "expense", note: "lunch", fromPay: "2026-11-30" });
  store.put("transactions", { id: "lidl", date: "2026-11-13", amount: 16.33, kind: "expense", payee: "Lidl Espoo - Niittykumpu" });
  const b = R.paymentsBody("today");
  assert.equal(b.rows.length, 3);
  assert.match(b.total[1], /16[.,]33/);
  assert.match(b.later[1], /18/);
  assert.equal(b.rows.filter(r => /From your pay on Monday 30 November/.test(r)).length, 2);
});

const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const fake = turns => { const sent = []; let i = 0; return { sent, f: async (_u, o) => { sent.push(JSON.parse(o.body)); const m = turns[i++]; return { ok: true, json: async () => ({ choices: [{ message: m, finish_reason: "stop" }] }) }; } }; };
const M = A.modelFromRows({ settings: { monthStart: 1, startDate: "2026-11-01", startBalance: 500 }, cats: [{ id: "eat", name: "Eating out", budget: null }] });

test("'That's all': a goodbye, no follow-ups, and the chat is told it's done", async () => {
  const { f, sent } = fake([{ content: JSON.stringify({ reply: "Have a good evening!", follow_ups: ["Show left to spend today"], done: true }) }]);
  const r = await A.runAgent({ fetch: f, key: "k", M, today: "2026-11-13", history: [{ role: "user", content: "That's all" }] });
  assert.equal(r.done, true);
  assert.deepEqual(r.followUps, []);
  assert.equal(sent[0].response_format.json_schema.schema.required.includes("done"), true);
  assert.match(A.systemPrompt(M, "2026-11-13"), /that's all/);
  assert.match(A.systemPrompt(M, "2026-11-13"), /never as YYYY-MM-DD/);
});

test("a chat isn't closed while a card is still waiting", async () => {
  const { f } = fake([
    { content: null, tool_calls: [call("c1", "add_expense", { amount: 9, payee: null, date: null, category: "Eating out", note: "lunch", from_next_pay: true, from_savings: false, goal: null })] },
    { content: JSON.stringify({ reply: "Lunch is on the card. Bye!", follow_ups: [], done: true }) },
  ]);
  const r = await A.runAgent({ fetch: f, key: "k", M, today: "2026-11-13", history: [{ role: "user", content: "lunch 9 from my next pay, that's all" }] });
  assert.equal(r.done, false);
});

test("the app closes a finished chat, keeps it in Earlier, and a hands-free one ends after the goodbye", () => {
  const k = read("js/koti.js"), c = read("js/converse.js"), b = read("js/brain.js");
  assert.match(b, /done: d\.done === true/);
  assert.match(k, /if \(r\.done && !quiet\) setTimeout\(finishChat/);
  assert.match(k, /function finishChat\(\) \{[\s\S]*?persist\(\);[\s\S]*?newConversation\(\);[\s\S]*?closeKoti\(\);/);
  assert.match(k, /end: r\.done/);
  assert.match(c, /if \(reply && reply\.end\) \{ end\("done"\)/);
});
