// Three things added 9 November 2026:
//   Plan my month asks what decides the plan, one question to a screen, and offers to learn from the past only when
//   there is a past to learn from (js/budgetai.js planQuestions, planRequest).
//   Conversations with Koti are kept on this device for 30 days, in Earlier chats, instead of disappearing after six
//   hours (js/brain.js).
//   Koti's AI sends nothing until it's allowed on the device, as the EU's rules ask (js/privacy.js).
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const { sync } = await import("../js/sync.js");
const P = await import("../js/privacy.js");
const { aiPossible, aiOffReason } = await import("../js/receipts.js");
const { planQuestions, planRequest } = await import("../js/budgetai.js");
const B = await import("../js/brain.js");

const ctx = (extra = {}) => ({ income: 240000, bills: 90000, savings: 10000, spendable: 150000, monthsLookedAt: 3, goals: [{ name: "Holiday" }], categories: [], ...extra });

test("every question that decides the plan is asked, one at a time, each with room for your own words", () => {
  const ids = planQuestions(ctx()).map(q => q.id);
  assert.deepEqual(ids, ["pay", "bills", "basis", "save", "home", "food", "move", "big", "more"]);
  const qs = planQuestions(ctx());
  assert.match(qs[0].text, /€2,400/);
  assert.ok(qs.at(-1).freeOnly, "the last screen is only for your own words");
});

test("learning from the past is offered only when there is past spending", () => {
  assert.ok(!planQuestions(ctx({ monthsLookedAt: 0 })).some(q => q.id === "basis"));
  assert.equal(planQuestions(ctx({ monthsLookedAt: 1 })).find(q => q.id === "basis").options[0].label, "Yes, from last month");
});

test("no pay, no bills and no goals are asked about, not assumed", () => {
  const ids = planQuestions(ctx({ income: 0, bills: 0, savings: 0, goals: [], monthsLookedAt: 0 })).map(q => q.id);
  assert.deepEqual(ids, ["pay", "bills", "buffer", "goal", "home", "food", "move", "big", "more"]);
});

test("last time's household, food and transport are offered first", () => {
  const qs = planQuestions(ctx(), { home: "partner", food: "cook", move: "bike", pay: "other" });
  assert.equal(qs.find(q => q.id === "home").preset, "partner");
  assert.equal(qs.find(q => q.id === "pay").preset, undefined, "pay is asked fresh every month");
});

test("the answers change the figures they're about, and the rest goes to the planner in words", () => {
  const send = { income: 2400, bills: 900, spendable: 1500, monthsLookedAt: 3, categories: [{ name: "Groceries", average: 320 }] };
  const qs = planQuestions(ctx());
  const r = planRequest(send, qs, { pay: { v: "other", amount: 2600 }, bills: { v: "more", amount: 100 }, basis: { v: "fresh" }, food: { v: "cook", free: "vegetarian" }, more: { free: "Moving in March" } });
  assert.equal(r.context.income, 2600);
  assert.equal(r.context.bills, 1000);
  assert.equal(r.context.spendable, 1600);
  assert.equal(r.context.monthsLookedAt, 0);
  assert.equal(r.context.categories[0].average, null, "starting fresh: no history goes to the planner");
  assert.equal(send.income, 2400, "Koti's own figures are left alone");
  assert.deepEqual(r.answers.map(a => a.answer), ["It's a different amount: €2600", "There are more: €100", "No, start from my answers", "I cook at home: vegetarian", "Moving in March"]);
});

test("Koti's AI sends nothing until it's allowed on this device", () => {
  sync.user = { id: "u" }; sync.client = { functions: {} };
  localStorage.removeItem(P.CONSENT_KEY);
  assert.equal(P.consent(), null);
  assert.equal(aiPossible(), false);
  assert.match(aiOffReason("Koti"), /Switch it on in You → Privacy/);
  P.setConsent({ ai: false });
  assert.equal(aiPossible(), false, "Only necessary");
  P.setConsent({ ai: true });
  assert.equal(aiPossible(), true);
  assert.ok(P.STORED.length && P.SENT.some(([n]) => n === "OpenAI"), "what's kept and sent is listed");
});

test("conversations go to Earlier chats instead of disappearing, and can be opened again or deleted", () => {
  sync.user = { id: "u1" };
  B.saveConversation([{ role: "user", content: "How am I doing?" }, { role: "assistant", content: "Fine." }]);
  assert.equal(B.conversation().length, 2);
  setToday("2027-03-11");   // a day away: a new conversation starts, the old one is kept
  assert.deepEqual(B.conversation(), []);
  const past = B.pastConversations();
  assert.equal(past.length, 1);
  assert.equal(past[0].title, "How am I doing?");
  assert.equal(B.openConversation(past[0].id).length, 2);
  B.newConversation();
  B.deleteConversation(past[0].id);
  assert.equal(B.pastConversations().length, 0);
  setToday("2027-03-10");
});

test("a conversation is deleted 30 days after it was last used, and another account's are never shown", () => {
  sync.user = { id: "u1" };
  B.saveConversation([{ role: "user", content: "old one" }]); B.newConversation();
  sync.user = { id: "u2" };
  assert.equal(B.pastConversations().length, 0, "someone else on this device sees nothing of u1's");
  sync.user = { id: "u1" };
  assert.equal(B.pastConversations().length, 1);
  setToday("2027-04-15");
  assert.equal(B.pastConversations().length, 0);
  setToday("2027-03-10");
});
