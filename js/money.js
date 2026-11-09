// Budgets (what's left until payday, categories, projects, savings goals, spending by month). Spent is in spent.js.
// Also the add/edit expense, categories and receipt sheets.
import { store, todayISO, TX_KINDS, BILLS_CAT, projectOf, listOf, topLists, projectSpent, paidByReceipt } from "./data.js";
import { billTotals, openBill, goalsHTML, openGoal, savedOf, spendOf, spendId, spendFromGoal } from "./plan.js";
import { incomeTotals, nextPay } from "./income.js";
import { $, $$, esc, eur, eur0, icon, parseMoney, moneyField, parseDay, fmtDay, openSheet, closeSheet, toast, svgEl as el, showTip, hideTip, spinner } from "./ui.js";
import { parseExpense } from "./voice.js";
import { prepareFile, readReceipt, attach, receiptURL, removeReceipt, isPdf } from "./receipts.js";
import { newId } from "./data.js";
import { monthLedger, startPoint, effectiveBudgets, ADJUST_CAT, SAVINGS_CAT, awaitingIncome } from "./ledger.js";
import * as E from "./engine.js";
import { markPaid, setSkipped } from "./plan.js";
import { receive, setMissed } from "./income.js";

/* ---------- Periods ---------- */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startDay = () => Math.min(28, Math.max(1, Number(store.model.settings.monthStart) || 1));
export function periodFor(date, sd = startDay()) {
  let y = date.getFullYear(), m = date.getMonth(); if (date.getDate() < sd) m -= 1;
  const start = new Date(y, m, sd), end = new Date(y, m + 1, sd - 1);
  return { start, end, from: iso(start), to: iso(end) };
}
export const shift = (p, n) => periodFor(new Date(p.start.getFullYear(), p.start.getMonth() + n, p.start.getDate()));
export function periodLabel(p, long = true) {
  if (p.start.getDate() === 1) return p.start.toLocaleDateString("en-GB", long ? { month: "long", year: "numeric" } : { month: "short" });
  return `${fmtDay(p.start)} – ${fmtDay(p.end)}`;
}
export const nextPayday = () => nextPay();
export function navHTML(prefix) {
  return `<div class="mo-nav"><button type="button" class="mo-arrow" data-${prefix}="-1" aria-label="Previous month">${icon("chev", "ic sm flip")}</button><b data-period></b><button type="button" class="mo-arrow" data-${prefix}="1" aria-label="Next month">${icon("chev", "ic sm")}</button><button type="button" class="mo-today" data-${prefix}="0" hidden>This month</button></div>`;
}

/* ---------- Totals ---------- */
export const catName = id => {
  if (id === BILLS_CAT) return "Bills";
  if (id === ADJUST_CAT) return "Balance correction";
  if (id === SAVINGS_CAT) return "Savings";
  if (id && id.startsWith("proj:")) return (listOf(id.slice(5)) || {}).name || "Project";
  return (store.model.categories.find(c => c.id === id) || {}).name || "Uncategorised";
};
/* Purchases ticked in a project (like Home setup) count as spending in the month they were bought. */
export const projectEntries = p => E.projectEntries(store.model, p.from, p.to).map(e => ({ ...e, amount: E.euros(e.amount), kind: "expense", note: null, fromProject: true }));
/* A budget month's totals (worked out in js/engine.js), in euros. */
export function totals(p) {
  const T = E.monthTotals(store.model, { from: p.from, to: p.to }, todayISO()), eu = E.euros, map = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, eu(v)]));
  const bills = billTotals(p), inc = incomeTotals(p), tx = store.model.transactions.filter(t => t.date >= p.from && t.date <= p.to);
  return { tx, byCat: map(T.byCat), spend: eu(T.spend), everyday: eu(T.everyday), projects: eu(T.projects), byProject: map(T.byProject), setup: eu(T.projects), total: eu(T.total),
    income: T.income == null ? null : eu(T.income), inc, incomeLoose: eu(T.incomeLoose), bills, billsPaid: eu(T.billsPaid), billsDue: bills.due };
}
export function pace(p) { const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()); if (t0 < p.start) return 0; if (t0 > p.end) return 1; const days = Math.round((p.end - p.start) / 864e5) + 1; return (Math.round((t0 - p.start) / 864e5) + 1) / days; }



/* ---------- Category colours and the pie view ---------- */
const CAT_COLORS = ["#1f8a5a", "#e07a3f", "#3a6ea5", "#8e5bb5", "#d14d72", "#d9a520", "#2a9d8f", "#7c6f64", "#5c6bc0", "#b5651d"];
export function catColor(id) {
  const cs = store.model.categories.slice().sort((a, b) => a.position - b.position), i = cs.findIndex(c => c.id === id);
  return i < 0 ? "#8a958f" : CAT_COLORS[i % CAT_COLORS.length];
}
const heroView = () => { try { return localStorage.getItem("koti.heroView") || "bars"; } catch { return "bars"; } };
const viewToggle = () => `<span class="vt" role="group" aria-label="Chart type"><button type="button" data-hview="bars" aria-pressed="${heroView() === "bars"}" aria-label="Waterfall chart">${icon("budgets", "ic xs")}</button><button type="button" data-hview="pie" aria-pressed="${heroView() === "pie"}" aria-label="Pie chart">${icon("pie", "ic xs")}</button></span>`;
function pieParts(L) {
  const parts = [];
  if (L.kind === "plan") {
    if (L.bills) parts.push(["Bills", L.bills, "var(--wall)"]);
    store.model.categories.slice().sort((a, b) => a.position - b.position).forEach(c => { if (Number(c.budget) > 0) parts.push([c.name, Number(c.budget), catColor(c.id)]); });
    if (L.goals) parts.push(["Goals", L.goals, "var(--amber)"]);
    if (L.left > 0) parts.push(["Left", L.left, "var(--pie-left)"]);
    return parts;
  }
  const T = totals(L.p);
  Object.entries(T.byCat).filter(([k, v]) => k !== BILLS_CAT && v > 0).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => parts.push([k === "none" ? "No category" : catName(k), v, k === "none" ? "#9aa59f" : catColor(k)]));
  if (T.projects > 0) parts.push(["Projects", T.projects, "var(--amber)"]);
  if (L.bills > 0) parts.push(["Bills paid", L.bills, "var(--wall)"]);
  if (L.kind === "current" && L.due > 0) parts.push(["Still due", L.due, "#b5651d"]);
  const rest = L.kind === "current" ? L.left : L.end;
  if (rest > 0) parts.push([L.kind === "current" ? "Left" : "End", rest, "var(--pie-left)"]);
  return parts;
}
function pieHTML(parts, center, sub) {
  const tot = parts.reduce((a, p) => a + p[1], 0);
  if (!tot) return `<p class="hint" style="margin:14px 0 4px">Nothing to show yet.</p>`;
  let a = -Math.PI / 2, svg = `<svg class="pie" viewBox="0 0 140 140" role="img" aria-label="${esc(parts.map(p => `${p[0]} ${eur0(p[1])}`).join(", "))}">`;
  const R = 62, r = 40, P = (ang, rad) => [70 + rad * Math.cos(ang), 70 + rad * Math.sin(ang)];
  parts.forEach(([, v, c], i) => {
    let b = a + 2 * Math.PI * v / tot; if (parts.length === 1) b = a + 2 * Math.PI - 0.0001;
    const lg = b - a > Math.PI ? 1 : 0, [x1, y1] = P(a, R), [x2, y2] = P(b, R), [x3, y3] = P(b, r), [x4, y4] = P(a, r);
    svg += `<path data-slice="${i}" d="M${x1.toFixed(2)} ${y1.toFixed(2)}A${R} ${R} 0 ${lg} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}L${x3.toFixed(2)} ${y3.toFixed(2)}A${r} ${r} 0 ${lg} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}Z" fill="${c}"/>`;
    a = b;
  });
  svg += `<text x="70" y="70" class="pc">${esc(center)}</text><text x="70" y="85" class="ps">${esc(sub)}</text></svg>`;
  return `<div class="piewrap">${svg}<div class="plegend">${parts.map(([l, v, c], i) => `<button type="button" data-slice="${i}"><i style="background:${c}"></i><span>${esc(l)}</span><b class="num">${eur0(v)}</b></button>`).join("")}</div></div>`;
}

