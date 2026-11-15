// Signing up, 15 November 2026: eight questions come first, then Koti asks your name (making friends), and creating
// the account is the last step. The progress bar is gold and fills as you go; steps slide in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const O = read("js/onboarding.js"), C = read("css/app.css");

test("eight questions, then the name, then the account, last", () => {
  assert.match(O, /export const STEPS = \["why", "pay", "bills", "balance", "feel", "people", "goal", "nudges", "name", "learned", "account"\];/);
  const at = s => { const k = O.indexOf(s); assert.ok(k > 0, s); return k; };
  const titles = ["Hi, I'm Koti. What would make me worth it for you?", "Let's start with your pay", "What goes out every month?", "What does your bank say right now?",
    "How does the end of the month usually feel?", "Who shares your money life?", "Saving for something?", "How should I keep you on track?", "That's everything. What should I call you?", "} Here's how I'll work for you</h1>", "Let's keep it safe"];
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
  assert.match(C, /--gold:linear-gradient\(90deg,#F2A900 0%,#FFC93C 30%,#FFE58F 50%/, "honey gold, no brown ends");
  assert.match(C, /\.onb-prog i\{[^}]*background:var\(--gold\)[^}]*transition:width \.7s/);
  assert.match(C, /\.onb-tog\[aria-checked="true"\] i\{background:var\(--gold\)\}/);
  assert.match(O, /role="progressbar" aria-label="Step \$\{n \+ 1\} of \$\{all\}"/);
  assert.match(O, /bar\.style\.width = bar\.dataset\.to \+ "%"/);
  assert.match(C, /@keyframes onbIn/); assert.match(C, /@keyframes onbBack/); assert.match(C, /@keyframes onbWave/);
  assert.match(C, /@media \(prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/);
});

// "Koti learns and adjusts for you from the onboarding": the answers are a profile Koti works from, shown back to them
// as "Here's how I'll work for you", and sent with every question.
test("what Koti will do is worked out from their answers, and Koti is told to work that way", async () => {
  const { setToday, app } = await import("./_env.mjs");
  setToday("2026-11-15"); await app();
  const { planFor } = await import("../js/onboarding.js");
  const A = await import("../supabase/functions/koti/agent.js");
  const p = { why: ["spend", "bills", "home"], bills: 3, feel: "short", people: "partner", goal: { name: "Holiday", target: 1500 }, nudges: { bills: true, payday: true, weekly: true }, lang: "en" };
  const plan = planFor(p);
  assert.equal(plan.length, 5);
  assert.match(plan[0], /^Keep your daily number up top/);
  assert.equal(plan[1], "Set your 3 bills aside before anything else, and remind you the morning before each one.");
  assert.match(plan[2], /early heads-up when money's getting tight/);
  assert.equal(plan[3], "Track your holiday fund to €1,500, and show what to put aside each month.");
  assert.match(plan[4], /shared costs with your partner/);
  assert.match(planFor({ feel: "left", goal: { name: "Car", target: null } }).join(" "), /spare money that could go to your car fund/);
  assert.equal(planFor({}).length, 1, "nothing answered: still the daily number");
  const notes = A.profileNotes(p);
  assert.match(notes, /^\nHow they started with Koti/);
  assert.match(notes, /lead with today's amount/); assert.match(notes, /be careful with 'can I afford', warn early/); assert.match(notes, /share money with a partner/); assert.match(notes, /saving for: Holiday \(target €1500\)/);
  assert.equal(A.profileNotes(null), "");
  const M = A.modelFromRows({ settings: { monthStart: 1, profile: p } });
  assert.match(A.systemPrompt(M, "2026-11-15"), /How they started with Koti[^]*warn early/, "with every question, and today's note");
  const K = read("js/koti.js");
  assert.match(K, /startersFor\(store\.model\.settings\.profile, store\.model\.goals\)/, "the first questions to tap follow what they want");
  assert.match(K, /out\.push\(`How's my \$\{g\.toLowerCase\(\)\} fund doing\?`\)/);
  assert.match(O, /const saveProfile = patch => store\.updateSettings\(\{ profile:/);
});
