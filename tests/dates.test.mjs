// The day a receipt or payment happened, read from what's printed (js/printeddate.js and its copy in read-receipt).
// Sunday's receipt, scanned on Monday, was saved on Monday (9 November 2026): the AI hadn't returned the date, a
// receipt that prints "SU 8.11." has no year, and the review filled in today without asking.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday } from "./_env.mjs";
import { printedDate, bestDate } from "../js/printeddate.js";
setToday("2026-11-09");
const { parseReceipt } = await import("../js/receipts.js");
const MON = "2026-11-09";

test("the server's copy is the app's, byte for byte", () => {
  const a = readFileSync(new URL("../js/printeddate.js", import.meta.url), "utf8"), b = readFileSync(new URL("../supabase/functions/read-receipt/printeddate.js", import.meta.url), "utf8");
  assert.ok(a === b, "copy js/printeddate.js to supabase/functions/read-receipt/printeddate.js");
});

test("dates as receipts print them", () => {
  assert.equal(printedDate("08.11.2026 14:02", MON), "2026-11-08");
  assert.equal(printedDate("8.11.26", MON), "2026-11-08");
  assert.equal(printedDate("2026-11-08", MON), "2026-11-08");
  assert.equal(printedDate("SU 8.11. 14:02", MON), "2026-11-08", "no year: the most recent 8 November");
  assert.equal(printedDate("31.12.", MON), "2025-12-31", "no year, and this year's is ahead: last year's");
  assert.equal(printedDate("8 Nov", MON), "2026-11-08");
  assert.equal(printedDate("8. marraskuuta", MON), "2026-11-08");
});

test("days as banking apps write them", () => {
  assert.equal(printedDate("Eilen 18:40", MON), "2026-11-08");
  assert.equal(printedDate("Yesterday", MON), "2026-11-08");
  assert.equal(printedDate("Tänään", MON), MON);
  assert.equal(printedDate("Su", MON), "2026-11-08", "a weekday: the most recent one");
  assert.equal(printedDate("lauantaina", MON), "2026-11-07");
  assert.equal(printedDate("Mon", MON), MON);
});

test("never a day that can't be: a misread date ahead, a 31 February, or nothing", () => {
  assert.equal(printedDate("31.02.2026", MON), null);
  assert.equal(printedDate("08.12.2026", MON), null, "a month ahead is a misreading");
  assert.equal(printedDate("", MON), null);
  assert.equal(printedDate("K-Market Kamppi", MON), null);
});

test("the AI's date is checked against what's printed", () => {
  assert.equal(bestDate("2026-11-08", "SU 8.11.", MON), "2026-11-08");
  assert.equal(bestDate(null, "SU 8.11.", MON), "2026-11-08", "the AI gave no date: read the printed one");
  assert.equal(bestDate("2025-11-08", "8.11.", MON), "2026-11-08", "the AI guessed last year for a date with no year");
  assert.equal(bestDate("2027-11-08", "08.11.2026", MON), "2026-11-08", "a date ahead loses to the printed one");
  assert.equal(bestDate(null, null, MON), null, "nothing printed: nothing guessed, and the app asks");
});

test("read on the phone, a receipt with no year in its date still gets its day", () => {
  assert.equal(parseReceipt("K-MARKET KAMPPI\nMAITO 1,29\nYHTEENSÄ 23,40\nSU 8.11. 14:02").date, "2026-11-08");
});
