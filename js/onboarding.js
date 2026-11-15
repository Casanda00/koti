// First time: three questions (your pay, your bills, your bank balance), then Koti asks your name (making friends),
// and last, creating the account (15 November 2026: the questions come before signing up, and signing up is the last
// step). Each answer is saved as you go, so "Later" keeps what was already answered. Signed in already: no account step.
// The progress bar is gold and fills as you go; each step slides in (none with Reduce motion).
import { store } from "./data.js";
import { $, $$, esc, parseMoney, toast } from "./ui.js";
import { sync, signUp, signIn } from "./sync.js";
import { setBalanceNow } from "./money.js";
import { payDateFor, LAST_WORKING_DAY, LAST_DAY } from "./paydays.js";

const BILLS = ["Rent", "Electricity", "Water", "Phone", "Internet", "Home insurance", "Netflix", "Spotify", "Gym", "Travel card", "Loan"];
const nextMonthStart = () => { const d = new Date(); const n = new Date(d.getFullYear(), d.getMonth() + 1, 1); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`; };
const longDay = d => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
let el = null, step = 0, st = null, dir = 1;
/* The steps: pay, bills, balance, your name, and the account (left out when signed in already, or with no server). */
const NAME = 3, ACCOUNT = 4;
export const stepCount = () => (sync.user || !sync.configured ? 4 : 5);

export function shouldOnboard() {
  const S = store.model.settings, m = store.model;
  return !S.setupDone && !m.income.length && !m.bills.length && !(S.startDate && S.startBalance != null);
}
export function openOnboarding() {
  el = $("#onb"); step = 0; dir = 1; st = { amount: "", when: LAST_WORKING_DAY, day: 25, picked: new Set(), amounts: {}, days: {}, balance: "", name: store.model.settings.name || "", email: "", mode: "up", sent: false, ids: {} };
  el.hidden = false; document.body.classList.add("onb-open"); paint();
}
/* Data arrived from another device while the questions were open: they're already answered there. */
export function dismissIfAnswered() {
  if (!el || el.hidden || shouldOnboard()) return;
  if (store.model.income.some(x => x.id !== (st && st.ids.income))) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); }
}
function close() { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); store.updateSettings({ setupDone: true }); location.hash = "#now"; }

/* The gold bar: how far along, filling smoothly from the step before (the width is set after it's drawn). */
function progress(n) { const all = stepCount(); return `<div class="onb-prog" role="progressbar" aria-label="Step ${n + 1} of ${all}" aria-valuemin="1" aria-valuemax="${all}" aria-valuenow="${n + 1}"><i style="width:${Math.round(((n + 1 - dir) / all) * 100)}%" data-to="${Math.round(((n + 1) / all) * 100)}"></i></div>`; }
function paint() {
  const now = new Date();
  el.classList.toggle("lake", step === 2);
  el.dataset.dir = dir > 0 ? "fwd" : dir < 0 ? "back" : "stay";   // a redraw within a step doesn't slide
  if (step === 0) {
    const opts = [[LAST_WORKING_DAY, "Last working day of the month", `This month that's ${longDay(payDateFor(LAST_WORKING_DAY, now.getFullYear(), now.getMonth()))}`], [LAST_DAY, "Last day of the month", ""], ["date", "The same date every month", ""], ["varies", "It changes", "Koti asks when it lands"]];
    el.innerHTML = `<div class="onb-in">${progress(0)}
      ${sync.configured && !sync.user ? `<button type="button" class="onb-back" data-signin-first>Sign in</button>` : ""}
      <h1>Let's start with your pay</h1>
      <label class="onb-l" for="obAmt">What lands in your account</label>
      <input class="onb-amt num" id="obAmt" inputmode="decimal" placeholder="€0" value="${esc(st.amount)}" autocomplete="off">
      <p class="onb-l" id="obWhen">And when it lands</p>
      <div class="onb-opts" role="radiogroup" aria-labelledby="obWhen">${opts.map(([v, t, s]) => `<button type="button" role="radio" class="onb-opt" data-when="${v}" aria-checked="${String(st.when) === String(v)}"><i aria-hidden="true"></i><span><b>${t}</b>${s ? `<small>${esc(s)}</small>` : ""}</span></button>`).join("")}</div>
      <label class="onb-day" id="obDayRow" ${st.when === "date" ? "" : "hidden"}>On day <select id="obDay">${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${k + 1 === st.day ? " selected" : ""}>${k + 1}</option>`).join("")}</select></label>
      <p class="onb-msg" id="obMsg" aria-live="polite"></p>
      ${foot("Next: your bills")}</div>`;
    $(".onb-opts", el).addEventListener("click", e => { const b = e.target.closest("[data-when]"); if (!b) return; st.when = isNaN(Number(b.dataset.when)) ? b.dataset.when : Number(b.dataset.when); $$("[data-when]", el).forEach(x => x.setAttribute("aria-checked", x === b)); $("#obDayRow", el).hidden = st.when !== "date"; });
    setTimeout(() => { const f = el && $("#obAmt", el); if (f) f.focus(); }, 50);
  } else if (step === 1) {
    el.innerHTML = `<div class="onb-in">${progress(1)}<button type="button" class="onb-back" data-back>Back</button>
      <h1>What goes out every month?</h1>
      <p class="onb-p">Tap what you pay, then add the amount and the day it's due. Anything due before today starts next month.</p>
      <div class="onb-chips">${BILLS.map(n => `<button type="button" class="onb-chip${n === st.just ? " just" : ""}" data-bill="${esc(n)}" aria-pressed="${st.picked.has(n)}">${esc(n)}</button>`).join("")}</div>
      <div class="onb-rows">${[...st.picked].map(n => `<div class="onb-row"><span>${esc(n)}</span><input inputmode="decimal" placeholder="€0" aria-label="${esc(n)} amount" data-amt="${esc(n)}" value="${esc(st.amounts[n] || "")}"><select aria-label="${esc(n)} is due on day" data-dday="${esc(n)}">${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${k + 1 === (st.days[n] || 1) ? " selected" : ""}>Day ${k + 1}</option>`).join("")}</select></div>`).join("")}</div>
      <p class="onb-msg" id="obMsg" aria-live="polite"></p>
      ${foot("Next: your balance")}</div>`;
    $(".onb-chips", el).addEventListener("click", e => { const b = e.target.closest("[data-bill]"); if (!b) return; keepRows(); const n = b.dataset.bill; st.picked.has(n) ? st.picked.delete(n) : st.picked.add(n); st.just = n; dir = 0; paint(); st.just = null; });
  } else if (step === 2) {
    el.innerHTML = `<div class="onb-in">${progress(2)}<button type="button" class="onb-back" data-back>Back</button>
      <h1>One more. What does your bank say right now?</h1>
      <p class="onb-p">Open your bank app and copy the number over. You only do this once.</p>
      <label class="sr" for="obBal">Money in your account today</label>
      <input class="onb-amt big num" id="obBal" inputmode="decimal" placeholder="€0" value="${esc(st.balance)}" autocomplete="off">
      <p class="onb-p">With your pay, your bills and this, Koti works out how much is yours to spend every day.</p>
      <p class="onb-msg" id="obMsg" aria-live="polite"></p>
      ${foot("Next")}</div>`;
    setTimeout(() => { const f = el && $("#obBal", el); if (f) f.focus(); }, 50);
  } else if (step === NAME) {
    el.innerHTML = `<div class="onb-in">${progress(NAME)}<button type="button" class="onb-back" data-back>Back</button>
      <div class="onb-hi" aria-hidden="true"><span class="onb-wave">👋</span></div>
      <h1>I'm Koti. What should I call you?</h1>
      <p class="onb-p">So we can be on first-name terms. I'll use it when we talk about your money.</p>
      <label class="sr" for="obName">Your first name</label>
      <input class="onb-amt onb-name" id="obName" placeholder="Your name" value="${esc(st.name)}" maxlength="40" autocomplete="given-name" autocapitalize="words" enterkeyhint="next">
      <p class="onb-msg" id="obMsg" aria-live="polite"></p>
      ${foot(stepCount() > ACCOUNT ? "Nice to meet you" : "Show me my month")}</div>`;
    setTimeout(() => { const f = el && $("#obName", el); if (f) f.focus(); }, 50);
    $("#obName", el).addEventListener("keydown", e => { if (e.key === "Enter") { keepRows(); next(false); } });
  } else {
    const first = String(st.name || "").trim().split(/\s+/)[0];
    el.innerHTML = st.sent ? `<div class="onb-in">${progress(ACCOUNT)}
      <div class="onb-hi" aria-hidden="true"><span class="onb-pop">✉️</span></div>
      <h1>Check your email${first ? `, ${esc(first)}` : ""}</h1>
      <p class="onb-p">Open the link we sent to <b>${esc(st.email)}</b> to confirm it. Then sign in on any device and everything you've set up comes with you.</p>
      <p class="onb-p">Until then, Koti keeps it all on this phone.</p>
      <div class="onb-foot"><button type="button" class="onb-go" data-done>Show me my month</button></div></div>`
    : `<div class="onb-in">${progress(ACCOUNT)}<button type="button" class="onb-back" data-back>Back</button>
      <h1>${st.mode === "up" ? `Let's keep it safe${first ? `, ${esc(first)}` : ""}` : `Welcome back${first ? `, ${esc(first)}` : ""}`}</h1>
      <p class="onb-p">${st.mode === "up" ? "Create your account and what you've told me is saved, on every device you sign in on." : "Sign in, and what's in your account comes to this phone."}</p>
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
    if (!st.sent) {
      setTimeout(() => { const f = el && $(st.email ? "#obPass" : "#obEmail", el); if (f) f.focus(); }, 50);
      $("#obPass", el).addEventListener("keydown", e => { if (e.key === "Enter") { keepRows(); next(false); } });
    }
  }
  // the gold bar fills to this step, and the step slides in
  requestAnimationFrame(() => { const bar = el && $(".onb-prog i", el); if (bar) bar.style.width = bar.dataset.to + "%"; });
  el.onclick = e => {
    if (e.target.closest("[data-signin-first]")) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); import("./more.js").then(m => m.openAuth("in")); return; }
    if (e.target.closest("[data-done]")) { close(); return; }
    if (e.target.closest("[data-switch]")) { keepRows(); st.mode = st.mode === "up" ? "in" : "up"; dir = 0; paint(); return; }
    if (e.target.closest("[data-back]")) { keepRows(); step--; dir = -1; paint(); return; }
    if (e.target.closest("[data-later]")) { keepRows(); next(true); return; }
    if (e.target.closest("[data-next]")) { keepRows(); next(false); }
  };
  el.scrollTop = 0;
}
const foot = label => `<div class="onb-foot"><button type="button" class="onb-later" data-later>Later</button><button type="button" class="onb-go" data-next>${label}</button></div>`;
function msg(t) { const m = $("#obMsg", el); if (m) m.textContent = t; }
function keepRows() {
  const a = $("#obAmt", el); if (a) st.amount = a.value;
  const d = $("#obDay", el); if (d) st.day = Number(d.value);
  const b = $("#obBal", el); if (b) st.balance = b.value;
  const n = $("#obName", el); if (n) st.name = n.value;
  const m = $("#obEmail", el); if (m) st.email = m.value.trim();
  $$("[data-amt]", el).forEach(i => { st.amounts[i.dataset.amt] = i.value; });
  $$("[data-dday]", el).forEach(s => { st.days[s.dataset.dday] = Number(s.value); });
}

