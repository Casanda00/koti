// The purchase being worked on (a draft), what Koti offered, and the Check it screen telling the chat it saved. From
// a real chat on 15 November 2026: the JYSK photo was read without its lines, they typed them (sofa 350, bed frame
// 350, mattress 350, transport 69), and then "Save scan" opened the empty reading, "the breakdown again" got "I
// couldn't read any lines", "Yes" got no card, and "I don't see the list" got their shopping lists.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-15");
await app();
const A = await import("../supabase/functions/koti/agent.js");
const B = await import("../js/brain.js");
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const TODAY = "2026-11-15";
const M = A.modelFromRows({ settings: { monthStart: 1, startDate: "2026-09-01", startBalance: 1500 }, cats: [{ id: "cat-shop", name: "Shopping", budget: null }],
  lists: [{ id: "home", name: "Home setup", kind: "project", parent_id: null }, { id: "bed", name: "Bedroom", kind: "room", parent_id: "home" }, { id: "g", name: "Groceries", kind: "shopping", parent_id: null }] });
const say = (reply, extra = {}) => ({ content: JSON.stringify({ reply, follow_ups: [], done: false, table: null, offer: null, ...extra }) });
const call = (name, args) => ({ tool_calls: [{ id: "c" + name, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const run = async (turns, history, extra = {}) => { const sent = [];
  const f = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: turns.shift() || {} }] }) }; };
  return { r: await A.runAgent({ fetch: f, key: "k", M, today: TODAY, can: B.ACTION_TYPES, history, ...extra }), sent }; };
const pinned = ['[Photo p1, as read: {"type":"receipt","from":"JYSK","date":"2026-11-14","total":1119}]'];   // read without its lines
const lines = [{ name: "Sofa", price: 350, category: "Shopping", place: "Home setup" }, { name: "Bed frame", price: 350, category: "Shopping", place: "Home setup › Bedroom" }, { name: "Mattress", price: 350, category: "Shopping", place: "Home setup › Bedroom" }, { name: "Transport", price: 69, category: null, place: null }];
const draft = { id: "p1", photo: "p1", payee: "JYSK", date: "2026-11-14", total: 1119, lines, from: "you", status: "opened", txId: null };
const photoTurn = { role: "user", content: "Here's the JYSK receipt [added Photo p1]" };

test("their lines become the purchase being worked on, tied to the photo and to the card", async () => {
  const { r } = await run([call("save_purchase", { payee: "JYSK", date: "2026-11-14", photo: "p1", lines }), say("Tap Check and save on the card.")],
    [photoTurn, { role: "user", content: "350 for sofa, 350 for bed frame, 350 for mattress, 69 to transport them" }], { pinned });
  assert.deepEqual([r.draft.id, r.draft.photo, r.draft.total, r.draft.lines.length, r.draft.from, r.draft.status], ["p1", "p1", 1119, 4, "you", "proposed"]);
  assert.equal(r.actions[0].draftId, "p1");
  assert.deepEqual(A.cleanDrafts([{ id: "x", total: "lots", lines: [{ name: "", price: "9" }], status: "hacked" }, null, { nope: 1 }]),
    [{ id: "x", photo: null, payee: null, date: null, total: null, lines: [{ name: "Item", price: 0, category: null, place: null }], from: "you", status: "proposed", txId: null }]);
});

