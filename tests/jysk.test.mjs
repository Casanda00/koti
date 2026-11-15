// The JYSK chat, 15 November 2026, from start to finish: the whole conversation the owner screenshotted, replayed turn
// by turn the way the app sends it (the history, the photos pinned, the purchases being worked on) through the real
// server code. The model here makes the same mistakes the real one made at each turn; every turn checks what they
// would see instead. If any of these mistakes ever reaches them again, this test fails.
//
// The receipt: JYSK Sinimäentie 22, Espoo, Saturday 14 November, €1,119. The reader got the shop, day and total but no
// lines. The lines, as they typed them: sofa €350, bed frame €350, mattress €350, transport €69.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-15");
await app();
const A = await import("../supabase/functions/koti/agent.js");
const B = await import("../js/brain.js");
const TODAY = "2026-11-15";
const rows = (extra = []) => ({ settings: { monthStart: 1, startDate: "2026-09-01", startBalance: 3000 }, cats: [{ id: "cat-shop", name: "Shopping", budget: null }],
  lists: [{ id: "home", name: "Home setup", kind: "project", parent_id: null }, { id: "bed", name: "Bedroom", kind: "room", parent_id: "home" }, { id: "liv", name: "Living room", kind: "room", parent_id: "home" }],
  tx: [{ id: "tx-old", date: "2026-10-03", amount: 45, kind: "expense", category_id: "cat-shop", payee: "JYSK" }, ...extra] });