/* ---------- Budgets hero: a waterfall from what was carried in to what's left ---------- */
const money0 = v => (v < 0 ? "−" : "") + eur0(Math.abs(v));
let lastSteps = [];   // the bars last drawn, to describe a tapped bar
function waterfall(steps) {
  // steps: { label, value, kind: start|in|out|due|total|ghost, info }
  const W = 340, H = 150, top = 18, bot = 24; let run = 0; const segs = [];
  steps.forEach(st => { let a, b;
    if (st.kind === "start") { a = 0; b = st.value; run = st.value; }
    else if (st.kind === "total") { a = 0; b = run; }
    else if (st.kind === "ghost") { a = run; b = run + st.value; }
    else { a = run; b = run + st.value; run += st.value; }
    segs.push({ ...st, a, b }); });
  lastSteps = segs;
  const lo = Math.min(0, ...segs.map(x => Math.min(x.a, x.b))), hi = Math.max(1, ...segs.map(x => Math.max(x.a, x.b)));
  const y = v => top + (hi - v) / (hi - lo || 1) * (H - top - bot), bw = (W - 8) / segs.length;
  const fill = { start: "var(--wall)", in: "var(--spruce)", out: "var(--wf-out)", due: "var(--amber)", total: "var(--spruce)" };
  let out = `<svg class="wf" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(segs.map(x => `${x.label} ${money0(x.value)}`).join(", "))}"><line class="zero" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>`;
  let prev = null;
  segs.forEach((x, i) => {
    const bx = 4 + i * bw + bw * .17, w = bw * .66, y1 = Math.min(y(x.a), y(x.b)), y2 = Math.max(y(x.a), y(x.b)), h = Math.max(2, y2 - y1);
    const f = x.kind === "start" && x.value < 0 ? "var(--crit)" : x.kind === "total" && x.value < 0 ? "var(--crit)" : fill[x.kind];
    if (prev && x.kind !== "total") out += `<line class="conn" x1="${prev.x}" x2="${bx}" y1="${prev.y}" y2="${prev.y}"/>`;
    out += `<g class="wf-bar" data-wf="${i}" tabindex="0"><rect x="${bx}" y="${y1}" width="${w}" height="${h}" rx="3" ${x.kind === "ghost" ? 'class="ghost"' : `fill="${f}"`}/>`;
    const below = (x.kind === "out" || x.kind === "due") || (x.value < 0 && (x.kind === "start" || x.kind === "total"));
    out += `<text class="v${x.kind === "ghost" ? " g" : ""}" x="${bx + w / 2}" y="${below ? Math.min(y2 + 11, H - bot + 2) : y1 - 4}">${(x.kind === "in" || x.kind === "ghost") ? "+" : ""}${money0(x.value)}</text>`;
    out += `<text class="l" x="${bx + w / 2}" y="${H - 6}">${esc(x.label)}</text><rect x="${4 + i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"/></g>`;
    prev = { x: bx + w, y: y(x.kind === "ghost" ? x.a : x.b) };
  });
  return out + `</svg><p class="wf-info" aria-live="polite">Tap a bar for details.</p>`;
}
export function heroHTML(L) {
  const S = store.model.settings, pd = nextPay(), today = todayISO();
  if (L.kind === "before") return `<h2>Before you started counting</h2><p class="hint" style="font-size:13px;margin-top:6px">Your starting balance is from ${fmtDay(parseDay(startPoint().date))}. Months before that show spending only.</p>`;
  if (L.kind === "plan") {
    const steps = [{ label: "Start", value: L.start, kind: "start", info: "Expected start: what's left this month plus income still expected" }];
    if (L.bills) steps.push({ label: "Bills", value: -L.bills, kind: "out", info: `${L.billList.length} bill${L.billList.length === 1 ? "" : "s"} planned` });
    if (L.budgets) steps.push({ label: "Budgets", value: -L.budgets, kind: "out", info: "Your category budgets" });
    if (L.goals) steps.push({ label: "Goals", value: -L.goals, kind: "out", info: "Set aside for savings goals" });
    steps.push({ label: "Left", value: L.left, kind: "total", info: "Planned left before payday" });
    if (L.incomeSum) steps.push({ label: "Income", value: L.incomeSum, kind: "ghost", info: `Planned: ${L.income.map(o => `${o.src.name} ${fmtDay(parseDay(o.due))}`).join(", ")}. Not counted until received.` });
    return `<div class="card-head" style="margin-bottom:2px"><h2>Planned left until payday</h2><span class="hr">${viewToggle()}<span class="chip">Plan</span></span></div>
      <div class="big muted-big">${money0(L.left)}</div><div class="hint" style="font-size:13px">If everything arrives and goes as planned</div>
      ${heroView() === "pie" ? pieHTML(pieParts(L), money0(L.left), "planned left") : `${waterfall(steps)}
      <div class="key wf-key"><span><i class="sw" style="background:var(--wall)"></i>Expected start</span><span><i class="sw" style="background:var(--wf-out)"></i>Planned out</span>${L.incomeSum ? `<span><i class="sw gk"></i>Planned income</span>` : ""}</div>`}`;
  }
  const startLabel = L.startsHere ? "Start" : "Carried";
  const steps = [{ label: startLabel, value: L.carried, kind: "start", info: L.startsHere ? "Your starting balance" : `Carried from ${periodLabel(shift(L.p, -1), false)}` }];
  if (L.income) steps.push({ label: "Income", value: L.income, kind: "in", info: "Income received this month" });
  if (L.spent) steps.push({ label: "Spent", value: -L.spent, kind: L.spent > 0 ? "out" : "in", info: "Everyday spending and projects" });
  if (L.bills) steps.push({ label: "Bills", value: -L.bills, kind: "out", info: "Bills paid" });
  if (L.adjust) steps.push({ label: "Fix", value: L.adjust, kind: L.adjust > 0 ? "in" : "out", info: "Corrections from Check with bank" });
  if (L.kind === "past") {
    steps.push({ label: "End", value: L.end, kind: "total", info: "Carried into the next month" });
    return `<div class="card-head" style="margin-bottom:2px"><h2>Month ended with</h2><span class="hr">${viewToggle()}${L.end < 0 ? `<span class="chip crit">Short</span>` : ""}</span></div>
      <div class="big ${L.end < 0 ? "danger" : ""}">${money0(L.end)}</div><div class="hint" style="font-size:13px">Carried into ${periodLabel(shift(L.p, 1), false)}${L.unpaid.length ? ` · ${L.unpaid.length} bill${L.unpaid.length === 1 ? "" : "s"} not paid (now overdue)` : ""}</div>${heroView() === "pie" ? pieHTML(pieParts(L), money0(L.end), "at month end") : waterfall(steps)}`;
  }
  if (L.due) steps.push({ label: "Due", value: -L.due, kind: "due", info: `${L.dueThisMonth.length + L.overdue.length} bill${L.dueThisMonth.length + L.overdue.length === 1 ? "" : "s"} still to pay${L.overdue.length ? `, ${L.overdue.length} overdue` : ""}` });
  steps.push({ label: "Left", value: L.left, kind: "total", info: "Left until payday" });
  if (L.expectedSum) steps.push({ label: "Expected", value: L.expectedSum, kind: "ghost", info: `${L.expected.map(o => `${o.src.name} ${fmtDay(parseDay(o.due))}`).join(", ")}. Not counted until it arrives.` });
  const days = pd ? Math.max(1, pd.days) : null, perDay = days && L.left > 0 ? L.left / days : 0;
  const chip = L.left < 0 ? `<span class="chip crit">Over by ${eur0(-L.left)}</span>` : L.carried > 0 && L.left < L.carried * .1 ? `<span class="chip warn">Running low</span>` : `<span class="chip ok">On track</span>`;
  return `<div class="card-head" style="margin-bottom:2px"><h2>Left until payday</h2><span class="hr">${viewToggle()}${chip}</span></div>
    <div class="big ${L.left < 0 ? "danger" : ""}">${money0(L.left)}</div>
    <div class="hint" style="font-size:13px">${pd && pd.days === 0 ? "Payday today" : perDay ? `About ${eur0(perDay)} a day for ${days} day${days === 1 ? "" : "s"}` : pd ? `${pd.days} days to payday` : ""}${!startPoint().set ? ` · <button type="button" class="link-inline" data-start>Set your starting balance</button>` : ""}</div>
    ${heroView() === "pie" ? pieHTML(pieParts(L), money0(Math.max(0, L.left)), `left of ${money0(L.carried + L.income + L.adjust)}`) + (L.expectedSum ? `<p class="expect-note">${icon("clock", "ic xs")} ${esc(L.expected.map(o => `${o.src.name} ${eur0(Number(o.src.amount) || 0)} expected ${fmtDay(parseDay(o.due))}`).join(", "))} · not counted until it arrives</p>` : "") : `${waterfall(steps)}
    <div class="key wf-key"><span><i class="sw" style="background:${L.carried < 0 ? "var(--crit)" : "var(--wall)"}"></i>${L.startsHere ? "Starting balance" : "From last month"}</span><span><i class="sw" style="background:var(--wf-out)"></i>Out</span>${L.due ? `<span><i class="sw" style="background:var(--amber)"></i>Still due${L.overdue.length ? ` (${L.overdue.length} overdue)` : ""}</span>` : ""}${L.expectedSum ? `<span><i class="sw gk"></i>Expected, not counted</span>` : ""}</div>`}
    ${owedHTML(L)}
    <div class="nowrow"><span>In your account now <b class="num">${money0(L.now)}</b></span><button type="button" class="link" data-checkbank>Check with bank</button></div>`;
}
export function alertsHTML(L, isCur) {
  let h = "";
  const S = store.model.settings, st = startPoint();
  if (isCur && !st.set && !S.askedStart) h += `<div class="banner"><span class="t"><b>How much do you have right now?</b><small>Koti counts from there and carries what's left into each new month.</small></span><button type="button" class="go" data-start>Set</button><button type="button" class="link" data-start-skip aria-label="Not now">Later</button></div>`;
  if (L.kind === "current" && L.carried < 0 && !L.startsHere) h += `<div class="banner crit">${icon("alert", "ic")}<span class="t"><b>${esc(periodLabel(shift(L.p, -1), false))} ended ${eur0(-L.carried)} short</b><small>It's taken from this month, so you started at ${money0(L.carried)}.</small></span></div>`;
  if (isCur) awaitingIncome().slice(0, 2).forEach(o => { h += `<div class="banner ask"><span class="t"><b>Did ${esc(o.src.name.toLowerCase() === "salary" ? "your salary" : o.src.name)} arrive?</b><small>${eur(o.src.amount)} was expected ${fmtDay(parseDay(o.due))}.</small></span><button type="button" class="go" data-inc-got="${esc(o.src.id)}" data-due="${o.due}">It arrived</button><button type="button" class="link" data-inc-miss="${esc(o.src.id)}" data-due="${o.due}">It didn't come</button></div>`; });
  if (L.kind === "current" && L.overdue.length) h += `<div class="gh"><h2>Overdue</h2><a class="link" href="#bills">Bills</a></div><div class="grp">${L.overdue.map(o => `<div class="row od-row"><span class="ico r">${icon("bill")}</span><span class="rt">${esc(o.bill.name)}<small>Due ${fmtDay(parseDay(o.due))} · ${Math.round((parseDay(todayISO()) - parseDay(o.due)) / 864e5)} days late</small></span><span class="rv danger num">${eur(o.amount)}</span>
    <span class="od-acts"><button type="button" class="btn sm primary" data-od-paid="${esc(o.bill.id)}" data-due="${o.due}">Mark paid</button><button type="button" class="btn sm" data-od-skip="${esc(o.bill.id)}" data-due="${o.due}">Not owed</button></span></div>`).join("")}</div>`;
  return h;
}
/* Clicks inside a hero card and its alerts (Home, and past or future months in Budgets). */
export function bindHero(el, rerender) {
  el.addEventListener("click", e => {
    const bar = e.target.closest("[data-wf]");
    if (bar) { const svg = bar.closest("svg"), info = svg.nextElementSibling; $$(".wf-bar", svg).forEach(b => b.classList.toggle("on", b === bar));
      const lbl = $(".l", bar).textContent, val = $(".v", bar).textContent, st = lastSteps[Number(bar.dataset.wf)];
      if (info) info.textContent = `${lbl}: ${val}${st && st.info ? " · " + st.info : ""}`; return; }
    const hv = e.target.closest("[data-hview]"); if (hv) { try { localStorage.setItem("koti.heroView", hv.dataset.hview); } catch {} rerender(); return; }
    const sl = e.target.closest("[data-slice]"); if (sl) { const card = sl.closest(".piewrap"); $$("[data-slice]", card).forEach(x => x.classList.toggle("on", x.dataset.slice === sl.dataset.slice)); return; }
    if (e.target.closest("[data-start]")) { openStartBalance(); return; }
    if (e.target.closest("[data-start-skip]")) { store.updateSettings({ askedStart: true }); return; }
    if (e.target.closest("[data-checkbank]")) { openCheckBank(); return; }
    const g = e.target.closest("[data-inc-got]"); if (g) { const src = store.model.income.find(x => x.id === g.dataset.incGot); if (src) { const t = receive({ src, due: g.dataset.due }, src.amount); toast(`${src.name} received · ${eur(t.amount)}`, { label: "Undo", run: () => store.remove("transactions", t.id) }); } return; }
    const m = e.target.closest("[data-inc-miss]"); if (m) { const src = store.model.income.find(x => x.id === m.dataset.incMiss); if (src) { const o = { src, due: m.dataset.due }; setMissed(o, true); toast(`Marked as not received`, { label: "Undo", run: () => setMissed(o, false) }); } return; }
    const op = e.target.closest("[data-od-paid]"); if (op) { const b = store.model.bills.find(x => x.id === op.dataset.odPaid); if (b) { const o = { bill: b, due: op.dataset.due, amount: ((b.dues || {})[op.dataset.due] || {}).amount || b.amount }; const t = markPaid(o, todayISO(), true); toast(`${b.name} paid · ${eur(t.amount)}`, { label: "Undo", run: () => store.remove("transactions", t.id) }); } return; }
    const os = e.target.closest("[data-od-skip]"); if (os) { const b = store.model.bills.find(x => x.id === os.dataset.odSkip); if (b) { const o = { bill: b, due: os.dataset.due }; setSkipped(o, true); toast(`${b.name} marked not owed`, { label: "Undo", run: () => setSkipped(o, false) }); } }
  });
}

