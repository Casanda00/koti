// What Koti says after a photo or a sentence comes from the AI, in its own words, not a fixed label such as
// "Here's what we heard" (removed 6 November 2026). The AI functions must ask for that reply and send it on, and
// without the AI the phone still answers in a sentence built from what it read.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const C = await import("../js/composer.js");
const cats = [{ id: "food", name: "Food" }, { id: "fun", name: "Fun" }];

test("without the AI, the sentence says what was read", () => {
  assert.equal(C.localReply({ amount: 11, payee: "Lidl", date: "2027-03-10", note: "lunch", categoryId: "food" }, cats), "€11.00 at Lidl for lunch, today.");
  assert.equal(C.localReply({ amount: 4.5, payee: null, date: "2027-03-10", note: null, categoryId: "fun" }, cats), "€4.50 on fun, today.");
});

test("without a category, it asks what it was for", () => {
  assert.match(C.localReply({ amount: 23.4, payee: "K-Market", date: "2027-03-08", categoryId: null }, cats), /^€23\.40 at K-Market, Monday\. What was it for\?$/);
});

for (const fn of ["hear", "read-receipt"]) {
  test(`the ${fn} function asks the AI for its reply and sends it on`, () => {
    const src = readFileSync(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), "utf8");
    assert.match(src, /required:\s*\[[^\]]*"reply"/, "the schema requires a reply");
    assert.match(src, /reply:\s*String\(/, "the response carries the reply");
  });
}

test("no fixed 'what we heard' label is left in the app", () => {
  for (const f of ["composer.js", "scan.js", "money.js"]) assert.doesNotMatch(readFileSync(new URL(`../js/${f}`, import.meta.url), "utf8"), /what we heard/i, f);
});
