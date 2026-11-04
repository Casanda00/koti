// First time: three questions (your pay, your bills, your bank balance). Each answer is saved as you go,
// so "Later" keeps what was already answered.
import { store } from "./data.js";
import { $, $$, esc, parseMoney } from "./ui.js";
import { setBalanceNow } from "./money.js";
import { payDateFor, LAST_WORKING_DAY, LAST_DAY } from "./paydays.js";

const BILLS = ["Rent", "Electricity", "Water", "Phone", "Internet", "Home insurance", "Netflix", "Spotify", "Gym", "Travel card", "Loan"];
const nextMonthStart = () => { const d = new Date(); const n = new Date(d.getFullYear(), d.getMonth() + 1, 1); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`; };
const longDay = d => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
let el = null, step = 0, st = null;

export function shouldOnboard() {
  const S = store.model.settings, m = store.model;
  return !S.setupDone && !m.income.length && !m.bills.length && !(S.startDate && S.startBalance != null);
}
export function openOnboarding() {
  el = $("#onb"); step = 0; st = { amount: "", when: LAST_WORKING_DAY, day: 25, picked: new Set(), amounts: {}, days: {}, balance: "", ids: {} };
  el.hidden = false; document.body.classList.add("onb-open"); paint();
}
/* Data arrived from another device while the questions were open: they're already answered there. */
export function dismissIfAnswered() {
  if (!el || el.hidden || shouldOnboard()) return;
  if (store.model.income.some(x => x.id !== (st && st.ids.income))) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); }
}
function close() { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); store.updateSettings({ setupDone: true }); location.hash = "#now"; }

function progress(n) { return `<div class="onb-prog" role="progressbar" aria-label="Question ${n + 1} of 3" aria-valuemin="1" aria-valuemax="3" aria-valuenow="${n + 1}">${[0, 1, 2].map(i => `<i class="${i === n ? "on" : i < n ? "done" : ""}"></i>`).join("")}</div>`; }
function paint() {
  const now = new Date();
  el.classList.toggle("lake", step === 2);
  if (step === 0) {
    const opts = [[LAST_WORKING_DAY, "Last working day of the month", `This month that's ${longDay(payDateFor(LAST_WORKING_DAY, now.getFullYear(), now.getMonth()))}`], [LAST_DAY, "Last day of the month", ""], ["date", "The same date every month", ""], ["varies", "It changes", "Koti asks when it lands"]];
    el.innerHTML = `<div class="onb-in">${progress(0)}
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
      <div class="onb-chips">${BILLS.map(n => `<button type="button" class="onb-chip" data-bill="${esc(n)}" aria-pressed="${st.picked.has(n)}">${esc(n)}</button>`).join("")}</div>
      <div class="onb-rows">${[...st.picked].map(n => `<div class="onb-row"><span>${esc(n)}</span><input inputmode="decimal" placeholder="€0" aria-label="${esc(n)} amount" data-amt="${esc(n)}" value="${esc(st.amounts[n] || "")}"><select aria-label="${esc(n)} is due on day" data-dday="${esc(n)}">${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${k + 1 === (st.days[n] || 1) ? " selected" : ""}>Day ${k + 1}</option>`).join("")}</select></div>`).join("")}</div>
      <p class="onb-msg" id="obMsg" aria-live="polite"></p>
      ${foot("Next: your balance")}</div>`;
    $(".onb-chips", el).addEventListener("click", e => { const b = e.target.closest("[data-bill]"); if (!b) return; keepRows(); const n = b.dataset.bill; st.picked.has(n) ? st.picked.delete(n) : st.picked.add(n); paint(); });
  } else {
    el.innerHTML = `<div class="onb-in">${progress(2)}<button type="button" class="onb-back" data-back>Back</button>
      <h1>Last one. What does your bank say right now?</h1>
      <p class="onb-p">Open your bank app and copy the number over. You only do this once.</p>
      <label class="sr" for="obBal">Money in your account today</label>
      <input class="onb-amt big num" id="obBal" inputmode="decimal" placeholder="€0" value="${esc(st.balance)}" autocomplete="off">
      <p class="onb-p">With your pay, your bills and this, Koti works out how much is yours to spend every day.</p>
      <p class="onb-msg" id="obMsg" aria-live="polite"></p>
      ${foot("Show me my month")}</div>`;
    setTimeout(() => { const f = el && $("#obBal", el); if (f) f.focus(); }, 50);
  }
  el.onclick = e => {
    if (e.target.closest("[data-back]")) { keepRows(); step--; paint(); return; }
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
  if (step === 2) {
    if (!later) {
      const raw = st.balance, v = parseMoney(raw);
      if (v == null || Number.isNaN(v)) return msg("Type the number from your bank, like 1120.");
      setBalanceNow(/^\s*-/.test(raw) ? -v : v);
    }
    close(); return;
  }
  step++; paint();
}