/* ---------- Starting balance and Check with bank ---------- */
export function openStartBalance() {
  const st = startPoint(), today = todayISO();
  openSheet({ title: "Your money today", right: "Save", body: `
    <h3 class="lead">How much do you have right now?</h3>
    <p class="note" style="margin-top:0">Your accounts added up, without savings you don't spend.</p>
    <label class="amount-in"><span class="sr">Amount in euros</span><span aria-hidden="true">€</span><input id="sbAmt" inputmode="decimal" placeholder="0,00" autocomplete="off" autofocus value="${st.set ? String(Math.round((st.amount + (st.date <= today ? 0 : 0)) * 100) / 100).replace(".", ",") : ""}"></label>
    <p class="note">Spending you've already added for today is taken into account.</p>
    <p class="msg" id="sbMsg" aria-live="polite"></p>`,
    onRight: B => { const v = parseMoney($("#sbAmt", B).value); if (v == null || Number.isNaN(v)) { $("#sbMsg", B).dataset.state = "error"; $("#sbMsg", B).textContent = "Type the amount, like 1250 or 1 250,50."; return; }
      const neg = /^\s*-/.test($("#sbAmt", B).value) ? -1 : 1;
      setBalanceNow(neg * v); closeSheet(); toast("Starting balance saved"); } });
}
/* Sets the starting point so that today's balance equals the amount you typed. */
export function setBalanceNow(amount) {
  const today = todayISO(); let todayNet = 0;
  store.model.transactions.forEach(t => { if (t.date !== today) return; if (t.categoryId === ADJUST_CAT) todayNet += t.kind === "expense" ? -t.amount : t.amount; else if (t.kind === "income" || t.kind === "refund") todayNet += t.amount; else todayNet -= t.amount; });
  store.updateSettings({ startDate: today, startBalance: Math.round((amount - todayNet) * 100) / 100, askedStart: true });
}
export function openCheckBank() {
  const L = monthLedger(periodFor(new Date()));
  openSheet({ title: "Check with bank", right: "Save", body: `
    <p class="note" style="margin-top:0">Koti thinks you have <b class="num">${money0(L.now)}</b>. Type what your bank shows right now and Koti adds a correction so the numbers match.</p>
    <label class="amount-in"><span class="sr">Amount in euros</span><span aria-hidden="true">€</span><input id="cbAmt" inputmode="decimal" placeholder="0,00" autocomplete="off" autofocus></label>
    <p class="msg" id="cbMsg" aria-live="polite"></p>`,
    onRight: B => { const raw = $("#cbAmt", B).value, v0 = parseMoney(raw); if (v0 == null || Number.isNaN(v0)) { $("#cbMsg", B).dataset.state = "error"; $("#cbMsg", B).textContent = "Type the amount from your bank."; return; }
      const v = /^\s*-/.test(raw) ? -v0 : v0;
      if (!startPoint().set) { setBalanceNow(v); closeSheet(); toast("Starting balance saved"); return; }
      const diff = Math.round((v - L.now) * 100) / 100; closeSheet();
      if (Math.abs(diff) < 0.01) { toast("Already matches your bank"); return; }
      const t = store.put("transactions", { id: newId("adj"), date: todayISO(), amount: Math.abs(diff), kind: diff > 0 ? "income" : "expense", categoryId: ADJUST_CAT, payee: "Balance correction", note: null, source: "manual" });
      toast(`Corrected by ${diff > 0 ? "+" : "−"}${eur(Math.abs(diff))}`, { label: "Undo", run: () => store.remove("transactions", t.id) }); } });
}

