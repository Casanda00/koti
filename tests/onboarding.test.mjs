// Signing up, 15 November 2026: the questions come first (pay, bills, balance), then Koti asks your name (making
// friends), and creating the account is the last step. The progress bar is gold and fills as you go; steps slide in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const O = read("js/onboarding.js"), C = read("css/app.css");

test("the questions, then the name, then the account, last", () => {
  const at = s => { const k = O.indexOf(s); assert.ok(k > 0, s); return k; };
  assert.ok(at("Let's start with your pay") < at("What goes out every month?"));
  assert.ok(at("What goes out every month?") < at("One more. What does your bank say right now?"));
  assert.ok(at("One more. What does your bank say right now?") < at("I'm Koti. What should I call you?"));
  assert.ok(at("I'm Koti. What should I call you?") < at("Let's keep it safe"));
  assert.match(O, /const NAME = 3, ACCOUNT = 4;/);
  assert.match(O, /export const stepCount = \(\) => \(sync\.user \|\| !sync\.configured \? 4 : 5\);/, "signed in already, or no server: no account step");
  assert.match(O, /if \(name\) store\.updateSettings\(\{ name \}\);/, "the name is what Koti calls them");
  assert.match(O, /if \(st\.mode === "up"\) \{ const r = await signUp\(email, pw\); if \(r\.needsConfirm\) \{ st\.sent = true;/);
  assert.match(O, /else await signIn\(email, pw\);/);
  assert.match(O, /data-later>Not now</, "the account can wait: everything stays on this phone");
  assert.match(O, /data-signin-first>Sign in</, "someone with an account can sign in before answering anything");
});

test("the gold progress bar fills as you go, and each step slides in (not with Reduce motion)", () => {
  assert.match(C, /--gold:linear-gradient\(90deg,#8C6420/);
  assert.match(C, /\.onb-prog i\{[^}]*background:var\(--gold\)[^}]*transition:width \.7s/);
  assert.match(O, /role="progressbar" aria-label="Step \$\{n \+ 1\} of \$\{all\}"/);
  assert.match(O, /bar\.style\.width = bar\.dataset\.to \+ "%"/);
  assert.match(C, /@keyframes onbIn/); assert.match(C, /@keyframes onbBack/); assert.match(C, /@keyframes onbWave/);
  assert.match(C, /@media \(prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/);
});
