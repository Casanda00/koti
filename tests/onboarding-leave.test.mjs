// Leaving the first-time questions half-way, 15 November 2026: not signed in, a few questions in, they wanted to stop and
// pressed Back again and again. The last Back landed on "Sign in" (in the same place on the first question), closing it
// opened the app, and the app showed "T" and "€267 over until payday": their name and a bill from the questions, saved
// one by one as they went, with no balance and no account. "This is not even my data." Now nothing is saved until the
// end, Back on the first question stays there, and someone who hasn't finished always gets the questions.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-15");

// A stand-in for the page: the questions' element, the sheet layer, the back gesture and the address.
const on = {};
window.addEventListener = (type, fn) => { on[type] = fn; };
const pushes = [];
globalThis.history = { state: null, pushState(s) { this.state = s; pushes.push(s); } };
globalThis.location = { hash: "", search: "", pathname: "/" };
globalThis.requestAnimationFrame = () => 0;
// an input as the page drew it: its value from the page, until typed into
const field = (html, id) => ({ value: ((new RegExp(`<input[^>]*id="${id}"[^>]*value="([^"]*)"`).exec(html)) || [])[1] || "", hidden: false, textContent: "", style: {}, dataset: {}, addEventListener() {}, setAttribute() {}, focus() {} });
let fields = {}, drawn = null;
const rows = {};
const el = { hidden: true, innerHTML: "", dataset: {}, scrollTop: 0, onclick: null, classList: { toggle() {}, add() {}, remove() {} }, insertAdjacentHTML() {},
  querySelector(sel) {
    if (drawn !== this.innerHTML) { fields = {}; drawn = this.innerHTML; }
    const m = /^#(\w+)$/.exec(sel); if (!m || !this.innerHTML.includes(`id="${m[1]}"`)) return null; return (fields[sel] = fields[sel] || field(this.innerHTML, m[1]));
  },
  querySelectorAll(sel) { return this.innerHTML.includes(sel.slice(1, -1)) ? rows[sel] || [] : []; } };
const layer = { hidden: true };
document.getElementById = id => (id === "onb" ? el : id === "layer" ? layer : null);
document.querySelector = sel => (sel === "#onb" ? el : null);
document.body = { classList: { add() {}, remove() {}, contains: () => false } };

const { store, seedModel } = await app();
const { sync } = await import("../js/sync.js");
const OB = await import("../js/onboarding.js");
sync.configured = true; sync.user = null;   // a server, and nobody signed in

const tap = (sel, dataset = {}) => el.onclick({ target: { closest: s => (s === sel ? { dataset, parentElement: { querySelectorAll: () => [] } } : null) } });
const type = (sel, v) => { el.querySelector(sel).value = v; };
const h1 = () => (/<h1>([^<]*)<\/h1>/.exec(el.innerHTML) || [])[1];
/* What a finger finds where Back is (top right), whatever that is on this question. */
const tapBackSpot = () => { const m = /class="onb-back" data-([\w-]+)/.exec(el.innerHTML); if (m) tap(`[data-${m[1]}]`); };
const fresh = () => { store.resetLocal(seedModel()); el.hidden = true; el.innerHTML = ""; delete rows["[data-amt]"]; delete rows["[data-dday]"]; };
const T = OB.TX.en;

/* Language, what matters, pay, a bill, reminders, the name (typed, then Later) and the balance. */
function answerSome() {
  tap("[data-lang]", { lang: "en" }); tap("[data-next]");
  tap("[data-why]", { why: "spend" }); tap("[data-next]");
  type("#obAmt", "2400"); tap("[data-next]");
  tap("[data-bill]", { bill: "Rent" }); tap("[data-next]");   // then how much and when, on its own screen
  assert.equal(h1(), T.howT);
  rows["[data-amt]"] = [{ dataset: { amt: "Rent" }, value: "267" }]; rows["[data-dday]"] = [{ dataset: { dday: "Rent" }, value: "20" }]; tap("[data-next]");
  tap("[data-next]");
  type("#obName", "Tero"); tap("[data-later]");
  type("#obBal", "100"); tap("[data-next]");
  assert.equal(h1(), T.feelT("Tero"));
}
const nothingSaved = () => {
  const m = store.model, S = m.settings;
  assert.equal(m.income.length, 0, "no pay"); assert.equal(m.bills.length, 0, "no bills"); assert.equal(m.goals.length, 0);
  assert.equal(S.name || "", "", "no name, so no initial in the corner"); assert.equal(S.startBalance ?? null, null, "no balance");
  assert.equal(S.profile, undefined); assert.equal((S.memory || []).length, 0); assert.ok(!S.setupDone);
  assert.equal(store.hasUserData(), false);
  assert.ok(!/"Tero"|2400/.test(localStorage.getItem("koti.model") || ""), "and nothing of it on the phone");
};