/* ---------- Budgets view (under Income) ---------- */
export const moneySwitch = active => `<nav class="seg seg-links" aria-label="Income or budgets"><a href="#income"${active === "income" ? ' aria-current="page"' : ""}>Income</a><a href="#budgets"${active === "budgets" ? ' aria-current="page"' : ""}>Budgets</a></nav>`;
let root = null, view = null;
export function mountMoney(elm) {
  root = elm; view = periodFor(new Date());
  root.innerHTML = `
  <header class="vh"><div><a class="back" href="#month">${icon("chev", "ic sm flip")} Month</a><h1>Budgets</h1><div class="sub" id="moSub"></div></div><a class="sync" href="#settings" data-sync><span class="dot"></span><span class="t"></span></a></header>
  ${moneySwitch("budgets")}
  ${navHTML("shift")}
  <div class="mo-top">
    <section class="card mo-hero" id="moHero"></section>
    <div class="stats mo-stats"><div class="stat" id="moSpendStat"></div><div class="stat" id="moSetupStat"></div></div>
  </div>
  <div class="mo-mid">
    <section><div class="gh"><h2>Categories</h2><span class="gh-acts"><button type="button" class="link" data-suggest-budgets>Suggest</button><button type="button" class="link" data-open="categories">Edit</button></span></div><div class="grp" id="moBudgets"></div><p class="note" id="moPaceNote"></p>
      <div id="moProjWrap"><div class="gh"><h2>Projects</h2></div><div class="grp" id="moProjects"></div></div></section>
    <section><div class="gh"><h2>Savings goals</h2><button type="button" class="link" data-goal-add>Add</button></div><div id="moGoals"></div>
      <div class="gh"><h2>By month</h2></div><div class="card"><div class="chart" id="moColsWrap"><svg id="moCols" role="img"></svg><div class="tip"></div></div><div class="key" style="margin-top:8px"><span><i class="sw" style="background:var(--spruce)"></i>Spent</span><span id="moIncKey"><i class="ln" style="background:var(--amber)"></i>Income</span></div></div></section>
  </div>`;
  bindHero(root, () => renderMoney());
  root.addEventListener("click", e => {
    const s = e.target.closest("[data-shift]"); if (s) { const n = Number(s.dataset.shift); view = n === 0 ? periodFor(new Date()) : shift(view, n); renderMoney(); return; }
    if (e.target.closest("[data-goal-add]")) { openGoal(); return; }
    const g = e.target.closest("[data-goal]"); if (g) { const goal = store.model.goals.find(x => x.id === g.dataset.goal); if (goal) openGoal(goal); return; }
    if (e.target.closest("[data-rollover]")) { const on = !store.model.settings.rollover; store.updateSettings({ rollover: on }); toast(on ? "Unspent budgets now carry over" : "Budgets start fresh each month"); return; }
    const c = e.target.closest("[data-cat]"); if (c) openCategories();
  });
}


export function renderMoney() {
  if (!root) return;
  const cur = periodFor(new Date()), isCur = view.from === cur.from, isFuture = view.from > cur.from;
  const T = totals(view), pd = nextPay();
  $("[data-period]", root).textContent = periodLabel(view);
  $(".mo-today", root).hidden = isCur;
  $("#moSub", root).textContent = `Budgets ${isCur ? "this month" : isFuture ? "planned" : "in a past month"}`;
  // This month's money picture lives on Home; past and future months show it here.
  const H = $("#moHero", root); H.hidden = isCur; $(".mo-top", root).classList.toggle("solo", isCur);
  if (!isCur) H.innerHTML = heroHTML(monthLedger(view));
  const budgeted = effectiveBudgets(view).total;
  $("#moSpendStat", root).innerHTML = `<div class="k">Everyday spending</div><div class="v">${eur0(T.everyday)}</div><div class="meter"><i style="width:${budgeted ? Math.min(100, T.everyday / budgeted * 100) : 0}%;background:${budgeted && T.everyday > budgeted ? "var(--crit)" : "var(--spruce)"}"></i></div><div class="s">${budgeted ? `of ${eur0(budgeted)} budgeted` : "No budgets set"}</div>`;
  $("#moSetupStat", root).innerHTML = `<div class="k">Bills</div><div class="v">${eur0(T.bills.total)}</div><div class="meter"><i style="width:${T.bills.total ? Math.min(100, T.billsPaid / T.bills.total * 100) : 0}%;background:var(--wall)"></i></div><div class="s">${T.bills.count ? `${T.bills.paidCount} of ${T.bills.count} paid` : "No bills this month"}</div>`;

  const pc = isCur ? pace(view) : isFuture ? 0 : 1;
  const B = effectiveBudgets(view).byId;
  const rows = store.model.categories.slice().sort((a, b) => a.position - b.position).map(c => ({ id: c.id, name: c.name, budget: c.budget == null ? null : B[c.id], base: c.budget, spent: T.byCat[c.id] || 0 }));
  if (T.byCat.none) rows.push({ id: "none", name: "Uncategorised", budget: null, spent: T.byCat.none });
  Object.keys(T.byCat).filter(k => k !== "none" && k !== BILLS_CAT && !store.model.categories.some(c => c.id === k)).forEach(k => rows.push({ id: k, name: "Deleted category", budget: null, spent: T.byCat[k] }));
  $("#moBudgets", root).innerHTML = rows.map(r => {
    const ratio = r.budget ? r.spent / r.budget : 0, over = r.budget != null && r.spent > r.budget;
    const col = over ? "var(--crit)" : catColor(r.id);
    const right = r.budget ? (over ? `<span class="danger">${eur0(r.spent - r.budget)} over</span>` : `${eur0(r.budget - r.spent)} left`) : eur0(r.spent);
    return `<button type="button" class="row r2" data-cat="${esc(r.id)}" aria-label="${esc(r.name)}: ${eur(r.spent)} spent${r.budget ? ` of ${eur(r.budget)}` : ""}"><span class="rt"><span><i class="cdot" style="background:${catColor(r.id)}"></i>${esc(r.name)}</span><small class="num">${r.budget ? `${eur0(r.spent)} of ${eur0(r.budget)}${r.base != null && Math.abs(r.budget - r.base) >= 0.5 ? ` (${r.budget > r.base ? "+" : "−"}${eur0(Math.abs(r.budget - r.base))} rolled over)` : ""}` : "No budget"}</small></span><span class="rv">${right}</span>
      ${r.budget ? `<span class="bullet"><i style="width:${Math.min(100, ratio * 100)}%;background:${col}"></i>${pc > 0 && pc < 1 ? `<span class="pace" style="left:${pc * 100}%"></span>` : ""}</span>` : ""}</button>`;
  }).join("") || `<div class="row"><span class="rt muted">No categories yet</span></div>`;
  const ro = !!store.model.settings.rollover;
  $("#moPaceNote", root).innerHTML = `${pc > 0 && pc < 1 ? "The line on each bar marks where you'd be at an even pace through the month. " : ""}${ro ? "Unspent money carries into next month, and overspending takes from it." : "Each category starts fresh every month."} <button type="button" class="link-inline" data-rollover>${ro ? "Turn off carry over" : "Carry unspent money over"}</button>`;

  const projects = topLists().filter(l => l.kind === "project");
  $("#moProjWrap", root).hidden = !projects.length;
  $("#moProjects", root).innerHTML = projects.map(pr => { const total = projectSpent(pr.id), month = T.byProject[pr.id] || 0, b = Number(pr.budget) || 0;
    return `<a class="row r2" href="#list/${encodeURIComponent(pr.id)}"><span class="rt">${esc(pr.name)}<small class="num">${eur0(month)} this month · ${eur0(total)}${b ? ` of ${eur0(b)}` : ""} in total</small></span><span class="rv">${b ? (total > b ? `<span class="danger">${eur0(total - b)} over</span>` : `${eur0(b - total)} left`) : ""}</span>${b ? `<span class="bullet"><i style="width:${Math.min(100, total / b * 100)}%;background:${total > b ? "var(--crit)" : "var(--amber)"}"></i></span>` : ""}</a>`; }).join("");
  $("#moGoals", root).innerHTML = goalsHTML();
  drawCols();
}

