// The microphone: hold to talk, let go to send, slide away to cancel (6 November 2026). It was tap to start and tap
// again to stop, which meant a second tap to aim for and recordings left running.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const C = await import("../js/composer.js");

test("letting go sends what was said", () => {
  assert.equal(C.releaseAction({ heldMs: 2000, away: false }), "send");
  assert.equal(C.releaseAction({ heldMs: C.HOLD.minMs, away: false }), "send");
});
test("a tap too short to be speech sends nothing, and says to hold", () => {
  assert.equal(C.releaseAction({ heldMs: 120, away: false }), "short");
});
test("sliding away cancels, however long it was held", () => {
  assert.equal(C.releaseAction({ heldMs: 5000, away: true }), "cancel");
  assert.equal(C.releaseAction({ heldMs: 50, away: true }), "cancel");
});
test("the button is wired for a finger, a keyboard and a screen reader", () => {
  const c = readFileSync(new URL("../js/composer.js", import.meta.url), "utf8");
  for (const ev of ["pointerdown", "pointermove", "pointerup", "pointercancel", "keydown", "keyup", "click", "contextmenu"]) assert.match(c, new RegExp(`addEventListener\\("${ev}"`), ev);
  assert.match(c, /setPointerCapture/, "letting go off the button still ends it");
  assert.match(c, /S\.released\) \{ S\.outcome = "cancel"/, "let go while the phone asked for the microphone: nothing is sent");
  assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /id="dockMic" aria-label="Hold to talk"/);
  assert.match(readFileSync(new URL("../css/app.css", import.meta.url), "utf8"), /#dockMic\{touch-action:none/, "a long press doesn't scroll or select");
});
