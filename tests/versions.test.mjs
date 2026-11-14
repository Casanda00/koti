// The owner, 14 November 2026: a "change this bill" card showed as an empty box. The phone was running a copy of
// Koti from before that card existed: js/version.js (what the update check reads) had stayed at 2026-11-09-50
// through five releases while sw.js went to -55, so phones never heard of a new version. And the server offered a
// card the old app couldn't draw.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday } from "./_env.mjs";
setToday("2026-11-14");
const A = await import("../supabase/functions/koti/agent.js");
const B = await import("../js/brain.js");
const { APP_VERSION } = await import("../js/version.js");
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the version phones check is the version the offline copy carries", () => {
  assert.equal(`koti-${APP_VERSION}`, /const VERSION = "([^"]+)"/.exec(read("sw.js"))[1]);
});

test("Koti offers only the cards the app says it can show; an app that doesn't say gets the old ones", () => {
  const names = ts => ts.map(t => t.function.name);
  assert.ok(!names(A.toolsFor(null)).some(n => ["change_bill", "bill_not_owed", "plan_payment"].includes(n)));
  assert.ok(names(A.toolsFor(null)).includes("spending"), "look-ups are always there");
  assert.deepEqual(names(A.toolsFor(B.ACTION_TYPES)).sort(), names(A.TOOLS).sort());
});

test("every card the server can send, this app can draw", () => {
  for (const type of Object.values(A.CARD_OF)) assert.ok(B.ACTION_TYPES.includes(type), type);
  const samples = { expense: { amount: 5 }, list: { items: [{ name: "Milk" }] }, reminder: { title: "x", when: "once", date: "2026-11-20", hour: 9 }, bill: { name: "Rent", amount: 900, frequency: "monthly", dueDay: 1 },
    payment: { payee: "Tickets", amount: 80, date: "2026-11-20" }, change_bill: { bill: "Rent", changes: { amount: 7 } }, bill_not_owed: { bill: "Rent", amount: 9, due: "2026-11-01" }, goal: { name: "Trip", target: 500 },
    budget: { category: "Fun", amount: 50 }, remember: { fact: "x" }, forget: { fact: "x" } };
  for (const type of B.ACTION_TYPES) assert.ok(B.describeAction({ type, ...samples[type] }).title, type);
});

test("a card the app can't show: the model is told to ask them to update, and nothing reaches the app", async () => {
  const sent = [], turns = [
    { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "change_bill", arguments: JSON.stringify({ bill: "Rent", amount: 7, due_day: null, starts: null, autopay: null, paused: null }) } }] },
    { content: JSON.stringify({ reply: "Update Koti to change bills here.", follow_ups: [], done: false, table: null }) }];
  const f = async (_u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ choices: [{ message: turns[sent.length - 1] }] }) }; };
  const M = A.modelFromRows({ settings: { monthStart: 1 }, bills: [{ id: "r", name: "Rent", amount: 900, frequency: "monthly", due_day: 1, anchor_month: 1, active: true }] });
  const r = await A.runAgent({ fetch: f, key: "k", M, today: "2026-11-14", history: [{ role: "user", content: "Rent is 7 now" }], can: null });
  assert.equal(r.actions.length, 0);
  assert.match(sent[1].messages.at(-1).content, /can't show that card.*update Koti/);
  assert.ok(!sent[0].tools.some(t => t.function.name === "change_bill"));
});

test("the app sends what it can show, draws an unknown card as Update, and Koti doesn't offer Confirm or Cancel chips", () => {
  assert.match(read("js/brain.js"), /can: ACTION_TYPES/);
  assert.match(read("js/koti.js"), /if \(!d\.title\) return [^\n]*This needs the newest Koti[^\n]*data-update/);
  assert.match(A.systemPrompt(A.modelFromRows({ settings: {} }), "2026-11-14"), /Never a follow_up that confirms or cancels a card/);
});
