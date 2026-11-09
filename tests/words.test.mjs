// Koti's rule for words (the owner, 9 November 2026): a hint under a title is one short sentence. The scan screen's
// "Koti reads every line and sorts it for you: the milk to groceries, the lamp to your home project, a bill to
// Bills. A screenshot of a payment … works too. You check it before anything is saved." was 40 words; it's now 9.
// This reads every hint, note and subtitle written in the app's screens and fails over 14 words.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

export const MAX_WORDS = 14;
const dir = new URL("../js/", import.meta.url);
const HINTS = /class="(?:note|note ai-note|sc-p|kchat-sub|now-s|hint|sub|rv-s|heard-left)"[^>]*>([^<]{1,800})</g;

test(`every hint, note and subtitle is ${MAX_WORDS} words or fewer`, () => {
  const long = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith(".js") && !f.startsWith("vendor"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const m of src.matchAll(HINTS)) {
      if (m[1].includes("`")) continue;   // code inside the text, not words
      const words = m[1].replace(/\$\{[^}]*\}/g, "X").trim().split(/\s+/).filter(Boolean);
      if (words.length > MAX_WORDS) long.push(`${f}: ${words.length} words: ${m[1].trim().slice(0, 80)}…`);
    }
  }
  assert.deepEqual(long, [], "Shorten these to one short sentence");
});

test("the privacy banner and the first lines Koti says stay short", () => {
  const privacy = readFileSync(new URL("privacy.js", dir), "utf8"), koti = readFileSync(new URL("koti.js", dir), "utf8");
  const banner = /id="csP">([^<]+)</.exec(privacy)[1];
  assert.ok(banner.split(/\s+/).length <= MAX_WORDS, banner);
  for (const m of koti.matchAll(/"(Ask about your money[^"]*)"/g)) assert.ok(m[1].split(/\s+/).length <= MAX_WORDS, m[1]);
});