function drawCols() {
  const wrap = $("#moColsWrap", root), svg = $("#moCols", root), tip = $(".tip", wrap); svg.innerHTML = ""; hideTip(tip);
  if (wrap.offsetParent === null) return;
  const ps = [-5, -4, -3, -2, -1, 0].map(n => shift(view, n)).map(p => ({ p, t: totals(p) }));
  const income = totals(view).income;
  $("#moIncKey", root).hidden = !income;
  const W = Math.max(260, wrap.clientWidth), H = 200, m = { l: 48, r: income ? 56 : 12, t: 20, b: 24 };
  const maxV = Math.max(income || 0, ...ps.map(x => x.t.total)) * 1.12 || 100;
  const step = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000].find(s => maxV / s <= 4) || 10000, top = Math.ceil(maxV / step) * step;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("aria-label", "Spending by month: " + ps.map(x => `${periodLabel(x.p, false)} ${eur0(x.t.total)}`).join(", "));
  const Y = v => H - m.b - v / top * (H - m.t - m.b), bw = (W - m.l - m.r) / ps.length, w = Math.min(24, bw * .5);
  const g = el("g", { class: "gridl" }, svg), ax = el("g", { class: "axis" }, svg);
  for (let v = 0; v <= top; v += step) { el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, g); el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, ax).textContent = eur0(v); }
  ps.forEach(({ p, t }, i) => {
    const cx = m.l + bw * i + bw / 2, x = cx - w / 2, y = Y(t.total), last = i === ps.length - 1;
    if (t.total > 0) el("path", { d: `M${x} ${Y(0)} V${y + 4} a4 4 0 0 1 4 -4 H${x + w - 4} a4 4 0 0 1 4 4 V${Y(0)} Z`, fill: "var(--spruce)", opacity: last ? 1 : .45 }, svg);
    el("text", { x: cx, y: H - 6, "text-anchor": "middle" }, ax).textContent = periodLabel(p, false).split(" – ")[0].replace(/^\d+ /, "");
    if (last && t.total > 0) el("text", { x: cx, y: y - 7, "text-anchor": "middle", style: "font:600 12px var(--body);fill:var(--ink);font-variant-numeric:tabular-nums" }, svg).textContent = eur0(t.total);
    const hit = el("rect", { x: m.l + bw * i, y: m.t, width: bw, height: H - m.t - m.b, fill: "transparent" }, svg);
    const show = () => { const s = svg.getBoundingClientRect().width / W; showTip(tip, `<b>${esc(periodLabel(p))}</b><br>${eur(t.total)} spent${t.projects ? ` (${eur0(t.projects)} on projects)` : ""}${income ? `<br>${t.total <= income ? eur0(income - t.total) + " left" : eur0(t.total - income) + " over"}` : ""}`, Math.min(Math.max(cx * s, 80), W * s - 80), Math.max(y, m.t + 30) * s); };
    hit.addEventListener("mousemove", show); hit.addEventListener("touchstart", show, { passive: true }); hit.addEventListener("mouseleave", () => hideTip(tip));
  });
  if (income) { el("line", { x1: m.l, x2: W - m.r, y1: Y(income), y2: Y(income), stroke: "var(--amber)", "stroke-width": 2 }, svg); el("text", { x: W - m.r + 6, y: Y(income) + 4, style: "font:12px var(--body);fill:var(--ink-2)" }, svg).textContent = "Income"; }
}

/* ---------- Add / edit expense ---------- */
const cats = () => store.model.categories.slice().sort((a, b) => a.position - b.position);
const recentPayees = () => [...new Set(store.model.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).map(t => t.payee).filter(Boolean))].slice(0, 30);
const payeeCat = payee => { const t = store.model.transactions.filter(x => x.payee && x.payee.toLowerCase() === String(payee).toLowerCase()).sort((a, b) => b.date.localeCompare(a.date))[0]; return t ? t.categoryId : null; };

