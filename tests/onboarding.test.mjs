// Signing up, 15 November 2026, as it came together from the owner's comments: the language first (everything after
// follows it), what you want from Koti, your pay, your bills and their reminders, then your name early (a handshake in
// your skin tone, and Koti calls you by it), your balance, how the month ends (all that are true), who shares your
// money, what you're saving for, a summary to check and edit, what Koti will do for you, your data and Koti's AI, and
// last, the account. A blue bar with the percentage; each step slides in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-15");
await app();
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const O = read("js/onboarding.js"), C = read("css/app.css"), APP = read("js/app.js");
const OB = await import("../js/onboarding.js");
const A = await import("../supabase/functions/koti/agent.js");

test("the order: language, four questions, the name, five more, a summary, what Koti will do, privacy, the account", () => {
  assert.deepEqual(OB.STEPS, ["lang", "why", "pay", "bills", "nudges", "name", "balance", "feel", "people", "goal", "goalWhen", "summary", "learned", "privacy", "account", "home"]);
  assert.match(O, /!\(s === "account" && \(sync\.user \|\| !sync\.configured\)\) && !\(s === "goalWhen" && st && !st\.goal\)/, "no account step when signed in or with no server; the goal's date only with a goal");
  assert.match(O, /if \(steps\(\)\[step \+ 1\] === "home" \|\| step >= steps\(\)\.length - 1\) finish\(\); else advance\(\);/, "with no account step, privacy leads to the Home Screen or the end");
});

