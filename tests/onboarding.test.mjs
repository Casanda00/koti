// Signing up, 15 November 2026: eight questions come first, then Koti asks your name (making friends), and creating
// the account is the last step. The progress bar is gold and fills as you go; steps slide in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const O = read("js/onboarding.js"), C = read("css/app.css");

test("three questions, then the name (early, making friends), five more, then the account, last", () => {
  assert.match(O, /export const STEPS = \["why", "pay", "bills", "name", "balance", "feel", "people", "goal", "nudges", "learned", "account"\];/);
  const at = s => { const k = O.indexOf(s); assert.ok(k > 0, s); return k; };
  const titles = ["Hi, I'm Koti. What would make me worth it for you?", "Let's start with your pay", "What goes out every month?", "Before we go on, what should I call you?", "What does your bank say right now?",
    "How does the end of the month usually feel", "Who shares your money life?", "Saving for something", "How should I keep you on track?", "<h1>Here's how I'll work for you", "Let's keep it safe"];
  titles.forEach(at);   // each step's heading; their order is STEPS above
  assert.match(O, /const steps = \(\) => \(sync\.user \|\| !sync\.configured \? STEPS\.filter\(s => s !== "account"\) : STEPS\);/, "signed in already, or no server: no account step");
  assert.match(O, /data-later>Not now</, "the account can wait: everything stays on this phone");
  assert.match(O, /data-signin-first>Sign in</, "someone with an account can sign in before answering anything");
});

test("each answer lands somewhere Koti uses", () => {
  assert.match(O, /remember\(`Wants Koti's help with /, "what they want from Koti: remembered");
  assert.match(O, /FEEL\.filter\(\(\[v\]\) => st\.feel\.has\(v\)\)\.forEach\(\(\[, , m\]\) => remember\(m\)\)/, "how the month ends, every one that's true: remembered");
  assert.match(O, /remember\(PEOPLE\.find/, "who shares it: remembered");
  assert.match(O, /store\.put\("goals", \{ id: st\.ids\.goal, name: st\.goal, target: target \|\| null/, "what they save for: a goal");
  assert.match(O, /reminders: \{ \.\.\.R, bills: st\.nudge\.bills, payday: st\.nudge\.payday, weekly: st\.nudge\.weekly \}, voiceLang:/, "reminders and the language");
  assert.match(O, /if \(name\) store\.updateSettings\(\{ name, skinTone: st\.tone \}\);/, "the name is what Koti calls them");
  assert.match(O, /store\.put\("income", /); assert.match(O, /store\.put\("bills", /); assert.match(O, /setBalanceNow\(/);
  assert.match(O, /if \(st\.mode === "up"\) \{ const r = await signUp\(email, pw\); if \(r\.needsConfirm\) \{ st\.sent = true;/);
});

test("the blue progress bar fills as you go with the percentage counting up, and each step slides in (not with Reduce motion)", () => {
  assert.match(C, /--bar:linear-gradient\(90deg,#2442D6 0%,#3D63FF 35%,#8FA8FF 50%/, "Koti's blue (it was gold)");
  assert.doesNotMatch(C, /--gold/, "no gold left");
  assert.match(C, /\.onb-prog i\{[^}]*background:var\(--bar\)[^}]*transition:width \.7s/);
  assert.match(C, /\.onb\.lake \.onb-prog i\{background:linear-gradient\(90deg,#DCE3FF,#FFFFFF 50%/, "white on the blue screen");
  assert.match(C, /\.onb-tog\[aria-checked="true"\] i\{background:var\(--bar\)\}/);
  assert.match(O, /aria-label="Step \$\{n \+ 1\} of \$\{all\}, \$\{to\}% done"/);
  assert.match(O, /<span class="onb-pct" aria-hidden="true" data-from="\$\{from\}">\$\{from\}%<\/span>/, "the percentage, beside the bar");
  assert.match(O, /pct\.textContent = `\$\{Math\.round\(a \+ \(b - a\) \* e\)\}%`/, "counting up with the bar");
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

test("once they've given their name, Koti uses it, now and then", () => {
  assert.match(O, /head\(`\$\{by\("Thanks, ", "\. "\)\}What does your bank say right now\?`/);
  assert.match(O, /head\(`How does the end of the month usually feel\$\{by\(", "\)\}\?`/);
  assert.match(O, /head\("Saving for something\?",/, "not on every heading: it would feel forced");
  assert.match(O, /<h1>Here's how I'll work for you\$\{f \? `, \$\{f\}` : ""\}<\/h1>/);
  assert.match(O, /const first = \(\) => esc\(/, "the name is escaped once, where it's taken");
  assert.doesNotMatch(O, /esc\(f\)/, "and never twice");
  assert.doesNotMatch(O, /That's everything/, "the name isn't the last question any more");
});

test("bills: their own, not only the ones listed", () => {
  assert.match(O, /data-addbill>\+ Add your own</);
  assert.match(O, /chips\(\[\.\.\.BILLS, \.\.\.st\.custom\]/, "their own bills sit with the others");
  assert.match(O, /function addBill\(\) \{[^]*if \(!same\) st\.custom\.push\(name\);[^]*st\.picked\.add\(same \|\| name\)/, "added and picked; the same name twice is one bill");
  assert.match(O, /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); addBill\(\); \}/);
});

test("the end of the month: all that are true; their hand in their skin tone, and a handshake after their name", async () => {
  assert.match(O, /chips\(FEEL\.map\(\(\[v, t\]\) => \[v, t\]\), v => st\.feel\.has\(v\), "feel"\)/, "several can be picked");
  assert.match(O, /Pick all that are true/);
  assert.doesNotMatch(O, /s === "feel" \|\| s === "people"\) setTimeout/, "it doesn't move on after one tap any more");
  const { planFor } = await import("../js/onboarding.js");
  const both = planFor({ feel: ["left", "short"], goal: { name: "Car" } });
  assert.match(both[1], /early heads-up/); assert.match(both[2], /spare money that could go to your car fund/);
  const A = await import("../supabase/functions/koti/agent.js");
  const n = A.profileNotes({ feel: ["left", "varies"] });
  assert.match(n, /money left at the end of the month/); assert.match(n, /changes a lot/);
  assert.match(A.profileNotes({ feel: "short" }), /runs short/, "a profile from before (one answer) still reads");
  const { TONES } = await import("../js/onboarding.js");
  assert.deepEqual(TONES.map(t => t[1]), ["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"]);
  assert.match(O, /role="radio" class="onb-tone" data-tone="\$\{k\}" aria-checked="\$\{k === st\.tone\}" aria-label="\$\{label\}"/);
  assert.match(O, /store\.updateSettings\(\{ name, skinTone: st\.tone \}\)/);
  assert.match(O, /<span class="h-you">\$\{hand\("\\u\{1FAF1\}"\)\}<\/span><span class="h-koti">\\u\{1FAF2\}<\/span>/, "their hand in their tone meets Koti's");
  assert.match(C, /@keyframes onbYou/); assert.match(C, /@keyframes onbKoti/);
});
