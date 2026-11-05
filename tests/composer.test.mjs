// Typing into the box at the bottom: when signed in, a sentence or anything the phone's rules can't read goes to the
// AI. A local variable named "ask" hid the function that does that, so those entries did nothing at all (Koti 2.1 to
// 5 November 2026). These tests fail on that code with "ask is not a function".
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const { sync } = await import("../js/sync.js");
const C = await import("../js/composer.js");

function signedInWithAI() {
  const calls = [];
  sync.user = { id: "u" };
  sync.client = { functions: { invoke: async (name, { body }) => { calls.push({ name, text: body.text }); return { data: { transcript: body.text, intent: "unclear", spend: null, range: null, items: [] }, error: null }; } } };
  return calls;
}

test("a typed sentence with an amount goes to the AI", async () => {
  const calls = signedInWithAI();
  await Promise.resolve(C.handleTyped("I paid 11e from my salary for lunch")).catch(() => {});   // the sheet needs a page
  assert.deepEqual(calls, [{ name: "hear", text: "I paid 11e from my salary for lunch" }]);
});

test("typed words the phone can't read go to the AI", async () => {
  const calls = signedInWithAI();
  await Promise.resolve(C.handleTyped("bought coffee and a bun")).catch(() => {});
  assert.deepEqual(calls.map(c => c.text), ["bought coffee and a bun"]);
});