test("everything is said in both languages, with the same keys, and the language picked first is the one used after", () => {
  const keys = o => Object.keys(o).sort();
  assert.deepEqual(keys(OB.TX.fi), keys(OB.TX.en));
  assert.deepEqual(keys(OB.TX.fi.plan), keys(OB.TX.en.plan));
  assert.deepEqual(keys(OB.TX.fi.rows), keys(OB.TX.en.rows));
  for (const k of ["WHY", "FEEL", "PEOPLE"]) assert.deepEqual(OB.TX.fi[k].map(x => x[0]), OB.TX.en[k].map(x => x[0]), k);
  assert.equal(OB.TX.fi.BILLS.length, OB.TX.en.BILLS.length); assert.equal(OB.TX.fi.GOALS.length, OB.TX.en.GOALS.length); assert.equal(OB.TX.fi.TONES.length, 6);
  assert.equal(OB.TX.fi.balT("Antti"), "Paljonko tililläsi on juuri nyt?");
  assert.equal(OB.TX.en.balT("Antti"), "What does your bank say right now?", "no thanks: the handshake just said nice to meet you");
  assert.match(O, /const lg = t\.closest\("\[data-lang\]"\); if \(lg\) \{ st\.lang = lg\.dataset\.lang; store\.updateSettings\(\{ voiceLang:/, "and Koti speaks it");
  assert.match(O, /const L = \(\) => TX\[st && st\.lang === "fi" \? "fi" : "en"\];/);
});

test("Koti uses the name now and then once it's given, and says what it will do, in their language", () => {
  assert.equal(OB.TX.en.feelT("Antti"), "How does the end of the month usually feel, Antti?");
  assert.equal(OB.TX.en.goalT, "Saving for something?", "not on every heading: it would feel forced");
  assert.equal(OB.TX.en.learnT("Antti"), "Here's how we'll work together, Antti");
  assert.equal(OB.TX.en.meet("Antti"), "Nice to meet you, Antti");
  const p = { why: ["spend", "bills", "home"], bills: 3, feel: ["short", "left"], people: "partner", goal: { name: "Holiday", target: 1500 }, nudges: { bills: true, payday: true, weekly: true } };
  const en = OB.planFor(p);
  assert.equal(en.length, 5);
  assert.match(en[0], /^Keep your daily number up top/);
  assert.equal(en[1], "Set your 3 bills aside before anything else, and remind you the morning before each one.");
  assert.match(en[2], /early heads-up/); assert.match(en[3], /spare money that could go to your holiday fund/); assert.equal(en[4], "Track your holiday fund to €1,500, and show what to put aside each month.");
  const fi = OB.planFor(p, "fi");
  assert.equal(fi[1], "Varaan 3 laskuasi ennen mitään muuta ja muistutan edellisenä aamuna jokaisesta.");
  assert.match(fi[0], /^Pidän päivän summasi ylimpänä/);
  assert.match(fi.join(" "), /\(loma\), 1\s500\s€/, "the goal said in Finnish, not by the English name it's kept under");
  assert.equal(OB.planFor({}).length, 1, "nothing answered: still the daily number");
});

test("each answer lands somewhere Koti uses, and Koti is told how they started", () => {
  assert.match(O, /remember\(T\.whyMem\(/, "what they want from Koti");
  assert.match(O, /T\.FEEL\.filter\(\(\[v\]\) => st\.feel\.has\(v\)\)\.forEach\(\(\[, , m\]\) => remember\(m\)\)/, "how the month ends, every one that's true");
  assert.match(O, /saveProfile\(\{ people: st\.people \}\); remember\(/, "who shares it");
  assert.match(O, /store\.put\("goals", \{ id: st\.ids\.goal, name, target: target \|\| null/, "a goal, named in their language");
  assert.match(O, /reminders: \{ \.\.\.R, bills: st\.nudge\.bills, payday: st\.nudge\.payday, weekly: st\.nudge\.weekly \}/, "the reminders");
  assert.match(O, /store\.updateSettings\(\{ name, skinTone: st\.tone \}\)/, "the name and their hand");
  assert.match(O, /store\.put\("income", /); assert.match(O, /store\.put\("bills", /); assert.match(O, /setBalanceNow\(/);
  const n = A.profileNotes({ why: ["spend"], feel: ["left", "varies"], people: "partner", goal: { name: "Holiday", target: 1500 } });
  assert.match(n, /lead with today's amount/); assert.match(n, /money left at the end of the month/); assert.match(n, /changes a lot/); assert.match(n, /saving for: Holiday \(target €1500\)/);
  assert.match(A.profileNotes({ feel: "short" }), /runs short/, "a profile from before (one answer) still reads");
  assert.match(A.systemPrompt(A.modelFromRows({ settings: { monthStart: 1, profile: { feel: ["short"] } } }), "2026-11-15"), /How they started with Koti[^]*warn early/);
  assert.match(read("js/koti.js"), /startersFor\(store\.model\.settings\.profile, store\.model\.goals\)/, "the first questions to tap follow what they want");
});

test("bills: their own, not only the ones listed; the end of the month: all that are true", () => {
  assert.match(O, /data-addbill>\$\{T\.addOwn\}</);
  assert.match(O, /function addBill\(\) \{[^]*if \(!same\) st\.custom\.push\(name\);[^]*st\.picked\.add\(same \|\| name\)/, "added and picked; the same name twice is one bill");
  assert.match(O, /chips\(T\.FEEL\.map\(\(\[v, t\]\) => \[v, t\]\), v => st\.feel\.has\(v\), "feel"\)/, "several can be picked");
  assert.doesNotMatch(O, /s === "feel" \|\| s === "people"\) setTimeout/, "it doesn't move on after one tap");
});

test("their hand in their skin tone, and a handshake after their name", () => {
  assert.deepEqual(OB.TONES.map(t => t[1]), ["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"]);
  assert.match(O, /role="radio" class="onb-tone" data-tone="\$\{k\}" aria-checked="\$\{k === st\.tone\}"/);
  assert.match(O, /<span class="h-you">\$\{hand\("\\u\{1FAF1\}"\)\}<\/span><span class="h-koti">\\u\{1FAF2\}<\/span>/, "their hand in their tone meets Koti's");
  assert.match(C, /@keyframes onbYou/); assert.match(C, /@keyframes onbKoti/);
});

test("a summary to check, each answer editable (back to the question, then back to the summary)", () => {
  assert.match(O, /const ed = t\.closest\("\[data-edit\]"\); if \(ed\) \{ keepRows\(\); st\.back = "summary"; go\(ed\.dataset\.edit\);/);
  assert.match(O, /function advance\(\) \{ if \(st\.back && !\(id\(\) === "goal" && st\.goal\)\) \{ go\(st\.back\); st\.back = null; \} else step\+\+;/, "a goal changed from the summary goes through its date, then back");
  assert.deepEqual(Object.keys(OB.TX.en.rows), ["lang", "why", "pay", "bills", "nudges", "name", "balance", "feel", "people", "goal"], "every answer is on it");
});

test("privacy before the account: what Koti keeps and the AI choice, as a step instead of a banner over the first question", () => {
  assert.match(O, /setConsent\(\{ ai: ai\.dataset\.ai === "yes" \}\)/);
  assert.match(O, /data-ai="no">\$\{T\.privNo\}<\/button><button type="button" class="onb-go" data-ai="yes">\$\{T\.privYes\}/, "two answers, neither chosen for them");
  assert.match(O, /<a href="privacy\.html" target="_blank" rel="noopener">\$\{T\.privLink\}<\/a>/);
  assert.match(O, /if \(!consent\(\)\) showConsentBanner\(\);/, "they never got to it: the banner, after");
  assert.match(APP, /if \(!document\.body\.classList\.contains\("onb-open"\)\) showConsentBanner\(\);/, "not over the questions");
});

test("the blue progress bar fills as you go with the percentage counting up, and each step slides in (not with Reduce motion)", () => {
  assert.match(C, /--bar:linear-gradient\(90deg,#2442D6 0%,#3D63FF 35%,#8FA8FF 50%/, "Koti's blue");
  assert.doesNotMatch(C, /--gold/);
  assert.match(C, /\.onb\.lake \.onb-prog i\{background:linear-gradient\(90deg,#DCE3FF,#FFFFFF 50%/, "white on the blue screen");
  assert.match(O, /<span class="onb-pct" aria-hidden="true" data-from="\$\{from\}">\$\{from\}%<\/span>/);
  assert.match(O, /pct\.textContent = `\$\{Math\.round\(a \+ \(b - a\) \* e\)\}%`/);
  assert.match(C, /@keyframes onbIn/); assert.match(C, /@keyframes onbBack/);
  assert.match(C, /@media \(prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/);
});

// "Remember, it's not Koti only. It's both the user and Koti": we, where it's the two of them.
test("we, where Koti and the user decide together", () => {
  assert.equal(OB.TX.en.langT, "Which language shall we use?"); assert.equal(OB.TX.fi.langT, "Millä kielellä puhutaan?");
  assert.equal(OB.TX.en.langEn, "Let's talk in English"); assert.equal(OB.TX.fi.langFi, "Puhutaan suomea");
  assert.equal(OB.TX.en.nudgeT, "How shall we stay on track?"); assert.equal(OB.TX.fi.learnT("Antti"), "Näin teemme tätä yhdessä, Antti");
});

// "Next logical screen should ask when do you want to reach this goal?"
test("the goal's date: after the goal, what to put aside each month for it, and where it shows", () => {
  const today = new Date(2026, 10, 15);
  assert.deepEqual(OB.goalBy(6, 1500, today), { by: "2027-05-01", monthly: 250 });
  assert.deepEqual(OB.goalBy(12, 1000, today), { by: "2027-11-01", monthly: 84 }, "rounded up, so it's reached");
  assert.deepEqual(OB.goalBy(3, null, today), { by: "2027-02-01", monthly: null }, "no amount: a date only");
  assert.equal(OB.monthName("2027-05-01"), "May 2027"); assert.equal(OB.monthName("2027-05-01", "fi"), "toukokuu 2027");
  assert.deepEqual(OB.TX.fi.BY.map(x => x[0]), OB.TX.en.BY.map(x => x[0]));
  const p = { goal: { name: "Holiday", target: 1500, by: "2027-05-01", monthly: 250 } };
  assert.match(OB.planFor(p).join(" "), /Track your holiday fund to €1,500 by May 2027: about €250 a month\./);
  assert.match(OB.planFor(p, "fi").join(" "), /\(loma\), 1\s500\s€, toukokuu 2027 mennessä: noin 250\s€ kuukaudessa/);
  assert.match(O, /if \(g\) store\.put\("goals", \{ \.\.\.g, targetDate: by, monthly \}\);/, "the goal gets its date and monthly amount");
  assert.match(A.profileNotes(p), /saving for: Holiday \(target €1500, by 2027-05-01, about €250 a month\)\. Say whether they're on track/);
  assert.match(A.profileNotes({ goal: { name: "Car" } }), /saving for: Car\. Say whether/);
  assert.match(O, /saveProfile\(\{ goal: \{ \.\.\.\(store\.model\.settings\.profile \|\| \{\}\)\.goal, by, monthly \} \}\)/, "and Koti knows it");
});

test("shorter, plainer questions", () => {
  assert.equal(OB.TX.en.whyT, "What should we focus on?"); assert.match(OB.TX.en.whyP, /^Hi, I'm Koti\./);
  assert.equal(OB.TX.fi.whyT, "Mihin keskitytään?");
  assert.equal(OB.TX.en.payP, "", "no paragraph under the pay question");
  assert.match(O, /<label class="onb-l onb-q" for="obAmt">/, "the question itself in bold");
  assert.match(C, /\.onb-q\{font-size:19px;font-weight:700/);
  assert.equal(OB.TX.en.billsT, "What do you spend money on?"); assert.equal(OB.TX.fi.billsT, "Mihin käytät rahaa?");
});

// "Last will be to add to Home Screen to receive notifications. A short video guiding the user on it."
test("last: Koti on the Home Screen, with a guide that shows how, only where it can go there", () => {
  const I = read("js/install.js");
  assert.match(I, /export const wantsHomeStep = \(\) => !isNative\(\) && !isInstalled\(\) && !inAppBrowser\(\) && \(isIOS\(\) \|\| \/Android\/i\.test\(ua\) \|\| !!deferred\);/, "not in the phone app, not once installed, not on a computer that can't");
  assert.match(O, /!\(s === "home" && !\(st && st\.home\)\)/);
  assert.match(O, /function finish\(\) \{ if \(steps\(\)\.includes\("home"\) && id\(\) !== "home"\) \{ go\("home"\);/, "after the account (made, confirmed or left for later)");
  assert.match(O, /class="onb-guide \$\{ios \? "ios" : "and"\}" role="img" aria-label=/, "the guide, for iPhone or Android, described for screen readers");
  assert.match(O, /data-home="\$\{prompt \? "prompt" : "done"\}"/, "Android: the browser's own dialog, from our button");
  assert.match(C, /@keyframes gSheet/); assert.match(C, /@keyframes gIcon/);
  assert.match(O, /markSeen\(\);/); assert.match(I, /const tryShow = \(\) => \{ if \(read\(\)\.seen\) return;/, "and the install sheet doesn't come again after");
  assert.equal(OB.TX.fi.homeIos.length, 3); assert.equal(OB.TX.en.homeT, "One last thing: let's put Koti on your Home Screen");
});
