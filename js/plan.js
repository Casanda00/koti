// Bills (a screen under Expenses): calendar, paid tracking, autopay. Savings goals (shown in Budgets).
import { store, todayISO, BILLS_CAT, FREQS } from "./data.js";
import { $, $$, esc, eur, eur0, icon, parseMoney, moneyField, parseDay, fmtDay, openSheet, closeSheet, toast } from "./ui.js";
import { periodFor } from "./money.js";

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const FREQ_LABEL = { monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly", once: "Once" };
const MONTHS = Array.from({ length: 12 }, (_, k) => new Date(2026, k, 1).toLocaleDateString("en-GB", { month: "long" }));
export const payId = (billId, due) => `bill:${billId}:${due}`;
const paymentOf = (billId, due) => store.model.transactions.find(t => t.id === payId(billId, due));

/* ---------- Occurrences and totals ---------- */
function dueIn(b, y, m) { // due date of bill b in month m (0-based) of year y, or null
  const mm = ((m % 12) + 12) % 12;
  if (b.frequency === "once") { if (!b.dueDate) return null; const d = parseDay(b.dueDate), t = new Date(y, m, 1); return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() ? d : null; }
  if (b.frequency === "yearly" && mm !== b.anchorMonth - 1) return null;
  if (b.frequency === "quarterly" && ((mm - (b.anchorMonth - 1)) % 3 + 3) % 3 !== 0) return null;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(b.dueDay, last));
}
export function occurrences(p, { includePaused = false } = {}) {
  const out = [];
  store.model.bills.filter(b => includePaused || b.active).forEach(b => {
    for (let k = -1; k <= 1; k++) {
      const d = dueIn(b, p.start.getFullYear(), p.start.getMonth() + k); if (!d) continue;
      const due = iso(d); if (due < p.from || due > p.to) continue;
      out.push({ bill: b, due, amount: dueAmount(b, due), paid: paymentOf(b.id, due) || null });
    }
  });
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
}
export function billTotals(p) {
  const occ = occurrences(p); let total = 0, paid = 0;
  occ.forEach(o => { total += o.amount; if (o.paid) paid += o.paid.amount; });
  const due = occ.filter(o => !o.paid).reduce((a, o) => a + o.amount, 0);
  return { occ, total, paid, due, count: occ.length, paidCount: occ.filter(o => o.paid).length };
}
export const perYear = b => b.amount * ({ monthly: 12, quarterly: 4, yearly: 1, once: 0 }[b.frequency] ?? 12);
/* The amount for one due date: what that month's bill said, otherwise the usual amount. */
export const dueAmount = (b, due) => (b.dues && b.dues[due] && b.dues[due].amount) || b.amount;
export const occurrenceOf = (b, due) => ({ bill: b, due, amount: dueAmount(b, due), paid: paymentOf(b.id, due) || null });
export function nextDue(b, from = new Date()) {
  const t = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let k = 0; k < 14; k++) { const d = dueIn(b, t.getFullYear(), t.getMonth() + k); if (d && d >= t) return d; }
  return null;
}

/* The bill's own due date nearest to a date read from a document (a bill due on the 14th files under the 15th). */
export function alignDue(b, due) {
  const d = parseDay(due); let best = null, bd = Infinity;
  for (let k = -1; k <= 1; k++) { const x = dueIn(b, d.getFullYear(), d.getMonth() + k); if (x) { const diff = Math.abs(x - d); if (diff < bd) { bd = diff; best = x; } } }
  return best && bd <= 20 * 864e5 ? iso(best) : due;
}

/* ---------- Paying ---------- */
export function markPaid(o, date = todayISO()) {
  const b = o.bill;
  return store.put("transactions", { id: payId(b.id, o.due), date: o.due < periodFor(new Date()).from ? o.due : date, amount: o.amount ?? dueAmount(b, o.due), receiptPath: (b.dues && b.dues[o.due] && b.dues[o.due].docPath) || null, kind: "expense", categoryId: BILLS_CAT, payee: b.name, note: null, source: "manual", billId: b.id, billDue: o.due });
}
export function unmarkPaid(o) { if (o.paid) store.remove("transactions", o.paid.id); }

