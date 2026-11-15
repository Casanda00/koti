// Signing up, 15 November 2026: eight questions come first, then Koti asks your name (making friends), and creating
// the account is the last step. The progress bar is gold and fills as you go; steps slide in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const O = read("js/onboarding.js"), C = read("css/app.css");

test("eight questions, then the name, then the account, last", () => {
  assert.match(O, /export const STEPS = \["why", "pay", "bills", "balance", "feel", "people", "goal", "nudges", "name", "account"\];/);
  const at = s => { const k = O.indexOf(s); assert.ok(k > 0, s); return k; };
  const titles = ["Hi, I'm Koti. What would make me worth it for you?", "Let's start with your pay", "What goes out every month?", "What does your bank say right now?",
    "How does the end of the month usually feel?", "Who shares your money life?", "Saving for something?", "How should I keep you on track?", "That's everything. What should I call you?", "Let's keep it safe"];
  titles.reduce((k, t) => { const n = at(t); assert.ok(n > k, `${t} comes after the one before`); return n; }, 0);
  assert.match(O, /const steps = \(\) => \(sync\.user \|\| !sync\.configured \? STEPS\.filter\(s => s !== "account"\) : STEPS\);/, "signed in already, or no server: no account step");
  assert.match(O, /data-later>Not now</, "the account can wait: everything stays on this phone");
  assert.match(O, /data-signin-first>Sign in</, "someone with an account can sign in before answering anything");
});

test("each answer lands somewhere Koti uses", () => {
  assert.match(O, /remember\(`Wants Koti's help with /, "what they want from Koti: remembered");
  assert.match(O, /remember\(FEEL\.find/, "how the month ends: remembered");
  assert.match(O, /remember\(PEOPLE\.find/, "who shares it: remembered");
  assert.match(O, /store\.put\("goals", \{ id: st\.ids\.goal, name: st\.goal, target: target \|\| null/, "what they save for: a goal");
  assert.match(O, /reminders: \{ \.\.\.R, bills: st\.nudge\.bills, payday: st\.nudge\.payday, weekly: st\.nudge\.weekly \}, voiceLang:/, "reminders and the language");
  assert.match(O, /if \(name\) store\.updateSettings\(\{ name \}\);/, "the name is what Koti calls them");
  assert.match(O, /store\.put\("income", /); assert.match(O, /store\.put\("bills", /); assert.match(O, /setBalanceNow\(/);
  assert.match(O, /if \(st\.mode === "up"\) \{ const r = await signUp\(email, pw\); if \(r\.needsConfirm\) \{ st\.sent = true;/);
});

test("the gold progress bar fills as you go, and each step slides in (not with Reduce motion)", () => {
  assert.match(C, /--gold:linear-gradient\(90deg,#8C6420/);
  assert.match(C, /\.onb-prog i\{[^}]*background:var\(--gold\)[^}]*transition:width \.7s/);
  assert.match(C, /\.onb-tog\[aria-checked="true"\] i\{background:var\(--gold\)\}/);
  assert.match(O, /role="progressbar" aria-label="Step \$\{n \+ 1\} of \$\{all\}"/);
  assert.match(O, /bar\.style\.width = bar\.dataset\.to \+ "%"/);
  assert.match(C, /@keyframes onbIn/); assert.match(C, /@keyframes onbBack/); assert.match(C, /@keyframes onbWave/);
  assert.match(C, /@media \(prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/);
});
