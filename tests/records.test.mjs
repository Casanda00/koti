// Opening and changing a purchase they already saved, from the chat. From a real chat on 15 November 2026: "I want to
// edit it. Pull the receipt" got "Open the JYSK receipt" (no card) and "Open it" got made-up buttons: Koti had no way
// to open a saved record. Now open_record opens it on its edit screen, and update_purchase replaces its lines, still
// one record (never a second save that counts it twice).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-15");
const { store } = await app();
const A = await import("../supabase/functions/koti/agent.js");
const B = await import("../js/brain.js");
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const TODAY = "2026-11-15";
const M = A.modelFromRows({ settings: { monthStart: 1, startDate: "2026-09-01", startBalance: 1500 }, cats: [{ id: "cat-shop", name: "Shopping", budget: null }],
  lists: [{ id: "home", name: "Home setup", kind: "project", parent_id: null }, { id: "bed", name: "Bedroom", kind: "room", parent_id: "home" }],
  tx: [{ id: "tx-jysk", date: "2026-11-14", amount: 1119, kind: "expense", category_id: "cat-shop", payee: "JYSK", source: "receipt" },
       { id: "tx-jysk2", date: "2026-10-03", amount: 45, kind: "expense", category_id: "cat-shop", payee: "JYSK", source: "manual" },
       { id: "tx-lidl", date: "2026-11-14", amount: 23.4, kind: "expense", category_id: "cat-shop", payee: "Lidl" }] });
const say = reply => ({ content: JSON.stringify({ reply, follow_ups: [], done: false, table: null, offer: null }) });
const call = (name, args) => ({ tool_calls: [{ id: "c" + name, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const run = async (turns, history, extra = {}) => { const sent = [];
  const f = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: turns.shift() || {} }] }) }; };
  return { r: await A.runAgent({ fetch: f, key: "k", M, today: TODAY, can: B.ACTION_TYPES, history, ...extra }), sent }; };
const lines = [{ name: "Sofa", price: 350, category: "Shopping", place: "Home setup" }, { name: "Bed frame", price: 350, category: "Shopping", place: "Home setup › Bedroom" }, { name: "Mattress", price: 350, category: "Shopping", place: "Bedroom" }, { name: "Transport", price: 69, category: "Shopping", place: null }];
const saved = { id: "p1", photo: "p1", payee: "JYSK", date: "2026-11-14", total: 1119, lines, from: "you", status: "saved", txId: "tx-jysk" };

test("a saved purchase is found by the draft it was saved from, or by shop, day and amount; several or none are said", () => {
  assert.equal(A.findRecord(M, { record: "p1" }, [saved]).tx.id, "tx-jysk");
  assert.equal(A.findRecord(M, { shop: "jysk", date: "2026-11-14" }).tx.id, "tx-jysk");
  assert.equal(A.findRecord(M, { shop: "JYSK", amount: 45 }).tx.id, "tx-jysk2");
  assert.match(A.findRecord(M, { shop: "JYSK" }).error, /Several fit: JYSK 2026-11-14 €1119; JYSK 2026-10-03 €45\. Ask which/);
  assert.match(A.findRecord(M, { shop: "IKEA" }).error, /No saved purchase from "IKEA"[^]*not be saved yet/);
  assert.match(A.findRecord(M, {}).error, /Say which purchase/);
});

test("open_record opens it; update_purchase replaces its lines and stays one purchase", () => {
  assert.deepEqual(A.action(M, TODAY, "open_record", { record: "p1" }, { drafts: [saved] }),
    { type: "record", txId: "tx-jysk", payee: "JYSK", date: "2026-11-14", draftId: "p1", amount: 1119, lines: 0 });
  const u = A.action(M, TODAY, "update_purchase", { shop: "JYSK", date: "2026-11-14", amount: 1119, lines }, {});
  assert.deepEqual([u.type, u.txId, u.amount, u.was, u.lines.length], ["replace", "tx-jysk", 1119, 1119, 4]);
  assert.match(A.action(M, TODAY, "update_purchase", { shop: "JYSK", date: "2026-11-14", lines: [{ name: "Sofa", price: 1, category: "Nope", place: null }] }, {}).error, /No category called "Nope"/);
});

test("'I want to edit it. Pull the receipt': a card that opens what they saved, even when the model only talks", async () => {
  const talk = say("Open the JYSK receipt");
  const { r, sent } = await run([talk, talk, talk], [{ role: "user", content: "I want to edit it. Pull the receipt" }], { drafts: [saved] });
  assert.match(sent[1].messages.at(-1).content, /They want to open what they saved \(p1: JYSK[^]*propose open_record with record p1/);
  assert.equal(r.actions.length, 1); assert.equal(r.actions[0].type, "record"); assert.equal(r.actions[0].txId, "tx-jysk");
  assert.match(A.contextOf(M, TODAY, [], new Map(), [], "open it", [saved]), /"Open it", "pull the receipt", "edit it" mean open_record with record p1/);
});

test("'Open it': the model opens it, and pointing at its real Open button passes the check", async () => {
  const { r } = await run([call("open_record", { record: "p1", shop: null, date: null, amount: null }), say("Tap Open on the card to change the JYSK purchase.")], [{ role: "user", content: "Open it" }], { drafts: [saved] });
  assert.equal(r.actions[0].type, "record");
  assert.equal(r.reply, "Tap Open on the card to change the JYSK purchase.");
  // the lines for a purchase saved as one amount: update it, never save it again
  assert.match(A.contextOf(M, TODAY, [], new Map(), [], "350 + 350 + 350 + 69", []), /saved as one amount without lines[^]*update_purchase[^]*count it twice/);
});

test("the app: Open and Review cards open the edit screen (with the new lines), which reports the save or a delete", () => {
  assert.deepEqual(B.describeAction({ type: "record", payee: "JYSK", amount: 1119, date: "2026-11-14", lines: 4 }).button, "Open");
  const d = B.describeAction({ type: "replace", payee: "JYSK", amount: 1119, was: 1119, date: "2026-11-14", lines: lines.map(l => ({ name: l.name, price: l.price })) });
  assert.equal(d.button, "Review"); assert.match(d.sub, /^4 lines: Sofa €350[^]*still one purchase$/);
  const home = store.model.lists.find(l => l.kind === "project") || store.put("lists", { id: "proj-h", name: "Home setup", kind: "project", position: 9 });
  const cat = store.model.categories[0];
  const L = B.linesForRecord([{ name: "Sofa", price: 350, category: cat.name, place: `${home.name} › Bedroom` }, { name: "Tape", price: 3, category: cat.name, place: null }]);
  assert.deepEqual(L.map(l => [l.name, l.categoryId]), [["Sofa", "proj:" + home.id], ["Tape", cat.id]]);
  const k = read("js/koti.js"), m = read("js/money.js");
  assert.match(k, /a\.type === "record" \|\| a\.type === "replace"[^]*\{ \.\.\.tx, amount: a\.amount, lines: linesForRecord\(a\.lines\) \}[^]*m\.openExpense\(\{ tx: edit, onSaved: savedFor\(a\) \}\)/);
  assert.match(m, /export function openExpense\(\{ tx = null, mode = "type", draft = null, onSaved = null \} = \{\}\)/);
  assert.equal((m.match(/if \(onSaved\) onSaved\(/g) || []).length, 2, "a save and a delete report back");
  assert.equal(A.BUTTONS.record, "Open"); assert.equal(A.BUTTONS.replace, "Review");
});