export function openExpense({ tx = null, mode = "type", draft = null } = {}) {
  if (mode === "scan" && !tx) { import("./scan.js").then(m => m.openScan()); return; }   // scanning has one place: + → Scan or upload
  const editing = !!tx, d = tx || draft || { amount: null, categoryId: null, payee: "", date: todayISO(), note: "", kind: "expense" };
  const spent0 = tx ? spendOf(tx.id) : null;   // an expense paid from savings: its withdrawal
  let goalOn = spent0 ? spent0.id.split(":")[1] : d.goalId || null;
  let fromPayOn = !goalOn && (!!d.fromPay || !!d.fromNextPay), catId = d.categoryId, kind = d.kind || "expense", source = (tx && tx.source) || (draft && draft.source) || "manual", stop = null;
  let lines = d.lines ? d.lines.map(l => ({ ...l })) : null, aiNote = "";   // receipt lines, each with its own category or project
  let receipt = null, dropExisting = false, busy = false, keep = false;   // keep: save the new photo with the expense   // receipt: a newly prepared file; dropExisting: remove the saved one
  openSheet({
    title: editing ? "Expense" : "Add expense", right: "Save",
    onClose: () => { if (stop) stop(); },
    body: B => {
      B.innerHTML = `
        ${editing ? "" : `<div class="seg" role="tablist" aria-label="What to add"><button type="button" aria-pressed="true">Expense</button><button type="button" data-switch="item">Checklist item</button></div>`}
        <div id="exBody" style="display:grid;gap:12px"></div>
        <p class="msg" id="exMsg" aria-live="polite"></p>
        ${editing ? `<button type="button" class="btn danger" id="exDel">${icon("trash", "ic sm")} Delete expense</button>` : ""}`;
      const sw = $("[data-switch=item]", B); if (sw) sw.onclick = () => { closeSheet(); setTimeout(() => import("./setup.js").then(m => m.openAdd()), 260); };
      const modeSeg = $("#exMode", B);
      if (modeSeg) modeSeg.addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (!b) return; if (stop) { stop(); stop = null; } $$("[data-m]", modeSeg).forEach(x => x.setAttribute("aria-pressed", x === b)); paint(b.dataset.m); });
      const del = $("#exDel", B); if (del) del.onclick = () => {   // paid from savings: the money goes back into the goal too
        closeSheet(); const copy = { ...tx }, out = spendOf(tx.id), outCopy = out && { ...out };
        store.remove("transactions", tx.id); if (out) store.remove("transactions", out.id);
        toast(`Deleted ${eur(tx.amount)}`, { label: "Undo", run: () => { store.put("transactions", copy); if (outCopy) store.put("transactions", outCopy); } });
      };
      paint(editing || mode !== "scan" ? "type" : "scan");

      function msg(t, s = "error") { const m = $("#exMsg", B); m.textContent = t; m.dataset.state = s; }
      function chipsHTML() { return `<div class="chips cat-chips" role="radiogroup" aria-label="Category">${cats().map(c => `<button type="button" class="fchip" role="radio" data-c="${esc(c.id)}" aria-pressed="${c.id === catId}" aria-checked="${c.id === catId}">${esc(c.name)}</button>`).join("")}</div>`; }
      function bindChips(scope) { $(".cat-chips", scope).addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; catId = catId === b.dataset.c ? null : b.dataset.c; $$(".cat-chips [data-c]", scope).forEach(x => { x.setAttribute("aria-pressed", x.dataset.c === catId); x.setAttribute("aria-checked", x.dataset.c === catId); }); paintLines(scope); }); }

      function paint(m) {
        const E = $("#exBody", B);
        if (m === "type") {
          E.innerHTML = `
            <div id="exRc"></div>
            <label class="amount-in"><span class="sr">Amount in euros</span><span aria-hidden="true">€</span><input id="exAmt" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${d.amount != null ? String(d.amount.toFixed(2)).replace(".", ",") : ""}" ${editing ? "" : "autofocus"}></label>
            ${chipsHTML()}
            <div id="exLines"></div>
            <div class="grp">
              <label class="row"><span class="rt">Where</span><input class="inl" id="exPayee" list="exPayees" placeholder="Shop or place" autocomplete="off" maxlength="120" value="${esc(d.payee || "")}" style="max-width:60%"></label>
              <label class="row"><span class="rt">Date</span><input class="inl" id="exDate" type="date" value="${esc(d.date || todayISO())}"></label>
              <label class="row" id="exPayRow"><span class="rt">From my next pay<small id="exPaySm"></small></span><input type="checkbox" class="switch" id="exPay" ${fromPayOn ? "checked" : ""}></label>
              ${store.model.goals.length ? `<div class="row" id="exSaveRow"><label class="rt" for="exSave">From my savings<small id="exSaveSm"></small></label>
                ${store.model.goals.length > 1 ? `<select class="inl" id="exGoal" aria-label="Which savings">${store.model.goals.map(g => `<option value="${esc(g.id)}"${g.id === goalOn ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select>` : ""}
                <input type="checkbox" class="switch" id="exSave" ${goalOn ? "checked" : ""}></div>` : ""}
              <label class="row"><span class="rt">Note</span><input class="inl" id="exNote" placeholder="Optional" autocomplete="off" maxlength="500" value="${esc(d.note || "")}" style="max-width:60%"></label>
            </div>
            <datalist id="exPayees">${recentPayees().map(p => `<option value="${esc(p)}">`).join("")}</datalist>
            <div class="seg" id="exKind" aria-label="Type">${TX_KINDS.map(k => `<button type="button" data-k="${k}" aria-pressed="${k === kind}">${{ expense: "Paid", refund: "Refund", income: "Income" }[k]}</button>`).join("")}</div>`;
          bindChips(E);
          $("#exPayee", E).addEventListener("change", e => { if (!catId) { const c = payeeCat(e.target.value); if (c) { catId = c; $$(".cat-chips [data-c]", E).forEach(x => x.setAttribute("aria-pressed", x.dataset.c === catId)); } } });
          // From my next pay: what it means, by the day it comes out; only for something paid (not a refund or income).
          const payLine = () => {
            const row = $("#exPayRow", E); if (!row) return; row.hidden = kind !== "expense";
            const pay = payAfter($("#exDate", E).value || todayISO());
            $("#exPay", E).disabled = !pay;
            $("#exPay", E).checked = fromPayOn;
            $("#exPaySm", E).textContent = !pay ? "Add your pay in Income to use this" : fromPayOn ? `Comes out of your pay on ${payWords(pay)}` : "Off: it comes out of today's money";
            const sr = $("#exSaveRow", E); if (!sr) return;
            sr.hidden = kind !== "expense"; $("#exSave", E).checked = !!goalOn;
            const g = goalOn && store.model.goals.find(x => x.id === goalOn), pick = $("#exGoal", E);
            const back = spent0 && spent0.id.split(":")[1] === goalOn ? spent0.amount : 0;   // already taken out for this expense
            $("#exSaveSm", E).textContent = g ? `Comes out of ${g.name}, ${eur(savedOf(g) + back)} saved` : "Off: it comes out of today's money";
            if (pick) pick.disabled = !goalOn;
          };
          // Pay or savings: one or the other, or neither (today's money).
          $("#exPay", E).addEventListener("change", e => { fromPayOn = e.target.checked; if (fromPayOn) goalOn = null; payLine(); });
          const sv = $("#exSave", E), gp = $("#exGoal", E);
          if (sv) sv.addEventListener("change", () => { goalOn = sv.checked ? (gp ? gp.value : store.model.goals[0].id) : null; if (goalOn) fromPayOn = false; payLine(); });
          if (gp) gp.addEventListener("change", () => { if (goalOn) goalOn = gp.value; payLine(); });
          $("#exDate", E).addEventListener("change", payLine); payLine();
          $("#exKind", E).addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (!b) return; kind = b.dataset.k; $$("#exKind button", E).forEach(x => x.setAttribute("aria-pressed", x === b)); payLine(); });
          $("#exAmt", E).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });
          paintReceipt(E); paintLines(E);
          setTimeout(() => !editing && !receipt && $("#exAmt", E) && $("#exAmt", E).focus(), 80);
        } else if (m === "scan") {
          E.innerHTML = `
            <div class="scan-btns">
              <label class="btn primary" for="exCam">${icon("cam", "ic sm")} Take photo</label><input type="file" id="exCam" accept="image/*" capture="environment" class="sr">
              <label class="btn" for="exFile">${icon("up", "ic sm")} Upload a photo or PDF</label><input type="file" id="exFile" accept="image/*,application/pdf" class="sr">
              <div class="dropzone" id="exDrop">Or drop a receipt here</div>
            </div>
            <div id="exScan"></div>
            <p class="note">Koti reads the total, date and shop on this device. ${store.model.settings.keepReceipts ? "The photo is saved with the expense; you can switch that off before saving." : "The photo isn't saved unless you switch on Keep photo."}</p>`;
          const onFile = async e => { const f = e.target.files[0]; e.target.value = ""; if (f) await scanFile(f, E); };
          $("#exCam", E).addEventListener("change", onFile); $("#exFile", E).addEventListener("change", onFile);
          const Z = $("#exDrop", E);
          ["dragenter", "dragover"].forEach(ev => B.addEventListener(ev, e => { if (!$("#exDrop", B)) return; e.preventDefault(); Z.classList.add("over"); }));
          B.addEventListener("dragleave", e => { if (e.target === Z) Z.classList.remove("over"); });
          B.addEventListener("drop", e => { if (!$("#exDrop", B)) return; e.preventDefault(); Z.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) scanFile(f, E); });
        }
      }

      /* Receipt lines: each with a category or project; matched shopping-list items get ticked on save. */
      function lineTargets(sel) {
        const opts = [["", "Same as the expense"], ...cats().map(c => [c.id, c.name]), ...topLists().filter(l => l.kind === "project").map(pr => ["proj:" + pr.id, `${pr.name} (project)`])];
        return opts.map(([v, n]) => `<option value="${esc(v)}"${(sel || "") === v ? " selected" : ""}>${esc(n)}</option>`).join("");
      }
      function paintLines(E) {
        const L = $("#exLines", E); if (!L) return;
        if (!lines || !lines.length) { L.innerHTML = aiNote ? `<p class="note ai-note">${esc(aiNote)}</p>` : ""; return; }
        const sum = lines.reduce((a, l) => a + l.price, 0), by = {};
        lines.forEach(l => { const k = l.categoryId || catId || "none"; by[k] = (by[k] || 0) + l.price; });
        const ticks = lines.filter(l => l.itemId && store.model.items.some(i => i.id === l.itemId && !i.done)).length;
        L.innerHTML = `${aiNote ? `<p class="note ai-note">${icon("check", "ic xs")} ${esc(aiNote)}${ticks ? ` · ${ticks} list item${ticks === 1 ? "" : "s"} will be ticked off` : ""}</p>` : ""}
          <div class="gh" style="margin-top:4px"><h3>${lines.length} line${lines.length === 1 ? "" : "s"}</h3><span class="num">${eur(sum)}</span></div>
          <div class="grp lines">${lines.map((l, k) => `<div class="row li" data-line="${k}"><span class="rt">${esc(l.name)}<small>${[l.nameFi && l.nameFi.toLowerCase() !== l.name.toLowerCase() ? l.nameFi : "", l.qty && l.qty !== 1 ? `${String(l.qty).replace(".", ",")} ×` : "", l.itemId ? "✓ on your list" : ""].filter(Boolean).map(esc).join(" · ")}</small>
            <select class="line-cat" aria-label="Category for ${esc(l.name)}">${lineTargets(l.categoryId)}</select></span><span class="rv">${eur(l.price)}</span><button type="button" class="x" data-del-line aria-label="Remove ${esc(l.name)}">×</button></div>`).join("")}</div>
          <div class="splits">${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${esc(k === "none" ? "Uncategorised" : catName(k))} <b class="num">${eur(v)}</b></span>`).join("")}</div>`;
        $$("[data-line]", L).forEach(row => { const k = Number(row.dataset.line);
          $(".line-cat", row).onchange = e => { lines[k].categoryId = e.target.value || null; paintLines(E); };
          $("[data-del-line]", row).onclick = () => { lines.splice(k, 1); paintLines(E); }; });
      }

      async function scanFile(file, E) {
        const S = $("#exScan", E);
        try {
          busy = true; S.innerHTML = `<div class="scan-state"><div class="scan-thumb" id="exThumb"></div><div style="flex:1"><div class="sc-lbl">${spinner("Reading the receipt", "sm")}<b id="exScanLbl">Preparing the photo…</b></div><div class="meter" style="margin-top:8px"><i id="exScanBar" style="width:4%"></i></div></div></div>`;
          receipt = await prepareFile(file);
          keep = !!store.model.settings.keepReceipts;   // off unless switched on: storage costs
          $("#exThumb", S).innerHTML = receipt.type === "application/pdf" ? `<span class="pdf">PDF</span>` : `<img alt="" src="${URL.createObjectURL(receipt.blob)}">`;
          const r = await readReceipt(receipt, (p, label) => { const lb = $("#exScanLbl", S), bar = $("#exScanBar", S); if (lb) lb.textContent = label; if (bar) bar.style.width = Math.round(p * 100) + "%"; });
          const P = r.parsed || {};
          if (P.amount != null) d.amount = P.amount; if (P.date) d.date = P.date; if (P.payee) d.payee = P.payee; if (P.categoryId) catId = P.categoryId;
          lines = P.lines && P.lines.length ? P.lines : null;
          aiNote = r.ai ? `Read by AI${r.limit ? ` · ${r.used} of ${r.limit} scans today` : ""}` : r.aiError ? `Read on this device: total only. AI: ${r.aiError.message}` : "";
          source = "receipt"; busy = false;
          if (modeSeg) $$("[data-m]", modeSeg).forEach(x => x.setAttribute("aria-pressed", x.dataset.m === "type"));
          paint("type");
          msg(r.reply ? r.reply : receipt.type === "application/pdf" ? "PDF attached. Fill in the amount and shop." : P.amount != null ? (lines ? `Read ${lines.length} lines. Check the categories, then Save.` : "Read from the receipt. Check it, then Save.") : "Couldn't read the total. Type it in from the photo.", P.amount != null ? "ok" : "");
        } catch (err) { busy = false; S.innerHTML = ""; msg(String(err.message || err)); }
      }
      function paintReceipt(E) {
        const R = $("#exRc", E), path = !dropExisting && tx && tx.receiptPath;
        if (receipt) R.innerHTML = `<div class="rc-row"><span class="scan-thumb">${receipt.type === "application/pdf" ? `<span class="pdf">PDF</span>` : `<img alt="" src="${URL.createObjectURL(receipt.blob)}">`}</span>
          <label class="rt" for="exKeep" style="cursor:pointer">Keep photo<small>${keep ? "Saved privately with this expense" : "Only used for reading. Not saved."}</small></label>
          <input type="checkbox" class="switch" id="exKeep" ${keep ? "checked" : ""}>
          <button type="button" class="link" id="exRcDel" aria-label="Discard photo">${icon("trash", "ic sm")}</button></div>`;
        else if (path) { R.innerHTML = `<div class="rc-row"><span class="scan-thumb" id="exRcThumb">${isPdf(path) ? `<span class="pdf">PDF</span>` : ""}</span><span class="rt">Receipt<small>Tap to view</small></span><button type="button" class="link" id="exRcView">View</button><button type="button" class="link danger" id="exRcDel">Remove</button></div>`;
          if (!isPdf(path)) receiptURL(path).then(u => { const t = $("#exRcThumb", E); if (u && t) t.innerHTML = `<img alt="" src="${u}">`; }).catch(() => {});
          $("#exRcView", E).onclick = () => openReceipt(path); }
        else R.innerHTML = `<label class="rc-add" for="exRcFile">${icon("cam", "ic sm")} Attach receipt</label><input type="file" id="exRcFile" accept="image/*,application/pdf" class="sr">`;
        const del = $("#exRcDel", E); if (del) del.onclick = () => { if (receipt) receipt = null; else dropExisting = true; paintReceipt(E); };
        const kp = $("#exKeep", E); if (kp) kp.onchange = () => { keep = kp.checked; paintReceipt(E); };
        const add = $("#exRcFile", E); if (add) add.addEventListener("change", async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return;
          try { receipt = await prepareFile(f); keep = true; paintReceipt(E); if (!$("#exAmt", E).value) { msg("Reading the receipt…", ""); const r = await readReceipt(receipt); const P = r.parsed || {};
            if (P.amount != null && !$("#exAmt", E).value) $("#exAmt", E).value = String(P.amount.toFixed(2)).replace(".", ",");
            if (P.payee && !$("#exPayee", E).value) $("#exPayee", E).value = P.payee; if (P.date) $("#exDate", E).value = P.date; msg("");
            if (P.lines && P.lines.length) { lines = P.lines; if (!catId && P.categoryId) catId = P.categoryId; aiNote = r.ai ? "Read by AI" : ""; paintLines(E); } } } catch (err) { msg(String(err.message || err)); } });
      }

      async function save() {
        if (busy) return;
        const E = $("#exBody", B), typed = $("#exAmt", E);
        let amount = d.amount, payee = d.payee, date = d.date, note = d.note;
        if (typed) {
          amount = parseMoney(typed.value); payee = $("#exPayee", E).value.trim(); date = $("#exDate", E).value || todayISO(); note = $("#exNote", E).value.trim();
          if (Number.isNaN(amount)) return msg("Type the amount as a number, like 12,50.");
        }
        if (!amount || amount <= 0) return msg(typed ? "Type how much it was." : "Say or type the amount, like 12,50.");
        if (!catId && payee) catId = payeeCat(payee);
        const id = tx ? tx.id : newId("tx");
        let receiptPath = tx && !dropExisting ? tx.receiptPath : null;
        if (receipt && keep) { busy = true; try { if (tx && tx.receiptPath) await removeReceipt(tx.receiptPath); receiptPath = await attach(id, receipt); } catch (err) { busy = false; return msg("Couldn't keep the receipt on this device: " + (err.message || err)); } }
        else if (tx && dropExisting && tx.receiptPath) removeReceipt(tx.receiptPath);
        // An edit keeps the payday it was given (that pay may have come since); a new date finds its own.
        const pay = kind !== "expense" || !fromPayOn ? null : d.fromPay && d.date === date ? { date: d.fromPay } : payAfter(date);
        const goal = kind === "expense" && !pay && goalOn ? store.model.goals.find(x => x.id === goalOn) : null;
        const saved = store.put("transactions", { ...(tx || {}), id, date, amount, kind, fromPay: pay ? pay.date : null, categoryId: catId, payee: payee || null, note: note || null, source: tx ? tx.source : source, receiptPath, lines: lines && lines.length ? lines : null });
        // Its withdrawal from savings follows it: made, changed to match, or taken away.
        const was = spendOf(id);
        if (was && (!goal || was.id !== spendId(goal.id, id))) store.remove("transactions", was.id);
        if (goal) spendFromGoal(goal, saved);
        // Tick the shopping-list items this receipt covers, remembering what each cost.
        let ticked = 0;
        (lines || []).forEach(l => { const it = l.itemId && store.model.items.find(i => i.id === l.itemId); if (it && !it.done) { store.updateItem(it.id, { done: true, price: Math.round(l.price / (l.qty && l.qty > 0 ? l.qty : 1) * 100) / 100, boughtAt: date }); ticked++; } });
        closeSheet();
        if (editing) toast("Saved");
        else toast(`Saved ${eur(saved.amount)}${ticked ? ` · ${ticked} list item${ticked === 1 ? "" : "s"} ticked` : catId ? ` · ${catName(catId)}` : ""}`, { label: "Undo", run: () => store.remove("transactions", saved.id) });
        if (location.hash !== "#money" && !editing) { /* stay where you are */ }
      }
      $("#sheet .sh-head .r").onclick = save;
    },
  });
}