function next(later) {
  if (step === 0 && !later) {
    const amount = parseMoney(st.amount);
    if (st.when !== "varies" && (!amount || Number.isNaN(amount))) return msg("Type what lands, like 2400. Or tap Later.");
    const payDay = st.when === "date" ? st.day : st.when === "varies" ? LAST_DAY : st.when;
    st.ids.income = store.put("income", { id: st.ids.income, name: "Salary", amount: amount || null, frequency: st.when === "varies" ? "varies" : "monthly", payDay, active: true, position: store.model.income.length }).id;
  }
  if (step === 1 && !later) {
    const missing = [...st.picked].filter(n => { const v = parseMoney(st.amounts[n]); return !v || Number.isNaN(v); });
    if (missing.length) return msg(`Add an amount for ${missing.join(", ")}, or tap it again to take it off.`);
    [...st.picked].forEach((n, k) => { st.ids["b:" + n] = store.put("bills", { id: st.ids["b:" + n], name: n, amount: parseMoney(st.amounts[n]), frequency: "monthly", dueDay: st.days[n] || 1, anchorMonth: new Date().getMonth() + 1, startDate: (st.days[n] || 1) < new Date().getDate() ? nextMonthStart() : null, active: true, position: store.model.bills.length + k }).id; });
  }
  if (step === 2 && !later) {
    const raw = st.balance, v = parseMoney(raw);
    if (v == null || Number.isNaN(v)) return msg("Type the number from your bank, like 1120.");
    setBalanceNow(/^\s*-/.test(raw) ? -v : v);
  }
  if (step === NAME) {
    const name = String(st.name || "").trim().slice(0, 40);
    if (!later && !name) return msg("Type your name, or tap Later.");
    if (name) store.updateSettings({ name });
    if (stepCount() <= ACCOUNT) { close(); return; }
  }
  if (step === ACCOUNT) {
    if (later) { close(); return; }
    return account();
  }
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