test("'Can I get the breakdown again': their lines, not 'I couldn't read any lines'", async () => {
  const { r } = await run([say("I couldn't read any lines from the photo; save the breakdown you gave?")], [photoTurn, { role: "user", content: "Can I get the breakdown again" }], { pinned, drafts: [draft] });
  assert.deepEqual(r.table.rows.map(x => x[0]), ["Sofa", "Bed frame", "Mattress", "Transport", "Total"]);
  assert.deepEqual(r.table.rows.at(-1), ["Total", "", "1119.00"]);
  assert.equal(r.reread, undefined, "nothing to read again: they gave the lines");
  assert.doesNotMatch(r.reply, /couldn't read/);
  assert.equal(A.breakdownOf(A.photosOf([{ role: "system", content: A.chatMemory(pinned) }]), "p1", "item", [draft]).linesFrom, "them");
});

test("'Save scan' for a photo read without lines saves their lines with the photo, not the empty reading", () => {
  const photos = A.photosOf([{ role: "system", content: A.chatMemory(pinned) }]);
  const card = A.action(M, TODAY, "save_scan", { photo: "p1" }, { photos, allPhotos: ["p1"], drafts: [draft] });
  assert.deepEqual([card.type, card.total, card.scanId, card.lines.length], ["purchase", 1119, "p1", 4]);
  assert.equal(A.action(M, TODAY, "save_scan", { photo: "p1" }, { photos, allPhotos: ["p1"], drafts: [] }).type, "scan", "no lines given: the reading as before");
});

test("'Yes' to what Koti offered gets that card, even when the model only talks", async () => {
  const offered = { role: "assistant", content: "Save the breakdown you gave (sofa €350, bed frame €350, mattress €350, transport €69)?\n[Offered: save_purchase]" };
  const talk = say("Tap Confirm on the Save scan card to save the receipt lines into Shopping and the Home setup project.");
  const { r, sent } = await run([talk, talk, talk], [photoTurn, offered, { role: "user", content: "Yes" }], { pinned, drafts: [draft] });
  assert.match(sent[1].messages.at(-1).content, /They said yes to what you offered \(save_purchase\): propose that card now with the lines of p1 and photo p1/);
  assert.equal(r.actions.length, 1); assert.equal(r.actions[0].type, "purchase"); assert.equal(r.actions[0].scanId, "p1"); assert.equal(r.actions[0].total, 1119);
  assert.equal(r.reply, 'Tap "Check and save" on the card below.');
  // the offer is kept with the answer and goes back as "[Offered: …]"
  const o = await run([say("Save the breakdown you gave?", { offer: "save_purchase" })], [{ role: "user", content: "Can I get the breakdown again" }]);
  assert.equal(o.r.offer, "save_purchase");
  assert.match(B.historyOf([{ role: "assistant", content: "Save it?", offer: "save_purchase" }])[0].content, /\[Offered: save_purchase\]$/);
  assert.ok(A.YES.test("Yes") && A.YES.test("ok do it") && A.YES.test("Kyllä") && !A.YES.test("yesterday's lunch"));
  assert.ok(A.SAVE_ASK.test("Kyllä") && A.SAVE_ASK.test("avaa se") && !A.SAVE_ASK.test("opened"));
});

test("'I don't see the list' in the middle of a purchase means its lines, not their shopping lists", async () => {
  const { r, sent } = await run([call("lists", {}), say("Your Home setup lists: Bedroom (8), Groceries (7)."), say("Here are the four lines you gave for JYSK.")],
    [photoTurn, { role: "user", content: "I don't see the list" }], { pinned, drafts: [draft] });
  assert.match(sent[2].messages.at(-1).content, /They mean the purchase they're working on \(p1: JYSK[^]*"the list" is its lines/);
  assert.equal(r.reply, "Here are the four lines you gave for JYSK.");
  assert.match(A.contextOf(M, TODAY, [], new Map(), [], "the list", [draft]), /being worked on, p1: JYSK, 2026-11-14, €1119\.00 \(Photo p1\), 4 lines they gave: Sofa 350[^]*its card was opened, not saved yet[^]*"The list", "the breakdown"/);
});

test("once saved, Koti knows: the draft says which record, and a saved purchase isn't offered as unsaved", () => {
  const c = A.contextOf(M, TODAY, [], new Map(), [], "pull the receipt", [{ ...draft, status: "saved", txId: "tx-9" }]);
  assert.match(c, /The purchase they saved, p1: JYSK[^]*saved \(record tx-9\)/);
  assert.doesNotMatch(c, /"save it" is save_purchase/);
});

test("the app keeps the drafts with the chat, sends them back, and the Check it screen reports the save", () => {
  const d1 = { id: "p1", total: 1119, status: "proposed" }, d2 = { ...d1, status: "saved", txId: "tx-1" };
  assert.deepEqual(B.draftsOf([{ role: "assistant", content: "a", draft: d1 }, { role: "user", content: "b" }, { role: "assistant", content: "c", draft: d2 }]), [d2]);
  const k = read("js/koti.js"), s = read("js/scan.js"), i = read("supabase/functions/koti/index.ts");
  assert.match(k, /drafts: draftsOf\(history\)/);
  assert.match(k, /\.\.\.\(r\.draft \? \{ draft: r\.draft \} : \{\}\), \.\.\.\(r\.offer \? \{ offer: r\.offer \} : \{\}\)/);
  assert.match(k, /const savedFor = a => saved => \{[^]*a\.status = saved \? "done" : "undone";[^]*d\.status = saved \? "saved" : "undone"; d\.txId = saved \? saved\.id : null;[^]*role: "note"/);
  assert.match(k, /openReading\(\{ r: m\.scan\.r, file: photos\.get\(a\.scanId\) \|\| null, onSaved: savedFor\(a\) \}\)/);
  assert.match(k, /m\.role === "note" \? `<p class="kmem kmem-saved">/);
  assert.match(s, /export function openReading\(\{ r, file = null, onSaved = null \}\)/);
  assert.match(s, /export function openParsed\(parsed, \{ onSaved = null \} = \{\}\)/);
  assert.equal((s.match(/if \(S\.onSaved\) S\.onSaved\(\{/g) || []).length, 5, "every save on the Check it screens reports back: a purchase, money in, a bill paid, a new bill, payments");
  assert.match(i, /const drafts = Array\.isArray\(body\.drafts\) \? body\.drafts\.slice\(-4\) : \[\];/);
  assert.match(A.systemPrompt(M, TODAY), /Asking first: when you ask whether to do something[^]*set offer to the card tool/);
});
