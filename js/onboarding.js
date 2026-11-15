// First time: three questions, then Koti asks your name (making friends: from there it calls you by it), five more
// questions, what Koti will do for you, and last, creating the account
// (15 November 2026: the questions come before signing up, signing up is the last step, and the questions are
// fuller: what you want from Koti, your pay, your bills, your balance, how the month usually ends, who shares your
// money, what you're saving for, and how Koti should keep you on track).
// Each answer is saved as you go, so "Later" keeps what was already answered. What isn't a record (what you want, how
// the month feels, who shares it) goes into what Koti remembers about you, so it talks to you with it from day one.
// Signed in already, or no server: no account step. The progress bar is gold and fills as you go; each step slides in
// (none with Reduce motion).
import { store } from "./data.js";
import { $, $$, esc, parseMoney, toast } from "./ui.js";
import { sync, signUp, signIn } from "./sync.js";
import { setBalanceNow } from "./money.js";
import { payDateFor, LAST_WORKING_DAY, LAST_DAY } from "./paydays.js";
import { remember } from "./brain.js";

const BILLS = ["Rent", "Electricity", "Water", "Phone", "Internet", "Home insurance", "Netflix", "Spotify", "Gym", "Travel card", "Loan"];
/* The questions that aren't records: what's picked goes into Koti's memory, in these words. */
export const WHY = [["spend", "Know what I can spend each day", "knowing what they can spend each day"], ["bills", "Stop bills catching me out", "not being caught out by bills"], ["save", "Save for something", "saving for something"],
  ["home", "Set up a new home", "setting up a new home"], ["shared", "Keep track of shared costs", "keeping track of shared costs"], ["where", "See where my money goes", "seeing where their money goes"]];
export const FEEL = [["left", "There's usually some left", "Usually has some money left at the end of the month."], ["just", "It just about makes it", "Money usually just about lasts to the end of the month."],
  ["short", "It often runs short", "Money often runs short before payday: be careful with it."], ["varies", "It changes a lot", "How the month ends changes a lot from month to month."]];
export const PEOPLE = [["me", "Just me", "Manages money on their own."], ["partner", "Me and a partner", "Shares money with a partner."], ["family", "A family with children", "Has a family with children."], ["flat", "Flatmates", "Lives with flatmates and shares some costs."]];
export const GOALS = ["Holiday", "Emergency fund", "New home", "Car", "Something else"];
/* The steps, in order. */
export const STEPS = ["why", "pay", "bills", "name", "balance", "feel", "people", "goal", "nudges", "learned", "account"];
/* What Koti will do for them, from their answers: shown on "Here's how I'll work for you", at most five lines. The
   same answers (settings.profile) go to Koti with every question, so it really works this way. */