/* Bills paid automatically: record each due date once, from the start of this month, up to today. */
export function runAutopay() {
  const today = todayISO(), cur = periodFor(new Date());
  let changed = 0;
  store.model.bills.filter(b => b.active && b.autopay).forEach(b => {
    const from = b.autoThrough && b.autoThrough >= cur.from ? b.autoThrough : null;
    let latest = b.autoThrough;
    occurrences(cur).filter(o => o.bill.id === b.id && o.due <= today && (!from || o.due > from)).forEach(o => {
      if (!o.paid && !(store.meta.tomb.transactions[payId(b.id, o.due)])) { store.put("transactions", { id: payId(b.id, o.due), date: o.due, amount: o.amount, kind: "expense", categoryId: BILLS_CAT, payee: b.name, source: "manual", billId: b.id, billDue: o.due }); changed++; }
      if (!latest || o.due > latest) latest = o.due;
    });
    if (latest && latest !== b.autoThrough) { store.put("bills", { ...b, autoThrough: latest }); changed++; }
  });
  return changed;
}

/* ---------- Goals ---------- */
const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() >= a.getDate() ? 0 : -1);
export function goalPlan(g) {
  const left = Math.max(0, g.target - g.saved);
  if (left <= 0) return { text: "Goal reached", need: 0, state: "done" };
  if (g.targetDate) {
    const months = Math.max(1, monthsBetween(new Date(), parseDay(g.targetDate)) + 1), need = Math.ceil(left / months);
    const when = parseDay(g.targetDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    if (g.monthly && g.monthly < need) return { text: `${eur0(need)} a month needed to reach it by ${when}. You plan ${eur0(g.monthly)}.`, need, state: "behind" };
    return { text: `${eur0(need)} a month to reach it by ${when}`, need, state: "ok" };
  }
  if (g.monthly > 0) {
    const m = Math.ceil(left / g.monthly), d = new Date(); d.setMonth(d.getMonth() + m);
    return { text: `${eur0(g.monthly)} a month · reached ${d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`, need: g.monthly, state: "ok" };
  }
  return { text: "Add a monthly amount or a date to see your plan", need: 0, state: "none" };
}

/* ---------- View ---------- */
let root = null, view = null, pickedDay = null;
export function mountPlan(elm) {
  root = elm; view = periodFor(new Date());
  root.innerHTML = `
  <header class="vh"><div><a class="back" href="#expenses">${icon("chev", "ic sm flip")} Expenses</a><h1>Bills</h1><div class="sub" id="plSub"></div></div><button type="button" class="btn-sm" data-act="add-bill">${icon("plus", "ic sm")} Add bill</button></header>
  <div class="mo-nav"><button type="button" class="mo-arrow" data-pshift="-1" aria-label="Previous month">${icon("chev", "ic sm flip")}</button><b id="plPeriod"></b><button type="button" class="mo-arrow" data-pshift="1" aria-label="Next month">${icon("chev", "ic sm")}</button><button type="button" class="mo-today" data-pshift="0" hidden>This month</button></div>
  <div class="pl-top">
    <section class="card" id="plSummary"></section>
    <section class="card"><div class="cal" id="plCal" role="grid" aria-label="Bills this month"></div><div class="key" style="margin-top:10px"><span><i class="dotk" style="background:var(--amber)"></i>Due</span><span><i class="dotk" style="background:var(--spruce)"></i>Paid</span><span><i class="dotk" style="background:var(--crit)"></i>Overdue</span></div></section>
  </div>
  <div class="gh"><h2>Bills and subscriptions</h2></div>
  <div id="plBills"></div>`;
  root.addEventListener("click", e => {
    const s = e.target.closest("[data-pshift]"); if (s) { const n = Number(s.dataset.pshift); view = n === 0 ? periodFor(new Date()) : periodFor(new Date(view.start.getFullYear(), view.start.getMonth() + n, view.start.getDate())); pickedDay = null; renderPlanView(); return; }
    const a = e.target.closest("[data-act]"); if (a) { if (a.dataset.act === "add-bill") openBill(); if (a.dataset.act === "add-goal") openGoal(); return; }
    const q = e.target.closest("[data-quick]"); if (q) { openBill(null, { name: q.dataset.quick }); return; }
    const pay = e.target.closest("[data-pay]"); if (pay) { togglePaid(pay.dataset.pay, pay.dataset.due); return; }
    const bill = e.target.closest("[data-bill]"); if (bill) { const b = store.model.bills.find(x => x.id === bill.dataset.bill); if (b) openBill(b); return; }
    const goal = e.target.closest("[data-goal]"); if (goal) { const g = store.model.goals.find(x => x.id === goal.dataset.goal); if (g) openGoal(g); return; }
    const day = e.target.closest("[data-day]"); if (day) { pickedDay = pickedDay === day.dataset.day ? null : day.dataset.day; renderPlanView(); const r = root.querySelector(`[data-due="${pickedDay}"]`); if (r) r.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
}
function togglePaid(billId, due) {
  const o = occurrences(view, { includePaused: true }).find(x => x.bill.id === billId && x.due === due); if (!o) return;
  if (o.paid) { unmarkPaid(o); toast(`${o.bill.name} marked not paid`); }
  else { markPaid(o); if (navigator.vibrate) navigator.vibrate(8); toast(`${o.bill.name} paid · ${eur(o.amount)}`, { label: "Undo", run: () => { const p = paymentOf(billId, due); if (p) store.remove("transactions", p.id); } }); }
}

export function renderPlanView() {
  if (!root) return;
  const cur = periodFor(new Date()), isCur = view.from === cur.from, today = todayISO();
  const T = billTotals(view), bills = store.model.bills;
  const monthly = bills.filter(b => b.active).reduce((a, b) => a + perYear(b), 0) / 12, yearly = monthly * 12;
  $("#plPeriod", root).textContent = view.start.getDate() === 1 ? view.start.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : `${fmtDay(view.start)} – ${fmtDay(view.end)}`;
  $(".mo-today", root).hidden = isCur;
  $("#plSub", root).textContent = bills.length ? `Bills ${eur0(monthly)} a month · ${eur0(yearly)} a year` : "Bills, subscriptions and savings";

  // summary
  const next = T.occ.find(o => !o.paid && o.due >= today), overdue = T.occ.filter(o => !o.paid && o.due < today);
  const rel = d => { const n = Math.round((parseDay(d) - parseDay(today)) / 864e5); return n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? `${-n} days ago` : `in ${n} days`; };
  $("#plSummary", root).innerHTML = T.count ? `
    <div class="card-head" style="margin-bottom:2px"><h2>Bills ${isCur ? "this month" : "in " + esc($("#plPeriod", root).textContent)}</h2>${overdue.length ? `<span class="chip crit">${overdue.length} overdue</span>` : T.due ? `<span class="chip warn">${eur0(T.due)} still due</span>` : `<span class="chip ok">All paid</span>`}</div>
    <div class="big">${eur0(T.total)}</div>
    <div class="meter" style="margin:12px 0 8px" role="img" aria-label="${T.paidCount} of ${T.count} bills paid"><i style="width:${T.total ? T.paid / T.total * 100 : 0}%"></i></div>
    <div class="hint" style="font-size:13px">${T.paidCount} of ${T.count} paid${T.due ? ` · ${eur(T.due)} to go` : ""}</div>
    ${next ? `<div class="next-due"><span class="date"><b>${parseDay(next.due).getDate()}</b>${parseDay(next.due).toLocaleDateString("en-GB", { month: "short" })}</span><span class="rt">Next: ${esc(next.bill.name)}<small>${eur(next.amount)} · due ${rel(next.due)}${next.bill.autopay ? " · paid automatically" : ""}</small></span></div>` : ""}`
    : `<h2>No bills ${isCur ? "this month" : "in this month"}</h2><p class="hint" style="font-size:13px;margin-top:6px">Add rent, electricity, phone and subscriptions. They show up here on their due dates and count in Money's "Left until payday".</p>`;

  // calendar
  const lead = (view.start.getDay() + 6) % 7, days = Math.round((view.end - view.start) / 864e5) + 1;
  let cal = ["M", "T", "W", "T", "F", "S", "S"].map(d => `<span class="wd" aria-hidden="true">${d}</span>`).join("") + "<span></span>".repeat(lead);
  for (let k = 0; k < days; k++) {
    const d = new Date(view.start.getFullYear(), view.start.getMonth(), view.start.getDate() + k), s = iso(d), occ = T.occ.filter(o => o.due === s);
    const st = !occ.length ? "" : occ.every(o => o.paid) ? "paid" : occ.some(o => !o.paid && s < today) ? "late" : "due";
    const label = `${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${occ.length ? ": " + occ.map(o => `${o.bill.name} ${eur(o.amount)}${o.paid ? " paid" : ""}`).join(", ") : ""}`;
    cal += `<button type="button" class="${[s === today ? "today" : "", st, pickedDay === s ? "picked" : ""].join(" ")}" data-day="${s}" aria-label="${esc(label)}" ${occ.length ? "" : "tabindex=\"-1\""}>${d.getDate()}${d.getDate() === 1 && k > 0 ? `<small>${d.toLocaleDateString("en-GB", { month: "short" })}</small>` : ""}</button>`;
  }
  $("#plCal", root).innerHTML = cal;

  // bills
  const check = icon("check", "ic xs");
  let bh = "";
  if (!bills.length) {
    bh = `<div class="empty" style="text-align:left"><b style="color:var(--ink)">Start with your regular bills</b><p style="margin:6px 0 12px">Tap one to add it, or use Add for anything else.</p><div class="chips" style="margin:0;padding:0;flex-wrap:wrap">${["Rent", "Electricity", "Internet", "Phone", "Home insurance", "Streaming", "Gym", "Transport pass"].map(n => `<button type="button" class="fchip" data-quick="${n}">${n}</button>`).join("")}</div></div>`;
  } else {
    bh = T.occ.length ? `<div class="grp">${T.occ.map(o => {
      const late = !o.paid && o.due < today, d = parseDay(o.due);
      const status = o.paid ? `Paid ${o.paid.date === o.due ? "" : fmtDay(parseDay(o.paid.date))}`.trim() : late ? "Overdue" : o.due === today ? "Due today" : `Due ${fmtDay(d)}`;
      const sub = [o.bill.payee, FREQ_LABEL[o.bill.frequency], o.bill.autopay ? "Paid automatically" : null].filter(Boolean).join(" · ");
      return `<div class="row bill-row${pickedDay === o.due ? " picked" : ""}" data-due="${o.due}">
        <button type="button" class="cb" role="checkbox" aria-checked="${!!o.paid}" aria-label="${esc(o.bill.name)} paid" data-pay="${esc(o.bill.id)}" data-due="${o.due}">${check}</button>
        <button type="button" class="item-name" data-bill="${esc(o.bill.id)}" aria-label="${esc(o.bill.name)}, ${eur(o.amount)}, ${status}. Edit"><span>${esc(o.bill.name)}</span><small>${esc(sub)}</small></button>
        <span class="rv bill-amt"><b class="num">${eur(o.amount)}</b><small class="${o.paid ? "good" : late ? "danger" : ""}">${esc(status)}</small></span></div>`;
    }).join("")}</div>` : "";
    const notThis = bills.filter(b => !T.occ.some(o => o.bill.id === b.id));
    if (notThis.length) bh += `<div class="gh" style="margin-top:14px"><h3>${T.occ.length ? "Not due this month" : "Your bills"}</h3></div><div class="grp">${notThis.map(b => { const n = nextDue(b, view.end > new Date() ? view.start : new Date());
      return `<button type="button" class="row" data-bill="${esc(b.id)}"><span class="rt">${esc(b.name)}${b.active ? "" : " (paused)"}<small>${FREQ_LABEL[b.frequency]}${n && b.active ? ` · next ${fmtDay(n)}${n.getFullYear() !== new Date().getFullYear() ? " " + n.getFullYear() : ""}` : ""}</small></span><span class="rv">${eur(b.amount)}</span></button>`; }).join("")}</div>`;
  }
  $("#plBills", root).innerHTML = bh;

}

/* Savings goals as rows, for the Budgets screen. */
export function goalsHTML() {
  const goals = store.model.goals.slice().sort((a, b) => a.position - b.position);
  const planned = goals.reduce((a, g) => a + goalPlan(g).need, 0);
  return goals.length ? `<div class="grp">${goals.map(g => { const pl = goalPlan(g), pct = Math.min(100, g.saved / g.target * 100);
    return `<button type="button" class="row r2" data-goal="${esc(g.id)}" aria-label="${esc(g.name)}: ${eur(g.saved)} of ${eur(g.target)}. ${esc(pl.text)}"><span class="rt">${esc(g.name)}<small class="${pl.state === "behind" ? "warn-t" : ""}">${esc(pl.text)}</small></span><span class="rv num">${eur0(g.saved)} / ${eur0(g.target)}</span><span class="bullet"><i style="width:${pct}%;background:${pl.state === "done" ? "var(--good)" : "var(--spruce)"}"></i></span></button>`; }).join("")}</div>
    ${planned ? `<p class="note">Your goals ask for about ${eur0(planned)} a month.</p>` : ""}`
    : `<div class="empty" style="text-align:left"><b style="color:var(--ink)">Save toward something</b><p style="margin:6px 0 12px">An emergency fund, a trip, a new laptop. Set a target and Koti works out the monthly amount.</p><button type="button" class="btn primary" data-goal-add style="width:auto;display:inline-block;padding:10px 16px">Add a goal</button></div>`;
}

/* ---------- Bill sheet ---------- */
/* Copy buttons for references and account numbers: Koti doesn't pay, you paste these into your bank app. */
export function bindCopy(scope) {
  scope.addEventListener("click", async e => { const c = e.target.closest("[data-copy]"); if (!c) return; e.preventDefault();
    try { await navigator.clipboard.writeText(c.dataset.copy); toast("Copied"); } catch { prompt("Copy this:", c.dataset.copy); } });
}
export function openBill(bill = null, preset = {}) {
  const b = bill || { name: preset.name || "", amount: null, frequency: "monthly", dueDay: 1, anchorMonth: new Date().getMonth() + 1, autopay: false, active: true, payee: "", note: "", dueDate: null, reference: "", iban: "" };
  let freq = b.frequency;
  openSheet({ title: bill ? "Bill" : "Add bill", right: "Save", body: B => {
    B.innerHTML = `
      ${bill ? "" : `<button type="button" class="rc-add" id="biScan">${icon("cam", "ic sm")} Scan or upload the bill instead</button>`}
      <div class="field"><label for="biName">Name</label><input class="inp" id="biName" value="${esc(b.name)}" placeholder="e.g. Rent…" maxlength="80" autocomplete="off" ${bill ? "" : "autofocus"}></div>
      <div class="field"><label for="biAmt">Amount</label><input class="inp" id="biAmt" inputmode="decimal" placeholder="€0,00" value="${moneyField(b.amount)}" autocomplete="off"></div>
      <div class="field"><span class="flabel">How often</span><div class="seg" id="biFreq">${FREQS.map(f => `<button type="button" data-f="${f}" aria-pressed="${f === freq}">${FREQ_LABEL[f]}</button>`).join("")}</div></div>
      <div class="grp">
        <label class="row"><span class="rt">Due on day</span><select class="inl" id="biDay">${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${k + 1 === b.dueDay ? " selected" : ""}>${k + 1}${k + 1 >= 29 ? " (or last day)" : ""}</option>`).join("")}</select></label>
        <label class="row" id="biDateRow"><span class="rt">Due date</span><input class="inl" id="biDate" type="date" value="${esc(b.dueDate || todayISO())}"></label>
        <label class="row" id="biMonthRow"><span class="rt" id="biMonthLbl">Month</span><select class="inl" id="biMonth">${MONTHS.map((m, k) => `<option value="${k + 1}"${k + 1 === b.anchorMonth ? " selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="row"><span class="rt">Paid automatically<small>Direct debit or e-invoice: Koti marks it paid on the due date</small></span><input type="checkbox" id="biAuto" ${b.autopay ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--spruce)"></label>
        <label class="row"><span class="rt">Company</span><input class="inl" id="biPayee" value="${esc(b.payee || "")}" placeholder="Optional" maxlength="120" autocomplete="off" style="max-width:60%"></label>
        <label class="row"><span class="rt">Reference</span><input class="inl mono" id="biRef" value="${esc(b.reference || "")}" placeholder="Optional" maxlength="60" autocomplete="off" style="max-width:55%"></label>
        <label class="row"><span class="rt">Pay to (IBAN)</span><input class="inl mono" id="biIban" value="${esc(b.iban || "")}" placeholder="Optional" maxlength="40" autocomplete="off" style="max-width:55%"></label>
        ${b.reference || b.iban ? `<div class="row copy-row">${b.reference ? `<button type="button" class="link" data-copy="${esc(b.reference)}">${icon("copy", "ic xs")} Copy reference</button>` : ""}${b.iban ? `<button type="button" class="link" data-copy="${esc(b.iban.replace(/\s+/g, ""))}">${icon("copy", "ic xs")} Copy IBAN</button>` : ""}</div>` : ""}
        <label class="row"><span class="rt">Note</span><input class="inl" id="biNote" value="${esc(b.note || "")}" placeholder="Optional" maxlength="500" autocomplete="off" style="max-width:60%"></label>
        ${bill ? `<label class="row"><span class="rt">Paused<small>Hidden from the calendar and totals</small></span><input type="checkbox" id="biPaused" ${b.active ? "" : "checked"} style="width:22px;height:22px;accent-color:var(--spruce)"></label>` : ""}
      </div>
      <p class="msg" id="biMsg" aria-live="polite"></p>
      ${bill ? `<p class="note" style="margin-top:0">${eur(perYear(b))} a year. Past payments stay in Money if you delete this bill.</p><button type="button" class="btn danger" id="biDel">${icon("trash", "ic sm")} Delete bill</button>` : ""}`;
    const sc = $("#biScan", B); if (sc) sc.onclick = () => import("./scan.js").then(m => m.openScan({ dest: { kind: "bill" } }));
    const docs = bill ? Object.entries(bill.dues || {}).filter(([, x]) => x.docPath).slice(-3).reverse() : [];
    if (docs.length) $("#biMsg", B).insertAdjacentHTML("beforebegin", `<div class="grp">${docs.map(([d, x]) => `<button type="button" class="row" data-doc="${esc(x.docPath)}"><span class="ico r">${icon("bill")}</span><span class="rt">Bill due ${esc(fmtDay(parseDay(d)))}<small>${x.amount ? eur(x.amount) : ""}${x.reference ? " · " + esc(x.reference) : ""}</small></span><span class="link">View</span></button>`).join("")}</div>`);
    $$("[data-doc]", B).forEach(x => x.onclick = () => import("./money.js").then(m => m.openReceipt(x.dataset.doc)));
    const showMonth = () => { const once = freq === "once"; $("#biMonthRow", B).hidden = freq === "monthly" || once; $("#biDay", B).closest(".row").hidden = once; $("#biDateRow", B).hidden = !once; $("#biMonthLbl", B).textContent = freq === "yearly" ? "Month" : "First month of the cycle"; };
    bindCopy(B);
    showMonth();
    $("#biFreq", B).addEventListener("click", e => { const x = e.target.closest("[data-f]"); if (!x) return; freq = x.dataset.f; $$("#biFreq button", B).forEach(y => y.setAttribute("aria-pressed", y === x)); showMonth(); });
    const del = $("#biDel", B); if (del) del.onclick = () => { if (!confirm(`Delete "${b.name}"? Its past payments stay in Money.`)) return; closeSheet(); const copy = { ...bill }; store.remove("bills", bill.id); toast(`Deleted ${bill.name}`, { label: "Undo", run: () => store.put("bills", copy) }); };
  }, onRight: B => {
    const msg = t => { $("#biMsg", B).textContent = t; $("#biMsg", B).dataset.state = "error"; };
    const name = $("#biName", B).value.trim(), amount = parseMoney($("#biAmt", B).value);
    if (!name) return msg("Give the bill a name.");
    if (!amount || Number.isNaN(amount)) return msg("Type the amount, like 890 or 29,90.");
    const autopay = $("#biAuto", B).checked, once = freq === "once", dueDate = once ? $("#biDate", B).value : null;
    if (once && !dueDate) return msg("Pick the due date.");
    const dd = once ? parseDay(dueDate) : null;
    const saved = store.put("bills", { ...(bill || {}), id: bill ? bill.id : undefined, name, amount, frequency: freq, dueDay: once ? dd.getDate() : Number($("#biDay", B).value), anchorMonth: once ? dd.getMonth() + 1 : Number($("#biMonth", B).value), dueDate,
      reference: $("#biRef", B).value.trim() || null, iban: $("#biIban", B).value.trim() || null,
      autopay, autoThrough: bill && bill.autopay === autopay ? bill.autoThrough : null, active: bill ? !$("#biPaused", B).checked : true, payee: $("#biPayee", B).value.trim() || null, note: $("#biNote", B).value.trim() || null, position: bill ? bill.position : store.model.bills.length });
    closeSheet(); if (autopay) runAutopay();
    toast(bill ? "Saved" : `Added ${saved.name}`);
  } });
}

/* ---------- Goal sheet ---------- */
export function openGoal(goal = null) {
  const g = goal || { name: "", target: null, saved: 0, targetDate: "", monthly: null };
  openSheet({ title: goal ? "Goal" : "Add goal", right: "Save", body: B => {
    B.innerHTML = `
      ${goal ? `<div class="card" style="display:grid;gap:10px"><div style="display:flex;justify-content:space-between;align-items:baseline"><b class="big" style="font-size:30px">${eur0(goal.saved)}</b><span class="hint">of ${eur0(goal.target)}</span></div>
        <div class="meter"><i style="width:${Math.min(100, goal.saved / goal.target * 100)}%"></i></div>
        <div style="display:flex;gap:8px;align-items:center"><input class="inp" id="goMove" inputmode="decimal" placeholder="€ amount" autocomplete="off" style="flex:1"><button type="button" class="btn primary" id="goAdd" style="width:auto;padding:12px 14px">Add</button><button type="button" class="btn" id="goTake" style="width:auto;padding:12px 14px">Take out</button></div></div>` : ""}
      <div class="field"><label for="goName">Name</label><input class="inp" id="goName" value="${esc(g.name)}" placeholder="e.g. Emergency fund…" maxlength="80" autocomplete="off" ${goal ? "" : "autofocus"}></div>
      <div class="field"><label for="goTarget">Target</label><input class="inp" id="goTarget" inputmode="decimal" placeholder="€0" value="${moneyField(g.target)}" autocomplete="off"></div>
      ${goal ? "" : `<div class="field"><label for="goSaved">Saved so far</label><input class="inp" id="goSaved" inputmode="decimal" placeholder="€0" autocomplete="off"></div>`}
      <div class="grp">
        <label class="row"><span class="rt">Reach it by<small>Optional</small></span><input class="inl" id="goDate" type="date" value="${esc(g.targetDate || "")}"></label>
        <label class="row"><span class="rt">Put aside each month<small>Optional</small></span><input class="inl" id="goMonthly" inputmode="decimal" placeholder="€0" value="${moneyField(g.monthly)}" autocomplete="off"></label>
      </div>
      <p class="msg" id="goMsg" aria-live="polite"></p>
      ${goal ? `<button type="button" class="btn danger" id="goDel">${icon("trash", "ic sm")} Delete goal</button>` : ""}`;
    const move = sign => { const v = parseMoney($("#goMove", B).value); if (!v || Number.isNaN(v)) { $("#goMsg", B).dataset.state = "error"; $("#goMsg", B).textContent = "Type an amount first."; return; }
      const saved = Math.max(0, Math.round((goal.saved + sign * v) * 100) / 100); store.put("goals", { ...goal, saved }); closeSheet();
      toast(sign > 0 ? `Added ${eur(v)} to ${goal.name}` : `Took ${eur(v)} out of ${goal.name}`, { label: "Undo", run: () => store.put("goals", { ...goal }) }); };
    if (goal) { $("#goAdd", B).onclick = () => move(1); $("#goTake", B).onclick = () => move(-1); $("#goDel", B).onclick = () => { if (!confirm(`Delete "${goal.name}"?`)) return; closeSheet(); const copy = { ...goal }; store.remove("goals", goal.id); toast(`Deleted ${goal.name}`, { label: "Undo", run: () => store.put("goals", copy) }); }; }
  }, onRight: B => {
    const msg = t => { $("#goMsg", B).textContent = t; $("#goMsg", B).dataset.state = "error"; };
    const name = $("#goName", B).value.trim(), target = parseMoney($("#goTarget", B).value), monthly = parseMoney($("#goMonthly", B).value);
    if (!name) return msg("Give the goal a name.");
    if (!target || Number.isNaN(target)) return msg("Type the target, like 5000.");
    if (Number.isNaN(monthly)) return msg("Type the monthly amount as a number.");
    const savedIn = goal ? goal.saved : parseMoney($("#goSaved", B).value);
    if (Number.isNaN(savedIn)) return msg("Type what you've saved as a number.");
    store.put("goals", { ...(goal || {}), id: goal ? goal.id : undefined, name, target, saved: savedIn || 0, targetDate: $("#goDate", B).value || null, monthly, position: goal ? goal.position : store.model.goals.length });
    closeSheet(); toast(goal ? "Saved" : `Added ${name}`);
  } });
}
