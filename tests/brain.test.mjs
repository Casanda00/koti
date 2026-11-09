// Koti's brain on the phone (js/brain.js): what Koti remembers, the actions it proposes and what tapping them does,
// today's note asked for once a day, and questions typed into the add box going to Koti instead of being read as
// a purchase ("can I afford a 200€ sofa?" has an amount in it, and until 9 November 2026 it opened "Save €200").
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const { store } = await import("../js/data.js");
const { sync } = await import("../js/sync.js");
const B = await import("../js/brain.js");
const C = await import("../js/composer.js");
const { frequentPayees } = await import("../js/hear.js");

function signedIn(reply) {
  const calls = [];
  sync.user = { id: "u1" };
  sync.client = { functions: { invoke: async (name, { body }) => { calls.push({ name, body }); return typeof reply === "function" ? reply(name, body) : { data: reply, error: null }; } } };
  return calls;
}

test("Koti remembers a thing once, and forgets it", () => {
  const m = B.remember("Gets paid on the last working day");
  assert.ok(m && m.id);
  assert.equal(B.remember("gets paid on the last working day"), null, "not twice");
  assert.deepEqual(B.memory().map(x => x.text), ["Gets paid on the last working day"]);
  assert.equal(store.model.settings._t.memory != null, true, "a setting with its own time, so it syncs and merges");
  B.forget(m.id);
  assert.deepEqual(B.memory(), []);
});

test("a conversation turn: memory is kept straight away, the rest come back as cards", async () => {
  const calls = signedIn({ reply: "Noted. Want a reminder?", followUps: ["Remind me on the 14th"], actions: [{ id: "a1", type: "remember", fact: "Is saving for a sofa" }, { id: "a2", type: "list", list: null, items: [{ name: "Milk", qty: null }] }] });
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "m" + i })).concat([{ role: "error", content: "offline" }]);
  const r = await B.ask({ message: "I'm saving for a sofa", history });
  assert.equal(calls[0].name, "koti");
  assert.equal(calls[0].body.message, "I'm saving for a sofa");
  assert.equal(calls[0].body.mode, "chat");
  assert.equal(calls[0].body.history.length, 12);
  assert.ok(calls[0].body.history.every(m => m.role !== "error"));
  assert.deepEqual(r.actions.map(a => a.type), ["list"]);
  assert.equal(r.remembered[0].done, true);
  assert.ok(B.memory().some(m => m.text === "Is saving for a sofa"));
  r.remembered[0].undo();
  assert.ok(!B.memory().some(m => m.text === "Is saving for a sofa"), "Undo takes it back");
});

test("tapping a card does it, and Undo takes it back", async () => {
  const items = store.model.items.length;
  const l = await B.doAction({ type: "list", list: null, items: [{ name: "Coffee", qty: 2 }, { name: "Bread", qty: null }] });
  assert.equal(l.done, true);
  assert.equal(store.model.items.length, items + 2);
  assert.equal(store.model.items.find(i => i.name === "Coffee").qty, 2);
  l.undo();
  assert.equal(store.model.items.length, items);

  const r = await B.doAction({ type: "reminder", title: "Pay rent", when: "monthly", monthDay: 14, weekday: null, date: null, hour: 9, note: null });
  const rem = store.model.reminders.find(x => x.title === "Pay rent");
  assert.equal(rem.when, "monthly"); assert.equal(rem.monthDay, 14); assert.equal(rem.hour, 9);
  r.undo(); assert.ok(!store.model.reminders.some(x => x.title === "Pay rent"));

  const g = await B.doAction({ type: "goal", name: "Sofa", target: 900, monthly: 75, targetDate: "2027-12-01" });
  assert.deepEqual((({ name, target, monthly, targetDate }) => ({ name, target, monthly, targetDate }))(store.model.goals.find(x => x.name === "Sofa")), { name: "Sofa", target: 900, monthly: 75, targetDate: "2027-12-01" });
  g.undo(); assert.ok(!store.model.goals.some(x => x.name === "Sofa"));

  const cat = store.model.categories.find(c => c.name === "Groceries"), before = cat.budget;
  const b = await B.doAction({ type: "budget", category: "groceries", amount: 320, was: before });
  assert.equal(store.model.categories.find(c => c.name === "Groceries").budget, 320);
  b.undo(); assert.equal(store.model.categories.find(c => c.name === "Groceries").budget, before);
});

test("each card says what it will do in words", () => {
  assert.deepEqual(B.describeAction({ type: "reminder", title: "Pay rent", when: "monthly", monthDay: 1, hour: 9 }).sub, "Every month on the 1st at 9:00");
  assert.equal(B.describeAction({ type: "expense", amount: 12.5, payee: "Alepa", category: "Groceries", date: "2027-03-10", fromNextPay: true }).sub, "Groceries · from your next pay");
  assert.equal(B.describeAction({ type: "bill", name: "Gym", amount: 39, frequency: "monthly", dueDay: 22, autopay: true }).sub, "Monthly, due on the 22nd · direct debit");
});

test("today's note is asked for once a day, then read from the phone", async () => {
  const calls = signedIn({ notes: ["Rent, €700, is due on Monday."], followUps: [], actions: [] });
  const a = await B.brief();
  const b = await B.brief();
  assert.deepEqual(a.notes, ["Rent, €700, is due on Monday."]);
  assert.deepEqual(b, a);
  assert.equal(calls.filter(c => c.name === "koti").length, 1);
  assert.equal(calls[0].body.mode, "brief");
  setToday("2027-03-11");
  assert.equal(B.cachedBrief(), null, "a new day, a new note");
  setToday("2027-03-10");
});

test("out of AI uses: today's note stops asking until tomorrow", async () => {
  setToday("2027-03-12");
  const calls = signedIn(() => ({ data: null, error: { message: "limit", context: { json: async () => ({ error: "That's today's 30 AI uses.", code: "limit" }) } } }));
  assert.equal(await B.brief(), null);
  assert.equal((await B.brief()).off, "limit");
  assert.equal(calls.length, 1);
  setToday("2027-03-10");
});

test("questions go to Koti; purchases don't", () => {
  for (const q of ["Can I afford a 200€ sofa?", "how much did I spend on coffee in October", "paljonko jäi ruokaan?", "should I move money to savings"]) assert.ok(B.looksLikeQuestion(q), q);
  for (const p of ["Lidl 23,40", "lunch at Picnic 11", "bought coffee and a bun", "I paid 11e from my salary for lunch"]) assert.ok(!B.looksLikeQuestion(p), p);
});

test("a question typed into the add box asks Koti, not the purchase reader", async () => {
  const calls = signedIn({ transcript: "", intent: "unclear", spend: null, range: null, items: [] });
  await Promise.resolve(C.handleTyped("Can I afford a 200€ sofa?")).catch(() => {});   // the conversation needs a page
  assert.ok(!calls.some(c => c.name === "hear"), "not read as a €200 purchase");
});

test("the shops used most help the microphone hear them", () => {
  const model = { transactions: [
    { payee: "Lidl", kind: "expense", date: "2027-03-01" }, { payee: "Lidl", kind: "expense", date: "2027-03-05" }, { payee: "Alepa", kind: "expense", date: "2027-03-02" },
    { payee: "Employer", kind: "income", date: "2027-03-01" }, { payee: "Old shop", kind: "expense", date: "2026-10-01" }] };
  assert.deepEqual(frequentPayees(model, "2027-03-10"), ["Lidl", "Alepa"]);
});
