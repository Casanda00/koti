// The November screen starts from the bank (14 November 2026): it showed pay − bills as "living expenses" (2 109 €)
// and "2 109 € left to plan", which never matched the account. Now its one figure is the engine's "left until payday",
// made of the account balance less what's spoken for: the same number as Today.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../js/month.js", import.meta.url), "utf8");

test("the month's figure is what's in the account less what's spoken for, as Today says", () => {
  assert.match(src, /money\(L\.left\)/);
  assert.match(src, /In your account/);
  assert.match(src, /money\(L\.now\)/);
  for (const k of ["L.due", "L.aheadSum", "L.savingsDue"]) assert.ok(src.includes(`-${k}`), `${k} is taken off`);
});

test("no plan from the whole month's pay that the bank can't show", () => {
  for (const s of ["Living expenses", "left to plan", "Keep for", "billTotals", "incomeTotals"]) assert.ok(!src.includes(s), s);
});
