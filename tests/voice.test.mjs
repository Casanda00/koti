// Koti's voice (9 November 2026): it speaks only when spoken to, never to typing, in a natural voice made on the
// server; and in a hands-free conversation it notices when you've finished talking (makeVad) and listens again.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
import { shouldSpeak, speech } from "../supabase/functions/_shared/openai.js";
import { makeVad } from "../js/converse.js";
setToday("2027-03-10");
localStorage.setItem("koti.consent", JSON.stringify({ v: 1, ai: true, at: "2027-03-01T10:00:00Z" }));
const { sync } = await import("../js/sync.js");
const B = await import("../js/brain.js");

test("Koti speaks only when spoken to, and never when switched off", () => {
  assert.equal(shouldSpeak({ audio: true }), true, "a recording");
  assert.equal(shouldSpeak({ spoken: true }), true, "words the phone heard");
  assert.equal(shouldSpeak({}), false, "typed: never");
  assert.equal(shouldSpeak({ audio: true, settings: { kotiSpeaks: false } }), false, "switched off in You");
});

test("a typed question asks for no voice; words the phone heard do", async () => {
  const sent = [];
  sync.user = { id: "u" };
  sync.client = { functions: { invoke: async (n, { body }) => { sent.push(body); return { data: { reply: "€219 left.", speech: body.spoken ? "data:audio/mpeg;base64,AAA" : null, actions: [] }, error: null }; } } };
  const typed = await B.ask({ message: "how much is left?" });
  assert.equal(sent[0].spoken, undefined);
  assert.equal(typed.speech, null);
  const said = await B.ask({ message: "how much is left?", spoken: true });
  assert.equal(sent[1].spoken, true);
  assert.equal(said.speech, "data:audio/mpeg;base64,AAA");
});

test("the natural voice: OpenAI's speech, as MP3, in the person's language; none for an empty reply", async () => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, arrayBuffer: async () => new Uint8Array([73, 68, 51]).buffer }; };
  assert.equal(await speech({ fetch: f, key: "k", text: "Sinulla on 219 € jäljellä.", lang: "fi" }), "SUQz");
  assert.match(calls[0].url, /\/audio\/speech$/);
  assert.equal(calls[0].body.model, "gpt-4o-mini-tts");
  assert.equal(calls[0].body.response_format, "mp3");
  assert.match(calls[0].body.instructions, /Finnish/);
  assert.equal(await speech({ fetch: f, key: "k", text: "  " }), null);
  assert.equal(await speech({ fetch: async () => ({ ok: false }), key: "k", text: "Hi" }), null, "it fails quietly: the phone's voice reads it");
});

/* Sound levels every 50 ms: quiet room, then talking, then quiet. */
const run = (levels, o) => { const v = makeVad(o); let r; for (let i = 0; i < levels.length; i++) { r = v.push(levels[i], i * 50); if (r === "done" || r === "none") return { r, at: i * 50 }; } return { r }; };
const quiet = n => Array(n).fill(0.004), talk = n => Array.from({ length: n }, (_, i) => (i % 5 === 4 ? 0.01 : 0.08));

test("it knows when you've finished: about a second of quiet after talking", () => {
  const { r, at } = run([...quiet(10), ...talk(40), ...quiet(40)]);
  assert.equal(r, "done");
  assert.ok(at >= 2500 + 1000 && at <= 2500 + 1300, `finished at ${at} ms`);
});

test("a short pause mid-sentence doesn't end your turn", () => {
  const { r, at } = run([...quiet(10), ...talk(20), ...quiet(12), ...talk(20), ...quiet(40)]);
  assert.equal(r, "done");
  assert.ok(at > 2600, "it waited through the 600 ms pause");
});

test("saying nothing ends the conversation; a cough doesn't count as talking", () => {
  assert.equal(run(quiet(200)).r, "none");
  assert.equal(run([...quiet(10), 0.2, ...quiet(200)]).r, "none");
});

test("a noisy room raises what counts as talking", () => {
  const room = Array(200).fill(0.03);
  assert.equal(run(room).r, "none", "steady background noise isn't speech");
  assert.equal(run([...room.slice(0, 10), ...Array(30).fill(0.2), ...room]).r, "done");
});
