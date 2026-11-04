// What the add box reads from a typed phrase, before (and without) the AI.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
setToday("2026-11-04");
const { store } = await import("../js/data.js");
const { parseExpense } = await import("../js/voice.js");
const read = t => { const h = parseExpense(t, { categories: store.model.categories, history: [] }); return { ...h, category: (store.model.categories.find(c => c.id === h.categoryId) || {}).name }; };

test("where the money came from isn't taken as a shop", () => {
  const h = read("I paid 11e from my upcoming salary for lunch");
  assert.equal(h.amount, 11);
  assert.equal(h.payee, null);
  assert.equal(h.category, "Eating out");
  assert.equal(h.note, "lunch");
  assert.equal(read("15 from my card at Lidl").payee, "Lidl");
});
test("shops are still read", () => {
  assert.equal(read("Lidl 23,40").payee, "Lidl");
  assert.equal(read("coffee 4 at Fazer Cafe").payee, "Fazer Cafe");
});
