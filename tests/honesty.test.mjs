// The honesty check, from a real chat on 15 November 2026 about a JYSK receipt (sofa, bed frame, mattress, transport:
// €1,119). Koti said "Confirmed — the receipt lines are saved" when nothing was, "Tap Confirm on the Save scan card"
// with no card on screen and no Confirm button anywhere, and offered "Edit lines" and "Delete receipt" chips it can't
// do. Now an answer is checked before it's shown: a wrong one goes back to the model once with what's wrong, and if
// it's still wrong, the code says plainly what's on screen.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-15");
await app();
const A = await import("../supabase/functions/koti/agent.js");
const B = await import("../js/brain.js");
const TODAY = "2026-11-15";
const M = A.modelFromRows({ settings: { monthStart: 1, startDate: "2026-09-01", startBalance: 1500 }, cats: [{ id: "cat-shop", name: "Shopping", budget: null }] });
const say = (reply, follow_ups = []) => ({ content: JSON.stringify({ reply, follow_ups, done: false, table: null }) });
const run = async (turns, history, extra = {}) => { const sent = [];
  const f = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: turns.shift() || {} }] }) }; };
  return { r: await A.runAgent({ fetch: f, key: "k", M, today: TODAY, can: B.ACTION_TYPES, history, ...extra }), sent }; };
const opened = { role: "assistant", content: "A JYSK receipt.\n[Cards shown: Receipt from JYSK · €1,119.00 (save_scan p1): opened]" };

test("a save that didn't happen goes back to the model with what's wrong, and its better answer is shown", async () => {
  const { r, sent } = await run([say("Confirmed — the receipt lines are saved: Sofa €350, Bed frame €350, Mattress €350, Transport €69, total €1,119.00."),
    say("Nothing is saved yet. Tap Check and save on the card to save the four lines.")],
    [opened, { role: "user", content: "No, I mean the breakdown I gave to add to the Jysk receipt" }]);
  const check = sent[1].messages.at(-1).content;
  assert.match(check, /^\[Koti's app checked your answer[^]*says "Confirmed", but nothing has been saved/);
  assert.match(r.reply, /^Nothing is saved yet/);
});

test("still claiming a save after the check: the code says plainly that nothing is saved", async () => {
  const claim = say("Confirmed — the receipt lines are saved, sorted into Shopping and Home setup.");
  const { r } = await run([claim, claim, claim], [opened, { role: "user", content: "add them to the Jysk receipt" }]);
  assert.equal(r.reply, "Nothing is saved yet: tell me what to save and I'll put it on a card.");
});

test("a button that isn't there: 'tap Confirm', 'the Save scan card', with no card on screen", async () => {
  const fake = say("The Save scan card is open for the JYSK receipt; tap Confirm to save edits or Edit lines to change amounts or categories.", ["Edit lines", "Delete receipt", "Which is biggest?"]);
  const { r } = await run([fake, fake, fake], [opened, { role: "user", content: "Open it" }]);
  assert.doesNotMatch(r.reply, /Confirm|Save scan|Edit lines/);
  assert.deepEqual(r.followUps, ["Which is biggest?"], "no chips for things Koti can't do");
  assert.deepEqual(A.honestyIssues({ reply: "Tap Confirm on the Save scan card to save the receipt lines." }, { actions: [], earlier: A.cardsOf([opened]) }),
    ['Your answer tells them to use "Confirm", but no card is shown, so there\'s nothing to tap.']);
});

test("'Yes' to a save Koti offered brings the card back, and pointing at its real button passes", async () => {
  const reading = '[Photo p1, as read: {"type":"receipt","from":"JYSK","date":"2026-11-14","total":1119}]';
  const { r } = await run([{ tool_calls: [{ id: "c1", type: "function", function: { name: "save_scan", arguments: JSON.stringify({ photo: "p1" }) } }] },
    say("Tap Check and save on the card to save the receipt lines.")],
    [opened, { role: "assistant", content: "I couldn't read any lines from the photo; save the breakdown you gave?" }, { role: "user", content: "Yes" }], { pinned: [reading] });
  assert.equal(r.actions.length, 1, "consent: the card shown before comes back");
  assert.equal(r.reply, "Tap Check and save on the card to save the receipt lines.");
});

test("what passes: not-yet saves, real buttons, a card still waiting, and saves they really made", () => {
  const scan = [{ id: "a1", type: "scan" }];
  for (const reply of ["Nothing is saved yet — tap Check and save on the card to save it.", "Once you save it, it shows in Spending.", "It isn't saved until you tap Save on the Check it screen.", "Tap the card to check the lines."])
    assert.deepEqual(A.honestyIssues({ reply }, { actions: scan }), [], reply);
  assert.deepEqual(A.honestyIssues({ reply: "Tap Save it on the card." }, { earlier: [{ title: "€5 at Lidl", status: "waiting" }] }), [], "a card from before is still waiting");
  assert.deepEqual(A.honestyIssues({ reply: "Saved: your JYSK purchase is in Spending." }, { earlier: [{ title: "€1,119.00 at JYSK", status: "done" }] }), [], "they saved it themselves");
  assert.deepEqual(A.honestyIssues({ reply: "Your JYSK receipt is saved with 4 lines." }, { saved: true }), [], "a saved receipt that was looked up");
  assert.equal(A.honestyIssues({ reply: "I've added the sofa to your list." }, { actions: [{ type: "list" }] }).length, 1, "a card is waiting, not done");
  for (const reply of ["You've saved €200 towards Trip so far.", "Electricity was recorded on 20 October: €61.", "€58 is set aside for the bill until payday."])
    assert.deepEqual(A.honestyIssues({ reply }, {}), [], reply);
  for (const reply of ["Done — the lamp is on your list.", "The receipt lines are saved.", "It has been added to Home setup.", "Tallensin kuitin."])
    assert.equal(A.honestyIssues({ reply }, {}).length, 1, reply);
});

test("the buttons Koti is told about are exactly the ones the app draws, and the prompt describes the real app", () => {
  for (const [type, button] of Object.entries(A.BUTTONS)) assert.equal(B.describeAction({ type, amount: 1, total: 1, date: TODAY, lines: [], items: [{ name: "x" }], changes: {}, when: "once", hour: 9 }).button, button, type);
  for (const type of Object.values(A.CARD_OF)) if (!["remember", "forget"].includes(type)) assert.ok(A.BUTTONS[type], `${type} has its button listed`);
  const p = A.systemPrompt(M, TODAY);
  assert.match(p, /each card has exactly one button: scan card "Check and save"/);
  assert.match(p, /There is no "Confirm", "Save scan", "Edit lines" or "Delete" button/);
  assert.match(p, /You can't open, edit or delete a saved record from the chat yet/);
  for (const x of ["Delete receipt", "Edit lines", "Confirm", "Save scan"]) assert.ok(A.CANT_DO.test(x), x);
  assert.ok(!A.CANT_DO.test("Which is biggest?"));
});