/* ---------- Categories and budgets ---------- */
export function openCategories() {
  openSheet({ title: "Categories and budgets", left: "Done", body: B => {
    const draw = () => {
      B.innerHTML = `<p class="note" style="margin-top:0">Monthly budget for each category. Leave a budget empty to just track spending.</p>
        <button type="button" class="btn" data-suggest-budgets>${icon("spark", "ic sm")} Let Koti suggest budgets</button>
        <div class="grp">${cats().map(c => `<div class="row" data-c="${esc(c.id)}"><input class="inl" style="text-align:left;flex:1;max-width:none;color:var(--ink)" value="${esc(c.name)}" aria-label="Category name" data-f="name" maxlength="60"><input class="inl" style="max-width:90px" data-f="budget" inputmode="decimal" placeholder="No budget" value="${moneyField(c.budget)}" aria-label="Monthly budget for ${esc(c.name)}"><button type="button" class="x" data-f="del" aria-label="Delete ${esc(c.name)}" style="color:var(--muted);width:32px;height:32px">${icon("trash", "ic sm")}</button></div>`).join("")}</div>
        <div class="field" style="margin-top:6px"><label for="ncName">New category</label><input class="inp" id="ncName" placeholder="e.g. Gifts…" maxlength="60" autocomplete="off"></div>
        <div class="field"><label for="ncBudget">Monthly budget</label><input class="inp" id="ncBudget" inputmode="decimal" placeholder="€0" autocomplete="off"></div>
        <button type="button" class="btn primary" id="ncAdd">Add category</button>
        <p class="note">Total budgeted: <b class="num">${eur0(cats().reduce((a, c) => a + (Number(c.budget) || 0), 0))}</b> a month.</p>`;
      $$("[data-c]", B).forEach(r => {
        const id = r.dataset.c, cat = () => store.model.categories.find(c => c.id === id);
        $("[data-f=name]", r).addEventListener("change", e => { const v = e.target.value.trim(); if (v) store.put("categories", { ...cat(), name: v }); else e.target.value = cat().name; });
        $("[data-f=budget]", r).addEventListener("change", e => { const v = parseMoney(e.target.value); if (Number.isNaN(v)) { toast("Type a number, like 400"); e.target.value = moneyField(cat().budget); return; } store.put("categories", { ...cat(), budget: v }); e.target.value = moneyField(v); draw(); });
        $("[data-f=del]", r).addEventListener("click", () => { const n = store.model.transactions.filter(t => t.categoryId === id).length;
          if (!confirm(n ? `Delete "${cat().name}"? Its ${n} expenses stay, marked as a deleted category.` : `Delete "${cat().name}"?`)) return; store.remove("categories", id); draw(); });
      });
      $("#ncAdd", B).onclick = () => { const n = $("#ncName", B).value.trim(); if (!n) { $("#ncName", B).focus(); return; }
        if (store.model.categories.some(c => c.name.toLowerCase() === n.toLowerCase())) { toast(`You already have "${n}"`); return; }
        const b = parseMoney($("#ncBudget", B).value); store.put("categories", { id: "cat-" + Date.now().toString(36), name: n, budget: Number.isNaN(b) ? null : b, position: store.model.categories.length }); draw(); };
    };
    draw();
  } });
}