test("Back, Back, Back to the first question and once more: still the questions, nothing saved, never the app", () => {
  fresh(); OB.openOnboarding();
  answerSome();
  nothingSaved();
  for (let k = 0; k < 15; k++) tapBackSpot();
  assert.equal(el.hidden, false, "the questions are still open");
  assert.equal(h1(), T.langT, "on the first question");
  assert.doesNotMatch(el.innerHTML, /class="onb-back"/, "with nothing where Back was");
  assert.match(el.innerHTML, /class="onb-later" data-signin-first>Sign in</, "signing in is in the first question's foot instead");
  tap("[data-back]");
  assert.equal(h1(), T.langT, "Back there does nothing");
  nothingSaved();
  assert.equal(OB.shouldOnboard(), true, "opened again, it's the questions again");
});

test("the back gesture goes back a question, and on the first one stays there", () => {
  fresh(); OB.openOnboarding();
  assert.deepEqual(history.state, { onb: 1 }, "a step in the history to come back to");
  tap("[data-lang]", { lang: "en" }); tap("[data-next]");
  tap("[data-next]");
  assert.equal(h1(), T.payT);
  const n = pushes.length;
  on.popstate(); assert.equal(h1(), T.whyT);
  on.popstate(); assert.equal(h1(), T.langT);
  on.popstate(); assert.equal(h1(), T.langT, "nowhere further back to go, and not out of Koti");
  assert.equal(el.hidden, false); assert.equal(pushes.length, n + 3, "each time the step is put back");
  nothingSaved();
});

test("leaving half-way (the app closed) leaves nothing, so it's the questions next time", () => {
  fresh(); OB.openOnboarding(); answerSome();
  el.hidden = true;   // the app is closed
  nothingSaved();
  assert.equal(OB.shouldOnboard(), true);
});

test("at the end, everything answered is saved at once, and the app is theirs", () => {
  fresh(); OB.openOnboarding(); answerSome();
  tap("[data-feel]", { feel: "just" }); tap("[data-next]");
  tap("[data-pick]", { pick: "me" }); tap("[data-next]");
  tap("[data-next]");                                   // no goal
  assert.equal(h1(), T.sumT("Tero"));
  assert.match(el.innerHTML, /Rent €267/, "the summary is from the answers");
  nothingSaved();
  tap("[data-next]"); assert.equal(h1(), T.learnT("Tero"));
  tap("[data-next]"); assert.equal(h1(), T.privT);
  tap("[data-ai]", { ai: "no" }); assert.equal(h1(), T.accUpT("Tero"));
  nothingSaved();
  tap("[data-later]");                                  // the account: not now
  const m = store.model, S = m.settings;
  assert.equal(el.hidden, true); assert.equal(S.setupDone, true);
  assert.deepEqual(m.income.map(x => x.amount), [2400]);
  assert.deepEqual(m.bills.map(b => [b.name, b.amount, b.dueDay]), [["Rent", 267, 20]]);
  assert.equal(S.name, "Tero"); assert.equal(S.startBalance, 100);
  assert.deepEqual(S.profile.why, ["spend"]); assert.equal(S.profile.bills, 1); assert.equal(S.profile.people, "me");
  assert.equal(S.memory.length, 3, "what they want, how the month ends, who shares it");
  assert.equal(OB.shouldOnboard(), false);
});

test("answers an earlier version left half-way, on a phone not signed in: the questions again, from those answers, and no copies", () => {
  fresh();
  store.put("income", { name: "Salary", amount: 2400, frequency: "monthly", payDay: -1, active: true });
  store.put("bills", { name: "Rent", amount: 267, frequency: "monthly", dueDay: 20, active: true });
  store.updateSettings({ name: "Tero", profile: { lang: "en", why: ["spend"], bills: 1 } });
  store.meta.owner = null;
  assert.equal(OB.shouldOnboard(), true, "not finished, and not an account's data");
  OB.openOnboarding();
  tap("[data-next]"); assert.match(el.innerHTML, /data-why="spend" aria-pressed="true"/, "what they picked before");
  tap("[data-next]"); assert.match(el.innerHTML, /id="obAmt"[^>]*value="2400"/, "their pay");
  tap("[data-next]"); assert.match(el.innerHTML, /data-bill="Rent" aria-pressed="true"/, "their bill, already picked");
  tap("[data-next]"); assert.equal(h1(), T.howT);
  rows["[data-amt]"] = [{ dataset: { amt: "Rent" }, value: "267" }]; rows["[data-dday]"] = [{ dataset: { dday: "Rent" }, value: "20" }];
  tap("[data-next]");
  for (let k = 0; k < 20 && !el.hidden; k++) tap(h1() === T.privT ? "[data-ai]" : "[data-later]", { ai: "no" });   // the rest left as they were
  assert.equal(el.hidden, true); assert.equal(store.model.settings.setupDone, true);
  assert.deepEqual(store.model.income.map(x => x.amount), [2400], "the same pay, not a second"); assert.deepEqual(store.model.bills.map(b => b.amount), [267], "the same bill");
  store.meta.owner = "someone";
  store.updateSettings({ setupDone: false });
  assert.equal(OB.shouldOnboard(), false, "an account's data (signed in) isn't taken for half-way answers");
});
