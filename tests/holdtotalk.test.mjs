// Talking to Koti (design B, 6 November 2026): hold the microphone and a sheet rises with the words as they're said,
// Cancel to the left and Keep talking to the right. It was tap to start and tap again to stop.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
const T = await import("../js/talk.js");
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("letting go where you pressed sends what was said", () => {
  assert.equal(T.releaseAction({ heldMs: 2000, zone: T.zoneOf(5, -10) }), "send");
});
test("a tap too short to be speech sends nothing", () => {
  assert.equal(T.releaseAction({ heldMs: 120, zone: null }), "short");
});
test("slid left to Cancel: nothing is sent, however long it was held", () => {
  assert.equal(T.zoneOf(-80, 0), "cancel");
  assert.equal(T.releaseAction({ heldMs: 5000, zone: "cancel" }), "cancel");
  assert.equal(T.releaseAction({ heldMs: 50, zone: "cancel" }), "cancel");
});
test("slid right or up to Keep talking: it carries on hands free", () => {
  assert.equal(T.zoneOf(70, 0), "lock");
  assert.equal(T.zoneOf(0, -90), "lock");
  assert.equal(T.releaseAction({ heldMs: 900, zone: "lock" }), "lock");
});
test("a little wobble doesn't count as sliding", () => {
  assert.equal(T.zoneOf(-30, 20), null);
  assert.equal(T.zoneOf(40, -40), null);
});
test("the words show the last one fading, and stay short", () => {
  assert.deepEqual(T.wordsParts("lunch at Picnic eleven"), { said: "lunch at Picnic ", last: "eleven" });
  assert.deepEqual(T.wordsParts("lunch"), { said: "", last: "lunch" });
  const long = T.wordsParts("word ".repeat(60), 40);
  assert.ok((long.said + long.last).length <= 42 && long.said.startsWith("…"));
});
test("the button and the sheet are wired for a finger, a keyboard and a screen reader", () => {
  const t = read("js/talk.js");
  for (const ev of ["pointerdown", "pointermove", "pointerup", "pointercancel", "keydown", "keyup", "click", "contextmenu"]) assert.match(t, new RegExp(`addEventListener\\("${ev}"`), ev);
  assert.match(t, /setPointerCapture/);
  assert.match(t, /e\.key === "Escape"/, "Escape cancels");
  assert.match(t, /role", "dialog"/);
  assert.match(t, /if \(me\.released && !me\.locked\) me\.locked = true;/, "lifted while the phone asked for the microphone: it carries on hands free");
  for (const ev of ["touchstart", "touchmove", "touchend", "touchcancel"]) assert.match(t, new RegExp(`addEventListener\\("${ev}"`), ev);
  assert.match(t, /"touchcancel", e => \{ if \(touchOf\(e\)\) \{ finger = null; lastPointerUp = Date\.now\(\); interrupt\(\);/, "the phone taking the touch away doesn't cancel");
  assert.doesNotMatch(t, /pointercancel" && !S\.locked\) S\.zone = "cancel"/, "the old cancel-on-interruption is gone");
  assert.match(read("js/composer.js"), /initTalk\(mic, \{ send:/);
  assert.match(read("index.html"), /id="dockMic" aria-label="Hold to talk"/);
  assert.match(read("index.html"), /<symbol id="i-lock"/);
  assert.match(read("sw.js"), /"js\/talk\.js"/, "works offline after the first visit");
});