export function planFor(p = {}) {
  const out = [], why = new Set(p.why || []), goal = p.goal && p.goal.name;
  out.push(why.has("spend") || !why.size ? "Keep your daily number up top: what's yours to spend each day until payday." : "Work out what's yours to spend each day until payday.");
  if (p.bills || why.has("bills")) out.push(`Set ${p.bills ? `your ${p.bills} ${p.bills === 1 ? "bill" : "bills"}` : "your bills"} aside before anything else${p.nudges && p.nudges.bills ? ", and remind you the morning before each one" : ""}.`);
  const feel = { short: "Give you an early heads-up when money's getting tight, and help you find where to slow down.", just: "Tell you when payday is close and what's left until then.",
    left: `Point out spare money${goal ? ` that could go to your ${goal.toLowerCase()} fund` : " you could put aside"}.`, varies: "Watch for the months that run short, and warn you before they do." }[p.feel];
  if (feel) out.push(feel);
  if (goal) out.push(`Track your ${goal === "Something else" ? "savings goal" : `${goal.toLowerCase()} fund`}${p.goal.target ? ` to €${Number(p.goal.target).toLocaleString("en-GB")}` : ""}, and show what to put aside each month.`);
  if (p.people && p.people !== "me") out.push({ partner: "Keep shared costs with your partner in mind when we talk.", family: "Keep the whole family's costs in mind when we talk.", flat: "Keep costs you share with flatmates in mind when we talk." }[p.people]);
  if (why.has("home")) out.push("Keep your Home setup close: rooms, what's bought and what's left.");
  if (why.has("where")) out.push("Show you where your money goes, by category, every week.");
  if (p.nudges && p.nudges.weekly) out.push("Send you a short summary on Sunday evenings.");
  return out.filter(Boolean).slice(0, 5);
}
const nextMonthStart = () => { const d = new Date(); const n = new Date(d.getFullYear(), d.getMonth() + 1, 1); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`; };
const longDay = d => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
let el = null, step = 0, st = null, dir = 1;
/* The steps shown: the account is left out when signed in already, or with no server. */
const steps = () => (sync.user || !sync.configured ? STEPS.filter(s => s !== "account") : STEPS);
export const stepCount = () => steps().length;
const id = () => steps()[step];

export function shouldOnboard() {
  const S = store.model.settings, m = store.model;
  return !S.setupDone && !m.income.length && !m.bills.length && !(S.startDate && S.startBalance != null);
}
export function openOnboarding() {
  const S = store.model.settings, R = S.reminders || {};
  el = $("#onb"); step = 0; dir = 1;
  st = { why: new Set(), amount: "", when: LAST_WORKING_DAY, day: 25, picked: new Set(), amounts: {}, days: {}, balance: "", feel: null, people: null, goal: null, goalAmt: "",
    nudge: { bills: R.bills !== false, payday: R.payday !== false, weekly: !!R.weekly }, lang: String(S.voiceLang || "en-GB").startsWith("fi") ? "fi" : "en",
    name: S.name || "", email: "", mode: "up", sent: false, ids: {} };
  el.hidden = false; document.body.classList.add("onb-open"); paint();
}
/* Data arrived from another device while the questions were open: they're already answered there. */
export function dismissIfAnswered() {
  if (!el || el.hidden || shouldOnboard()) return;
  if (store.model.income.some(x => x.id !== (st && st.ids.income))) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); }
}
function close() { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); store.updateSettings({ setupDone: true }); location.hash = "#now"; }

/* The gold bar: how far along, filling smoothly from the step before (the width is set after it's drawn). */
function progress() { const all = stepCount(), n = step; return `<div class="onb-prog" role="progressbar" aria-label="Step ${n + 1} of ${all}" aria-valuemin="1" aria-valuemax="${all}" aria-valuenow="${n + 1}"><i style="width:${Math.round(((n + 1 - dir) / all) * 100)}%" data-to="${Math.round(((n + 1) / all) * 100)}"></i></div>`; }
const back = () => (step > 0 ? `<button type="button" class="onb-back" data-back>Back</button>` : sync.configured && !sync.user ? `<button type="button" class="onb-back" data-signin-first>Sign in</button>` : "");
const head = (title, sub) => `<div class="onb-in">${progress()}${back()}<h1>${title}</h1>${sub ? `<p class="onb-p">${sub}</p>` : ""}`;
const radios = (name, opts, cur) => `<div class="onb-opts" role="radiogroup" aria-label="${esc(name)}">${opts.map(([v, t, s]) => `<button type="button" role="radio" class="onb-opt" data-pick="${esc(String(v))}" aria-checked="${String(cur) === String(v)}"><i aria-hidden="true"></i><span><b>${esc(t)}</b>${s ? `<small>${esc(s)}</small>` : ""}</span></button>`).join("")}</div>`;
const chips = (opts, on, key) => `<div class="onb-chips">${opts.map(([v, t]) => `<button type="button" class="onb-chip${v === st.just ? " just" : ""}" data-${key}="${esc(v)}" aria-pressed="${on(v)}">${esc(t)}</button>`).join("")}</div>`;
const toggle = (key, t, s, on) => `<button type="button" role="switch" class="onb-tog" data-nudge="${key}" aria-checked="${on}"><span><b>${esc(t)}</b><small>${esc(s)}</small></span><i aria-hidden="true"></i></button>`;
const foot = label => `<div class="onb-foot"><button type="button" class="onb-later" data-later>Later</button><button type="button" class="onb-go" data-next>${label}</button></div>`;
const tail = label => `<p class="onb-msg" id="obMsg" aria-live="polite"></p>${foot(label)}</div>`;
const first = () => esc(String(st.name || "").trim().split(/\s+/)[0]);
/* Their name in a heading once they've given it: "Thanks, Antti." / ", Antti?" (nothing before). */
const by = (before, after = "") => (first() ? `${before}${first()}${after}` : "");
const focus = sel => setTimeout(() => { const f = el && $(sel, el); if (f) f.focus(); }, 60);

function paint() {
  const now = new Date(), s = id();
  el.classList.toggle("lake", s === "balance");
  el.dataset.dir = dir > 0 ? "fwd" : dir < 0 ? "back" : "stay";   // a redraw within a step doesn't slide
  if (s === "why") {
    el.innerHTML = head("Hi, I'm Koti. What would make me worth it for you?", "Pick as many as you like. I'll keep them in mind when we talk, and show you what matters to you first.")
      + chips(WHY.map(([v, t]) => [v, t]), v => st.why.has(v), "why") + tail("Next: your pay");
  } else if (s === "pay") {
    const opts = [[LAST_WORKING_DAY, "Last working day of the month", `This month that's ${longDay(payDateFor(LAST_WORKING_DAY, now.getFullYear(), now.getMonth()))}`], [LAST_DAY, "Last day of the month", ""], ["date", "The same date every month", ""], ["varies", "It changes", "I'll ask when it lands"]];
    el.innerHTML = head("Let's start with your pay", "Your take-home pay, after tax: what actually lands in your account. Everything I work out starts from here.")
      + `<label class="onb-l" for="obAmt">What lands in your account each month</label>
      <input class="onb-amt num" id="obAmt" inputmode="decimal" placeholder="€0" value="${esc(st.amount)}" autocomplete="off">
      <p class="onb-l" id="obWhen">And when does it land?</p>${radios("When your pay lands", opts, st.when)}
      <label class="onb-day" id="obDayRow" ${st.when === "date" ? "" : "hidden"}>On day <select id="obDay">${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${k + 1 === st.day ? " selected" : ""}>${k + 1}</option>`).join("")}</select></label>`
      + tail("Next: your bills");
    focus("#obAmt");
  } else if (s === "bills") {
    el.innerHTML = head("What goes out every month?", "Tap the bills you pay, then add the amount and the day each one is due. I'll set that money aside before telling you what's yours to spend. Anything due before today starts next month.")
      + chips(BILLS.map(n => [n, n]), n => st.picked.has(n), "bill")
      + `<div class="onb-rows">${[...st.picked].map(n => `<div class="onb-row"><span>${esc(n)}</span><input inputmode="decimal" placeholder="€0" aria-label="${esc(n)} amount" data-amt="${esc(n)}" value="${esc(st.amounts[n] || "")}"><select aria-label="${esc(n)} is due on day" data-dday="${esc(n)}">${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${k + 1 === (st.days[n] || 1) ? " selected" : ""}>Day ${k + 1}</option>`).join("")}</select></div>`).join("")}</div>`
      + tail("Next: your balance");
  } else if (s === "balance") {
    el.innerHTML = head(`${by("Thanks, ", ". ")}What does your bank say right now?`, "Open your bank app and copy the number over. You only do this once: from here I keep count with you.")
      + `<label class="sr" for="obBal">Money in your account today</label>
      <input class="onb-amt big num" id="obBal" inputmode="decimal" placeholder="€0" value="${esc(st.balance)}" autocomplete="off">
      <p class="onb-p">With your pay, your bills and this, I work out how much is yours to spend every day.</p>` + tail("Next");
    focus("#obBal");
  } else if (s === "feel") {
    el.innerHTML = head(`How does the end of the month usually feel${by(", ")}?`, "No wrong answer. It helps me know when to cheer you on and when to give you a gentle heads-up.")
      + radios("How the month usually ends", FEEL.map(([v, t]) => [v, t]), st.feel) + tail("Next");
  } else if (s === "people") {
    el.innerHTML = head("Who shares your money life?", "So I can talk about shared bills and costs the way they really work in your home.")
      + radios("Who you share money with", PEOPLE.map(([v, t]) => [v, t]), st.people) + tail("Next");
  } else if (s === "goal") {
    el.innerHTML = head("Saving for something?", "Pick one and, if you know it, how much you'd like to have. I'll show how close you are and what to put aside each month.")
      + chips(GOALS.map(g => [g, g]), g => st.goal === g, "goal")
      + (st.goal ? `<label class="onb-l" for="obGoalAmt">How much for ${esc(st.goal === "Something else" ? "it" : st.goal.toLowerCase())}?</label>
      <input class="onb-amt num" id="obGoalAmt" inputmode="decimal" placeholder="€0" value="${esc(st.goalAmt)}" autocomplete="off">` : "")
      + tail(st.goal ? "Next" : "Not right now");
    if (st.goal && dir === 0) focus("#obGoalAmt");
  } else if (s === "nudges") {
    el.innerHTML = head("How should I keep you on track?", "I'll only nudge you for what you switch on here, and you can change it any time in You.")
      + `<div class="onb-togs">${toggle("bills", "Before a bill is due", "A reminder the day before, so nothing catches you out", st.nudge.bills)}${toggle("payday", "On payday", "What's yours to spend for the month ahead", st.nudge.payday)}${toggle("weekly", "A Sunday summary", "How the week went, in one short note", st.nudge.weekly)}</div>
      <p class="onb-l" id="obLang">And which language should I speak?</p>${radios("Koti's language", [["en", "English", ""], ["fi", "Suomi", "Puhun suomea"]], st.lang)}`
      + tail("Next");
  } else if (s === "name") {
    el.innerHTML = `<div class="onb-in">${progress()}${back()}
      <div class="onb-hi" aria-hidden="true"><span class="onb-wave">👋</span></div>
      <h1>Before we go on, what should I call you?</h1>
      <p class="onb-p">So we can be on first-name terms. I'll use it from here on, and whenever we talk about your money.</p>
      <label class="sr" for="obName">Your first name</label>
      <input class="onb-amt onb-name" id="obName" placeholder="Your name" value="${esc(st.name)}" maxlength="40" autocomplete="given-name" autocapitalize="words" enterkeyhint="next">`
      + tail("Nice to meet you");   // then the balance: "Thanks, Antti. What does your bank say right now?"
    focus("#obName");
    $("#obName", el).addEventListener("keydown", e => { if (e.key === "Enter") { keepRows(); next(false); } });
  } else if (s === "learned") {
    const f = first(), plan = planFor(store.model.settings.profile || {});
    el.innerHTML = `<div class="onb-in">${progress()}${back()}
      <h1>Here's how I'll work for you${f ? `, ${f}` : ""}</h1>
      <p class="onb-p">From what you've told me. I'll keep learning as we go, and you can change any of it in You.</p>
      <ul class="onb-plan">${plan.map((t, k) => `<li style="--k:${k}"><i aria-hidden="true"></i><span>${esc(t)}</span></li>`).join("")}</ul>
      <div class="onb-foot"><button type="button" class="onb-go" data-next>${steps().includes("account") ? "Sounds good" : "Show me my month"}</button></div></div>`;
  } else {
    const f = first();
    el.innerHTML = st.sent ? `<div class="onb-in">${progress()}
      <div class="onb-hi" aria-hidden="true"><span class="onb-pop">✉️</span></div>
      <h1>Check your email${f ? `, ${f}` : ""}</h1>
      <p class="onb-p">Open the link we sent to <b>${esc(st.email)}</b> to confirm it. Then sign in on any device and everything you've set up comes with you.</p>
      <p class="onb-p">Until then, I keep it all on this phone.</p>
      <div class="onb-foot"><button type="button" class="onb-go" data-done>Show me my month</button></div></div>`
    : `<div class="onb-in">${progress()}${back()}
      <h1>${st.mode === "up" ? `Let's keep it safe${f ? `, ${f}` : ""}` : `Welcome back${f ? `, ${f}` : ""}`}</h1>
      <p class="onb-p">${st.mode === "up" ? "Create your account and everything you've told me is saved, on every device you sign in on." : "Sign in, and what's in your account comes to this phone."}</p>
      <div class="onb-form">
        <label class="onb-l" for="obEmail">Email</label>
        <input class="onb-field" id="obEmail" type="email" inputmode="email" autocomplete="email" spellcheck="false" value="${esc(st.email)}" enterkeyhint="next">
        <label class="onb-l" for="obPass">Password</label>
        <input class="onb-field" id="obPass" type="password" autocomplete="${st.mode === "up" ? "new-password" : "current-password"}" minlength="8" enterkeyhint="go">
        <p class="onb-hint">${st.mode === "up" ? "At least 8 characters. We'll email you to confirm the address." : ""}</p>
        <button type="button" class="onb-switch" data-switch>${st.mode === "up" ? "I already have an account" : "Create a new account instead"}</button>
      </div>
      <p class="onb-msg" id="obMsg" aria-live="polite"></p>
      <div class="onb-foot"><button type="button" class="onb-later" data-later>Not now</button><button type="button" class="onb-go" data-next>${st.mode === "up" ? "Create account" : "Sign in"}</button></div></div>`;
    if (!st.sent) { focus(st.email ? "#obPass" : "#obEmail"); $("#obPass", el).addEventListener("keydown", e => { if (e.key === "Enter") { keepRows(); next(false); } }); }
  }
  // the gold bar fills to this step, and the step slides in
  requestAnimationFrame(() => { const bar = el && $(".onb-prog i", el); if (bar) bar.style.width = bar.dataset.to + "%"; });
  el.onclick = onClick;
  if (dir !== 0) el.scrollTop = 0;
}

/* A tap: choices redraw the step in place (no slide); Back, Later and Next move. */
function onClick(e) {
  const t = e.target, again = (just = null) => { keepRows(); st.just = just; dir = 0; paint(); st.just = null; };
  if (t.closest("[data-signin-first]")) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); import("./more.js").then(m => m.openAuth("in")); return; }
  if (t.closest("[data-done]")) { close(); return; }
  if (t.closest("[data-switch]")) { st.mode = st.mode === "up" ? "in" : "up"; again(); return; }
  const w = t.closest("[data-why]"); if (w) { const v = w.dataset.why; st.why.has(v) ? st.why.delete(v) : st.why.add(v); again(v); return; }
  const b = t.closest("[data-bill]"); if (b) { const n = b.dataset.bill; st.picked.has(n) ? st.picked.delete(n) : st.picked.add(n); again(n); return; }
  const g = t.closest("[data-goal]"); if (g) { st.goal = st.goal === g.dataset.goal ? null : g.dataset.goal; again(st.goal); return; }
  const n = t.closest("[data-nudge]"); if (n) { st.nudge[n.dataset.nudge] = !st.nudge[n.dataset.nudge]; n.setAttribute("aria-checked", st.nudge[n.dataset.nudge]); return; }
  const p = t.closest("[data-pick]");
  if (p) {
    const v = p.dataset.pick, s = id();
    if (s === "pay") { st.when = isNaN(Number(v)) ? v : Number(v); $("#obDayRow", el).hidden = st.when !== "date"; }
    else if (s === "nudges") st.lang = v;
    else st[s] = v;
    $$("[data-pick]", p.parentElement).forEach(x => x.setAttribute("aria-checked", x === p));
    if (s === "feel" || s === "people") setTimeout(() => { if (id() === s) next(false); }, 320);   // one choice: on to the next question
    return;
  }
  if (t.closest("[data-back]")) { keepRows(); step--; dir = -1; paint(); return; }
  if (t.closest("[data-later]")) { keepRows(); next(true); return; }
  if (t.closest("[data-next]")) { keepRows(); next(false); }
}
/* What they told Koti, as a profile Koti reads with every question (settings.profile). */
const saveProfile = patch => store.updateSettings({ profile: { ...(store.model.settings.profile || {}), ...patch, at: new Date().toISOString().slice(0, 10) } });
function msg(t) { const m = $("#obMsg", el); if (m) m.textContent = t; }
function keepRows() {
  const v = sel => { const x = $(sel, el); return x ? x.value : null; };
  if (v("#obAmt") != null) st.amount = v("#obAmt");
  if (v("#obDay") != null) st.day = Number(v("#obDay"));
  if (v("#obBal") != null) st.balance = v("#obBal");
  if (v("#obGoalAmt") != null) st.goalAmt = v("#obGoalAmt");
  if (v("#obName") != null) st.name = v("#obName");
  if (v("#obEmail") != null) st.email = v("#obEmail").trim();
  $$("[data-amt]", el).forEach(i => { st.amounts[i.dataset.amt] = i.value; });
  $$("[data-dday]", el).forEach(s => { st.days[s.dataset.dday] = Number(s.value); });
}

function next(later) {
  const s = id();
  if (s === "why" && !later && st.why.size) saveProfile({ why: [...st.why] });
  if (s === "why" && !later && st.why.size) remember(`Wants Koti's help with ${WHY.filter(([v]) => st.why.has(v)).map(([, , m]) => m).join(", ")}.`);
  if (s === "pay" && !later) {
    const amount = parseMoney(st.amount);
    if (st.when !== "varies" && (!amount || Number.isNaN(amount))) return msg("Type what lands, like 2400. Or tap Later.");
    const payDay = st.when === "date" ? st.day : st.when === "varies" ? LAST_DAY : st.when;
    st.ids.income = store.put("income", { id: st.ids.income, name: "Salary", amount: amount || null, frequency: st.when === "varies" ? "varies" : "monthly", payDay, active: true, position: store.model.income.length }).id;
  }
  if (s === "bills" && !later) {
    const missing = [...st.picked].filter(n => { const v = parseMoney(st.amounts[n]); return !v || Number.isNaN(v); });
    if (missing.length) return msg(`Add an amount for ${missing.join(", ")}, or tap it again to take it off.`);
    if (st.picked.size) saveProfile({ bills: st.picked.size });
    [...st.picked].forEach((n, k) => { st.ids["b:" + n] = store.put("bills", { id: st.ids["b:" + n], name: n, amount: parseMoney(st.amounts[n]), frequency: "monthly", dueDay: st.days[n] || 1, anchorMonth: new Date().getMonth() + 1, startDate: (st.days[n] || 1) < new Date().getDate() ? nextMonthStart() : null, active: true, position: store.model.bills.length + k }).id; });
  }
  if (s === "balance" && !later) {
    const raw = st.balance, v = parseMoney(raw);
    if (v == null || Number.isNaN(v)) return msg("Type the number from your bank, like 1120.");
    setBalanceNow(/^\s*-/.test(raw) ? -v : v);
  }
  if (s === "feel" && !later && st.feel) saveProfile({ feel: st.feel });
  if (s === "feel" && !later && st.feel) remember(FEEL.find(([v]) => v === st.feel)[2]);
  if (s === "people" && !later && st.people) saveProfile({ people: st.people });
  if (s === "people" && !later && st.people) remember(PEOPLE.find(([v]) => v === st.people)[2]);
  if (s === "goal" && !later && st.goal) {
    const target = parseMoney(st.goalAmt);
    if (st.goalAmt && (target == null || Number.isNaN(target) || target <= 0)) return msg("Type an amount like 1500, or leave it empty.");
    saveProfile({ goal: { name: st.goal, target: target || null } });
    st.ids.goal = store.put("goals", { id: st.ids.goal, name: st.goal, target: target || null, saved: 0, monthly: null, targetDate: null, position: store.model.goals.length }).id;
  }
  if (s === "nudges" && !later) {
    const R = store.model.settings.reminders || {};
    store.updateSettings({ reminders: { ...R, bills: st.nudge.bills, payday: st.nudge.payday, weekly: st.nudge.weekly }, voiceLang: st.lang === "fi" ? "fi-FI" : "en-GB" });
    saveProfile({ nudges: { ...st.nudge }, lang: st.lang });
  }
  if (s === "name") {
    const name = String(st.name || "").trim().slice(0, 40);
    if (!later && !name) return msg("Type your name, or tap Later.");
    if (name) store.updateSettings({ name });
  }
  if (s === "learned" && !steps().includes("account")) { close(); return; }
  if (s === "account") { if (later) { close(); return; } return account(); }
  step++; dir = 1; paint();
}

/* The last step: create the account (or sign in to one). What was answered on this phone goes with it. */
async function account() {
  const email = st.email, pw = ($("#obPass", el) || {}).value || "", btn = $("[data-next]", el);
  if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Type your email address.");
  if (pw.length < 8) return msg("The password needs at least 8 characters.");
  btn.disabled = true; msg(""); btn.textContent = st.mode === "up" ? "Creating your account…" : "Signing in…";
  try {
    if (st.mode === "up") { const r = await signUp(email, pw); if (r.needsConfirm) { st.sent = true; dir = 0; paint(); return; } }
    else await signIn(email, pw);
    close(); toast(st.mode === "up" ? "Account created. Syncing…" : "Signed in. Syncing…");
  } catch (err) {
    const t = String(err.message || err);
    btn.disabled = false; btn.textContent = st.mode === "up" ? "Create account" : "Sign in";
    msg(/Invalid login/i.test(t) ? "Email or password doesn't match. Try again." : /Email not confirmed/i.test(t) ? "Confirm your email first: open the link we sent you." : /already registered/i.test(t) ? "That email already has an account. Tap “I already have an account” to sign in." : /fetch|network/i.test(t) ? "Can't reach the server. Check your connection, or tap Not now." : t);
  }
}