/* ---------- The chat, as the app keeps it ---------- */
const msgs = [];
const reading = { ai: true, docType: "receipt", reply: "A JYSK receipt from 14 November: €1,119.", bill: null, payments: null, parsed: { payee: "JYSK Sinimäentie 22, Espoo", date: "2026-11-14", amount: 1119, lines: [] } };
const say = (reply, extra = {}) => ({ content: JSON.stringify({ reply, follow_ups: [], done: false, table: null, offer: null, ...extra }) });
const calls = (...cs) => ({ tool_calls: cs.map(([name, args], k) => ({ id: `c${k}${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) });
let M = A.modelFromRows(rows());
/* One turn, as js/brain.js ask() builds it and supabase/functions/koti/index.ts runs it; the answer goes into the chat
   the way js/koti.js send() keeps it. */
async function turn(message, model, { mine = null } = {}) {
  const history = msgs.filter(m => m.role !== "error" && m !== mine), doc = mine && (mine.scan || mine.photoId) ? mine : null;
  if (!mine) msgs.push({ role: "user", content: message });
  const sent = [], f = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: model.shift() || {} }] }) }; };
  const r = await A.runAgent({ fetch: f, key: "k", M, today: TODAY, can: B.ACTION_TYPES,
    history: [...B.historyOf(history), { role: "user", content: message + (doc ? B.photoTag(doc) : "") }],
    pinned: B.photosOfChat(doc ? [...history, doc] : history), earlier: B.earlierOf(history), drafts: B.draftsOf(history) });
  msgs.push({ role: "assistant", content: r.reply, actions: r.actions.filter(a => !["remember", "forget"].includes(a.type)), followUps: r.followUps, table: r.table || null, ...(r.draft ? { draft: r.draft } : {}), ...(r.offer ? { offer: r.offer } : {}) });
  return { r, sent };
}
/* Tapping a card's button, and saving on the screen it opens (js/koti.js runCard and savedFor). */
const card = r => r.actions.find(a => a.status === undefined);
const open = a => { a.status = "opened"; const d = a.draftId && B.draftsOf(msgs).find(x => x.id === a.draftId); if (d && d.status === "proposed") d.status = "opened"; };
const save = (a, tx) => { a.status = "done"; const d = a.draftId && B.draftsOf(msgs).find(x => x.id === a.draftId); if (d) { d.status = "saved"; d.txId = tx.id; }
  msgs.push({ role: "note", content: `Saved €${tx.amount.toFixed(2)} at ${tx.payee} with ${tx.lines.length} lines` }); };
const never = r => { assert.doesNotMatch(r.reply, /\bconfirm(ed)?\b|save scan|edit lines|delete receipt|couldn'?t read/i, r.reply); assert.ok(!r.followUps.some(x => A.CANT_DO.test(x)), r.followUps.join(", ")); };

test("the JYSK chat, turn by turn", async () => {
  // 1. The photo. The reader got no lines; Koti gave up on it ("send a clearer close-up"). Now it goes back to the reader.
  const photo = { role: "user", content: "Here's the JYSK receipt", typed: true, photoId: "p1", scan: { id: "p1", r: reading } };
  msgs.push(photo);
  let { r } = await turn(photo.content, [say("This is a JYSK receipt from 14 November for €1,119 — I couldn't read the individual lines; save it as one Shopping/Home setup expense, or send a clearer close-up.")], { mine: photo });
  assert.equal(r.reread, "p1", "1: the photo goes back to the reader, the same one as Add");
  msgs.at(-1).content = "I still couldn't read its lines. Try a sharper photo, flat and in good light, with the lines in view.";   // the reader again, still no lines

  // 2. They type the lines. Koti offered four expenses: now one purchase with four lines, with the photo, worked out
  //    as the photo's total (350 + 350 + 350 + 69 = 1,119).
  const typed = "I can give you a breakdown of the payment. 350e for the sofa. 350 for bed frame, 350e for mattress and 69e for transportation. Can you update it";
  const four = [["Sofa", 350], ["Bed frame", 350], ["Mattress", 350], ["Transportation", 69]].map(([note, amount]) => ["add_expense", { amount, payee: "JYSK", date: "2026-11-14", category: "Shopping", note, from_next_pay: false, from_savings: false, goal: null }]);
  let sent;
  ({ r, sent } = await turn(typed, [calls(...four), say("Tap each card to save them.")]));
  assert.match(sent[0].messages.at(-2).content, /€350\.00 \+ €350\.00 \+ €350\.00 \+ €69\.00 = €1119\.00[^]*exactly the total of Photo p1/, "2: told what the amounts are");
  assert.equal(r.actions.length, 1, "2: one card, not four");
  assert.deepEqual([r.actions[0].type, r.actions[0].total, r.actions[0].scanId, r.actions[0].lines.map(l => l.name).join(", ")], ["purchase", 1119, "p1", "Sofa, Bed frame, Mattress, Transportation"]);
  assert.deepEqual([r.draft.id, r.draft.status, r.draft.lines.length], ["p1", "proposed", 4], "2: the purchase being worked on");
  never(r);
  const purchase = card(r);

  // 3. "Show breakdown": the table, and no "tap Save scan" (there is no such button: the card above is waiting).
  ({ r } = await turn("Show breakdown", [say("Here's the breakdown from your figures — tap Save scan to open and save it.", { table: { columns: ["Item", "Amount"], rows: [["Sofa", "€350.00"], ["Bed frame", "€350.00"], ["Mattress", "€350.00"], ["Transport", "€69.00"], ["Total", "€1,119.00"]] } }),
    say("Here's the breakdown from your figures — tap Check and save on the card above to save it.")]));
  assert.deepEqual(r.table.rows.at(-1), ["Total", "€1,119.00"]);
  never(r);

  // They open the card and close the screen without saving.
  open(purchase);

  // 4. "Can I get the breakdown again": their lines, never "I couldn't read any lines from the photo".
  ({ r } = await turn("Can I get the breakdown again", [say("I couldn't read any lines from the photo; save the breakdown you gave (sofa €350, bed frame €350, mattress €350, transport €69)?", { offer: "save_purchase" })]));
  assert.deepEqual(r.table.rows.map(x => x[0]), ["Sofa", "Bed frame", "Mattress", "Transportation", "Total"], "4: the lines they gave");
  assert.equal(r.offer, "save_purchase");
  never(r);

  // 5. "Yes": the card. (Koti said "Tap Confirm on the Save scan card" with no card.)
  const talk = say("Tap Confirm on the Save scan card to save the receipt lines into Shopping and the Home setup project.");
  ({ r } = await turn("Yes", [talk, talk, talk]));
  assert.equal(r.actions.length, 1, "5: a yes gets the card it said yes to");
  assert.deepEqual([r.actions[0].type, r.actions[0].total, r.actions[0].scanId], ["purchase", 1119, "p1"]);
  assert.equal(r.reply, 'Tap "Check and save" on the card below.');
  const yesCard = card(r);

  // 6. "I don't see the list": the lines, not their Home setup lists.
  let s6;
  ({ r, sent: s6 } = await turn("I don't see the list", [calls(["lists", {}]), say("Your Home setup lists: Bathroom & personal care (6), Bedroom (8), Living room (6)."), say("Here are the four lines you gave for the JYSK receipt.")]));
  assert.match(s6.at(-1).messages.at(-1).content, /"the list" is its lines, not their shopping lists/);
  assert.equal(r.reply, "Here are the four lines you gave for the JYSK receipt.");

  // 7. "…add to the Jysk receipt": Koti said "Confirmed — the receipt lines are saved" when nothing was.
  const claim = say("Confirmed — the receipt lines are saved: Sofa €350, Bed frame €350, Mattress €350, Transport €69, total €1,119.00, sorted into Shopping and Home setup.");
  ({ r } = await turn("No, I mean the breakdown I gave to add to the Jysk receipt", [claim, claim, claim]));
  assert.equal(r.reply, "Nothing is saved yet: tap the card above to check it and save.", "7: never a save that didn't happen");

  // They save it on the Check it screen: the card says so, and Koti knows which record it is.
  open(yesCard);
  const tx = { id: "tx-jysk", date: "2026-11-14", amount: 1119, kind: "expense", category_id: "cat-shop", payee: "JYSK", source: "receipt", lines: [{ name: "Sofa", price: 350, categoryId: "proj:home" }, { name: "Bed frame", price: 350, categoryId: "proj:home" }, { name: "Mattress", price: 350, categoryId: "proj:home" }, { name: "Transportation", price: 69, categoryId: "cat-shop" }] };
  save(yesCard, tx);
  M = A.modelFromRows(rows([tx]));
  assert.deepEqual(B.draftsOf(msgs).map(d => [d.id, d.status, d.txId]), [["p1", "saved", "tx-jysk"]]);

  // 8. "I want to edit it. Pull the receipt": the card that opens what they saved. (Koti said "Open the JYSK receipt", no card.)
  const vague = say("Open the JYSK receipt");
  ({ r } = await turn("I want to edit it. Pull the receipt", [vague, vague, vague]));
  assert.deepEqual([r.actions[0].type, r.actions[0].txId, r.actions[0].amount], ["record", "tx-jysk", 1119], "8: Open, on the purchase they saved");

  // 9. "Open it": Koti opens it and points at the real button. (Koti said "tap Confirm… or Edit lines", offered "Delete receipt".)
  ({ r } = await turn("Open it", [calls(["open_record", { record: "p1", shop: null, date: null, amount: null }]), say("Tap Open on the card to change the JYSK purchase or delete it there.", { follow_ups: ["Edit lines", "Delete receipt", "Which line is biggest?"] })]));
  assert.equal(r.actions[0].type, "record");
  assert.equal(r.reply, "Tap Open on the card to change the JYSK purchase or delete it there.");
  assert.deepEqual(r.followUps, ["Which line is biggest?"]);
  never(r);

  // And across the whole chat: never a made-up button, never a save claimed that didn't happen.
  for (const m of msgs.filter(x => x.role === "assistant").slice(1)) assert.doesNotMatch(m.content, /\bconfirm(ed)?\b|save scan|edit lines/i, m.content);
});

// The same chat again at 12:57 (the server still ran the morning's code, but these could happen on any): after "I want
// to add the breakdown. 350 for sofa, 350 for bed, 350 for bed frame, and 69 to transport them" Koti said "I made a
// Save scan card with those lines to confirm" with no card, and "Show me the card" got Koti's own note pasted back:
// "[Cards shown: Receipt from JYSK, Sinimäentie 22, Espoo · €1119 (save_scan p1): waiting; …]".
test("the JYSK chat at 12:57: Koti's own notes never reach them, a card it claims is a card, and 'show me the card' shows it", async () => {
  const M2 = A.modelFromRows(rows());
  const pinned = ['[Photo p1, as read: {"type":"receipt","from":"JYSK Sinimäentie 22, Espoo","date":"2026-11-14","total":1119}]'];
  const lines = [{ name: "Sofa", price: 350, category: "Shopping", place: null }, { name: "Bed", price: 350, category: "Shopping", place: null }, { name: "Bed frame", price: 350, category: "Shopping", place: null }, { name: "Transport", price: 69, category: null, place: null }];
  const draft = { id: "p1", photo: "p1", payee: "JYSK", date: "2026-11-14", total: 1119, lines, from: "you", status: "proposed", txId: null };
  const go = async (model, history, drafts = []) => { const f = async () => ({ ok: true, json: async () => ({ choices: [{ message: model.shift() || {} }] }) });
    return A.runAgent({ fetch: f, key: "k", M: M2, today: TODAY, can: B.ACTION_TYPES, history, pinned, drafts }); };
  const photoTurn = { role: "user", content: "Here's the receipt [added Photo p1]" }, cardTurn = { role: "assistant", content: "That's a JYSK receipt for €1,119.\n[Cards shown: Receipt from JYSK Sinimäentie 22, Espoo · €1,119.00 (save_scan p1): waiting]" };

  // "I made a Save scan card…" with no card: sent back; still none, so the claim goes and the card they gave lines for is made from the lines
  const made = { content: JSON.stringify({ reply: "I made a Save scan card with those lines to confirm: sofa €350, bed €350, bed frame €350, transport €69. Tap Check and save to record them as Shopping and keep the receipt.", follow_ups: ["Check and save", "Edit lines", "Don't save"], done: false, table: null, offer: null }) };
  let r = await go([made, made, made], [photoTurn, cardTurn, { role: "user", content: "I want to add the breakdown. 350 for sofa, 350 for bed, 350 for bed frame, and 69 to transport them" }]);
  assert.doesNotMatch(r.reply, /I made a Save scan card/);
  assert.ok(!r.followUps.includes("Edit lines"));

  // "Show me the card": the card, never "[Cards shown: …]"
  const leak = { content: JSON.stringify({ reply: "[Cards shown: Receipt from JYSK, Sinimäentie 22, Espoo · €1119 (save_scan p1): waiting; Save scan — lines: sofa €350, bed €350, bed frame €350, transport €69 (check and save): waiting]", follow_ups: [], done: false, table: null, offer: null }) };
  r = await go([leak, leak, leak], [photoTurn, cardTurn, { role: "user", content: "Show me the card" }], [draft]);
  assert.doesNotMatch(r.reply, /\[|Cards shown|save_scan/);
  assert.equal(r.actions.length, 1, "the card, again");
  assert.deepEqual([r.actions[0].type, r.actions[0].total, r.actions[0].scanId], ["purchase", 1119, "p1"]);
  assert.equal(r.reply, 'Tap "Check and save" on the card below.');
  assert.equal(A.stripNotes("Here it is. [Offered: save_purchase] [added Photo p2, not read: x]"), "Here it is.");
  for (const x of ["Show me the card", "I don't see the card", "where's the card?", "Näytä kortti"]) assert.ok(A.SHOW_CARD.test(x), x);
});