/* ---------- Receipts: view one, list all ---------- */
export async function openReceipt(path) {
  openSheet({ title: "Receipt", left: "Close", body: B => {
    B.innerHTML = `<div class="rc-view" id="rcView"><p class="hint">Loading…</p></div>`;
    receiptURL(path).then(u => {
      const V = $("#rcView", B); if (!u) { V.innerHTML = `<p class="msg">Sign in to see receipts saved on your other devices.</p>`; return; }
      V.innerHTML = isPdf(path) ? `<a class="btn primary" href="${u}" target="_blank" rel="noopener">Open the PDF</a>` : `<img src="${u}" alt="Receipt photo"><a class="btn" href="${u}" target="_blank" rel="noopener" style="margin-top:10px">Open full size</a>`;
    }).catch(err => { $("#rcView", B).innerHTML = `<p class="msg" data-state="error">${esc(err.message || err)}</p>`; });
  } });
}
export function openReceiptsList() {
  const list = store.model.transactions.filter(t => t.receiptPath).sort((a, b) => b.date.localeCompare(a.date));
  openSheet({ title: "Receipts", left: "Done", body: B => {
    B.innerHTML = list.length ? `<p class="note" style="margin-top:0">${list.length} receipt${list.length === 1 ? "" : "s"}, newest first. Handy for returns and warranties.</p><div class="grp">${list.map(t => `<button type="button" class="row" data-rc="${esc(t.id)}"><span class="rt">${esc(t.payee || catName(t.categoryId))}<small>${fmtDay(parseDay(t.date))} ${parseDay(t.date).getFullYear()} · ${esc(catName(t.categoryId))}</small></span><span class="rv">${eur(t.amount)}</span></button>`).join("")}</div>`
      : `<p class="msg">No receipts yet. In Add expense, choose Scan to photograph one.</p>`;
    B.addEventListener("click", e => { const r = e.target.closest("[data-rc]"); if (!r) return; const t = store.model.transactions.find(x => x.id === r.dataset.rc); if (t) { closeSheet(); setTimeout(() => openExpense({ tx: t }), 260); } });
  } });
}

/* The payday a purchase on this day comes out of, when it's paid from the next pay: the first payday after it. */
export function payAfter(day) { return E.nextPay(store.model, E.addDays(day, 1)); }
export const payWords = pay => new Date(pay.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
/* What was bought "from my next pay": not taken from today's money, and named so the next pay isn't a surprise. */
export function owedHTML(L) {
  if (!L.owedSum || !L.owed || !L.owed.length) return "";
  const days = [...new Set(L.owed.map(t => t.fromPay))], what = L.owed.map(t => t.note || t.payee || catName(t.categoryId) || "Spending");
  const list = what.length > 3 ? `${what.slice(0, 2).join(", ")} and ${what.length - 2} more` : what.join(", ");
  return `<p class="expect-note owed-note">${icon("clock", "ic xs")} ${esc(eur0(L.owedSum))} comes out of your pay on ${esc(days.map(d => fmtDay(parseDay(d))).join(" and "))}: ${esc(list)}. Not taken from today's money.</p>`;
}
