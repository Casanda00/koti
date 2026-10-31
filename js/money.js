// Money view: month summary, budgets with pace, spending by month, transactions; add/edit expense and categories sheets.
import { store, todayISO, HOME_SETUP_CAT, TX_KINDS, BILLS_CAT } from "./data.js";
import { billTotals, openBill } from "./plan.js";
import { $, $$, esc, eur, eur0, icon, parseMoney, moneyField, parseDay, fmtDay, openSheet, closeSheet, toast, svgEl as el, showTip, hideTip } from "./ui.js";
import { parseExpense, speechSupported, listen } from "./voice.js";

/* ---------- Periods ---------- */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startDay = () => Math.min(28, Math.max(1, Number(store.model.settings.monthStart) || 1));
export function periodFor(date, sd = startDay()) {
  let y = date.getFullYear(), m = date.getMonth(); if (date.getDate() < sd) m -= 1;
  const start = new Date(y, m, sd), end = new Date(y, m + 1, sd - 1);
  return { start, end, from: iso(start), to: iso(end) };
}
const shift = (p, n) => periodFor(new Date(p.start.getFullYear(), p.start.getMonth() + n, p.start.getDate()));
function periodLabel(p, long = true) {
  if (p.start.getDate() === 1) return p.start.toLocaleDateString("en-GB", long ? { month: "long", year: "numeric" } : { month: "short" });
  return `${fmtDay(p.start)} – ${fmtDay(p.end)}`;
}
export function nextPayday(today = new Date()) {
  const pd = store.model.settings.payday, t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const inMonth = (y, m) => pd === "last" || !pd ? new Date(y, m + 1, 0) : new Date(y, m, Math.min(Number(pd), new Date(y, m + 1, 0).getDate()));
  let d = inMonth(t0.getFullYear(), t0.getMonth()); if (d < t0) d = inMonth(t0.getFullYear(), t0.getMonth() + 1);
  return { date: d, days: Math.round((d - t0) / 864e5) };
}

/* ---------- Totals ---------- */
export const catName = id => id === HOME_SETUP_CAT ? "Home setup" : id === BILLS_CAT ? "Bills" : ((store.model.categories.find(c => c.id === id) || {}).name || "Uncategorised");
export function setupEntries(p) {
  return store.model.items.filter(i => i.done && i.price > 0 && i.boughtAt && i.boughtAt >= p.from && i.boughtAt <= p.to)
    .map(i => ({ id: "item:" + i.id, itemId: i.id, date: i.boughtAt, amount: i.price, kind: "expense", categoryId: HOME_SETUP_CAT, payee: i.name, note: null, fromSetup: true }));
}
export function totals(p) {
  const tx = store.model.transactions.filter(t => t.date >= p.from && t.date <= p.to);
  const byCat = {}; let spend = 0, incomeTx = 0;
  tx.forEach(t => {
    if (t.kind === "income") { incomeTx += t.amount; return; }
    const v = t.kind === "refund" ? -t.amount : t.amount, k = t.categoryId || "none";
    byCat[k] = (byCat[k] || 0) + v; spend += v;
  });
  const setup = setupEntries(p).reduce((a, e) => a + e.amount, 0);
  const income = store.model.settings.income != null ? Number(store.model.settings.income) : (incomeTx || null);
  const bills = billTotals(p), billsPaid = byCat[BILLS_CAT] || 0, everyday = spend - billsPaid;
  return { tx, byCat, spend, everyday, setup, total: spend + setup, income, incomeTx, bills, billsPaid, billsDue: bills.due };
}
function pace(p) { const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()); if (t0 < p.start) return 0; if (t0 > p.end) return 1; const days = Math.round((p.end - p.start) / 864e5) + 1; return (Math.round((t0 - p.start) / 864e5) + 1) / days; }

/* ---------- View ---------- */
let root = null, view = null; // view = current period
export function mountMoney(elm) {
  root = elm; view = periodFor(new Date());
  root.innerHTML = `
  <header class="vh"><div><h1>Money</h1><div class="sub" id="moSub"></div></div><a class="sync" href="#more" data-sync><span class="dot"></span><span class="t"></span></a></header>
  <div class="mo-nav"><button type="button" class="mo-arrow" data-shift="-1" aria-label="Previous month">${icon("chev", "ic sm flip")}</button><b id="moPeriod"></b><button type="button" class="mo-arrow" data-shift="1" aria-label="Next month">${icon("chev", "ic sm")}</button><button type="button" class="mo-today" data-shift="0" hidden>This month</button></div>
  <div class="mo-top">
    <section class="card mo-hero" id="moHero"></section>
    <div class="stats mo-stats"><div class="stat" id="moSpendStat"></div><div class="stat" id="moSetupStat"></div></div>
  </div>
  <div class="mo-mid">
    <section><div class="gh"><h2>Budgets</h2><button type="button" class="link" data-open="categories">Edit</button></div><div class="grp" id="moBudgets"></div><p class="note" id="moPaceNote"></p></section>
    <section><div class="gh"><h2>By month</h2></div><div class="card"><div class="chart" id="moColsWrap"><svg id="moCols" role="img"></svg><div class="tip"></div></div><div class="key" style="margin-top:8px"><span><i class="sw" style="background:var(--spruce)"></i>Spent</span><span id="moIncKey"><i class="ln" style="background:var(--amber)"></i>Income</span></div></div></section>
  </div>
  <div class="gh"><h2>Transactions</h2><span class="num" id="moTxCount"></span></div>
  <div id="moTx"></div>`;
  root.addEventListener("click", e => {
    const s = e.target.closest("[data-shift]"); if (s) { const n = Number(s.dataset.shift); view = n === 0 ? periodFor(new Date()) : shift(view, n); renderMoney(); return; }
    const t = e.target.closest("[data-tx]"); if (t) { const tx = store.model.transactions.find(x => x.id === t.dataset.tx); if (tx && tx.billId) { const b = store.model.bills.find(x => x.id === tx.billId); if (b) { openBill(b); return; } } if (tx) openExpense({ tx }); return; }
    const it = e.target.closest("[data-item]"); if (it) { import("./setup.js").then(m => { const item = store.model.items.find(i => i.id === it.dataset.item); if (item) m.openItem(item); }); return; }
    const c = e.target.closest("[data-cat]"); if (c) openCategories();
  });
}

export function renderMoney() {
  if (!root) return;
  const cur = periodFor(new Date()), isCur = view.from === cur.from, isFuture = view.from > cur.from;
  const T = totals(view), pd = nextPayday(), S = store.model.settings;
  $("#moPeriod", root).textContent = periodLabel(view);
  $(".mo-today", root).hidden = isCur;
  $("#moSub", root).textContent = isCur ? (S.payday ? `${pd.days === 0 ? "Payday today" : `${pd.days} day${pd.days === 1 ? "" : "s"} to payday`} · ${fmtDay(pd.date)}` : "") : (isFuture ? "Upcoming month" : "Past month");

  // hero
  const H = $("#moHero", root);
  if (T.income) {
    const left = T.income - T.total - T.billsDue, parts = [["Bills", T.billsPaid + T.billsDue, "var(--wall)"], ["Spending", Math.max(0, T.everyday), "var(--spruce)"], ["Home setup", T.setup, "var(--amber)"], ["Left", Math.max(0, left), "var(--spruce-track)"]].filter(p => p[1] > 0);
    const sum = parts.reduce((a, p) => a + p[1], 0) || 1;
    H.innerHTML = `<div class="card-head" style="margin-bottom:4px"><h2>${isCur ? "Left until payday" : isFuture ? "Planned income" : "Left at month end"}</h2>${left < 0 ? `<span class="chip crit">Over by ${eur0(-left)}</span>` : left / T.income < .1 && isCur ? `<span class="chip warn">Running low</span>` : `<span class="chip ok">On track</span>`}</div>
      <div class="big ${left < 0 ? "danger" : ""}">${eur0(left)}</div><div class="hint" style="font-size:13px">of ${eur0(T.income)} income${T.total ? `, after ${eur0(T.total)} spent` : ""}${T.billsDue ? ` and ${eur0(T.billsDue)} in bills still due` : ""}</div>
      <div class="flow" role="img" aria-label="${esc(parts.map(p => `${p[0]} ${eur0(p[1])}`).join(", "))}">${parts.map(p => `<i style="width:${p[1] / sum * 100}%;background:${p[2]}"></i>`).join("")}</div>
      <div class="key">${parts.map(p => `<span><i class="sw" style="background:${p[2]}"></i>${p[0]} ${eur0(p[1])}</span>`).join("")}</div>`;
  } else {
    H.innerHTML = `<h2>${isCur ? "Spent this month" : "Spent"}</h2><div class="big" style="margin-top:6px">${eur0(T.total)}</div>${T.billsDue ? `<div class="hint" style="font-size:13px">${eur0(T.billsDue)} in bills still due</div>` : ""}
      <p class="hint" style="font-size:13px;margin-top:6px"><a href="#more" class="link-inline">Add your monthly income in More</a> to see what's left until payday.</p>`;
  }
  // stats
  const budgeted = store.model.categories.reduce((a, c) => a + (Number(c.budget) || 0), 0);
  $("#moSpendStat", root).innerHTML = `<div class="k">Everyday spending</div><div class="v">${eur0(T.everyday)}</div><div class="meter"><i style="width:${budgeted ? Math.min(100, T.everyday / budgeted * 100) : 0}%;background:${budgeted && T.everyday > budgeted ? "var(--crit)" : "var(--spruce)"}"></i></div><div class="s">${budgeted ? `of ${eur0(budgeted)} budgeted` : "No budgets set"}</div>`;
  $("#moSetupStat", root).innerHTML = `<div class="k">Home setup</div><div class="v">${eur0(T.setup)}</div><div class="s">From your checklist this month</div>`;

  // budgets
  const pc = isCur ? pace(view) : isFuture ? 0 : 1;
  const rows = store.model.categories.slice().sort((a, b) => a.position - b.position).map(c => ({ id: c.id, name: c.name, budget: c.budget, spent: T.byCat[c.id] || 0 }));
  if (T.byCat.none) rows.push({ id: "none", name: "Uncategorised", budget: null, spent: T.byCat.none });
  Object.keys(T.byCat).filter(k => k !== "none" && k !== BILLS_CAT && !store.model.categories.some(c => c.id === k)).forEach(k => rows.push({ id: k, name: "Deleted category", budget: null, spent: T.byCat[k] }));
  let bh = rows.map(r => {
    const ratio = r.budget ? r.spent / r.budget : 0, over = r.budget != null && r.spent > r.budget;
    const col = over ? "var(--crit)" : ratio >= .9 ? "var(--amber)" : "var(--spruce)";
    const right = r.budget ? (over ? `<span class="danger">${eur0(r.spent - r.budget)} over</span>` : `${eur0(r.budget - r.spent)} left`) : eur0(r.spent);
    return `<button type="button" class="row r2" data-cat="${esc(r.id)}" aria-label="${esc(r.name)}: ${eur(r.spent)} spent${r.budget ? ` of ${eur(r.budget)}` : ""}"><span class="rt">${esc(r.name)}<small class="num">${r.budget ? `${eur0(r.spent)} of ${eur0(r.budget)}` : "No budget"}</small></span><span class="rv">${right}</span>
      ${r.budget ? `<span class="bullet"><i style="width:${Math.min(100, ratio * 100)}%;background:${col}"></i>${pc > 0 && pc < 1 ? `<span class="pace" style="left:${pc * 100}%"></span>` : ""}</span>` : ""}</button>`;
  }).join("");
  if (T.bills.count || T.billsPaid) bh = `<a class="row r2" href="#plan" aria-label="Bills: ${eur(T.billsPaid)} paid of ${eur(T.bills.total)}"><span class="rt">Bills<small class="num">${eur0(T.billsPaid)} paid of ${eur0(T.bills.total)}</small></span><span class="rv">${T.billsDue ? `${eur0(T.billsDue)} due` : "All paid"}</span><span class="bullet"><i style="width:${T.bills.total ? Math.min(100, T.billsPaid / T.bills.total * 100) : 100}%;background:var(--wall)"></i></span></a>` + bh;
  if (T.setup) bh += `<a class="row" href="#setup"><span class="rt">Home setup<small>From your checklist</small></span><span class="rv">${eur0(T.setup)}</span></a>`;
  $("#moBudgets", root).innerHTML = bh || `<div class="row"><span class="rt muted">No categories yet</span></div>`;
  $("#moPaceNote", root).textContent = pc > 0 && pc < 1 ? "The line on each bar marks where you'd be at an even pace through the month." : "";

  drawCols(); renderTx(T);
}

function drawCols() {
  const wrap = $("#moColsWrap", root), svg = $("#moCols", root), tip = $(".tip", wrap); svg.innerHTML = ""; hideTip(tip);
  if (wrap.offsetParent === null) return;
  const ps = [-5, -4, -3, -2, -1, 0].map(n => shift(view, n)).map(p => ({ p, t: totals(p) }));
  const income = store.model.settings.income != null ? Number(store.model.settings.income) : null;
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
    const show = () => { const s = svg.getBoundingClientRect().width / W; showTip(tip, `<b>${esc(periodLabel(p))}</b><br>${eur(t.total)} spent${t.setup ? ` (${eur0(t.setup)} home setup)` : ""}${income ? `<br>${t.total <= income ? eur0(income - t.total) + " left" : eur0(t.total - income) + " over"}` : ""}`, Math.min(Math.max(cx * s, 80), W * s - 80), Math.max(y, m.t + 30) * s); };
    hit.addEventListener("mousemove", show); hit.addEventListener("touchstart", show, { passive: true }); hit.addEventListener("mouseleave", () => hideTip(tip));
  });
  if (income) { el("line", { x1: m.l, x2: W - m.r, y1: Y(income), y2: Y(income), stroke: "var(--amber)", "stroke-width": 2 }, svg); el("text", { x: W - m.r + 6, y: Y(income) + 4, style: "font:12px var(--body);fill:var(--ink-2)" }, svg).textContent = "Income"; }
}

function dayLabel(d) {
  const t = todayISO(), y = new Date(); y.setDate(y.getDate() - 1);
  if (d === t) return "Today"; if (d === iso(y)) return "Yesterday";
  return parseDay(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function renderTx(T) {
  const all = [...T.tx.map(t => ({ ...t })), ...setupEntries(view)].sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  $("#moTxCount", root).textContent = all.length ? `${all.length}` : "";
  if (!all.length) { $("#moTx", root).innerHTML = `<div class="empty">No spending recorded for ${esc(periodLabel(view))}. Tap <b>+</b> to add an expense, by typing or speaking.</div>`; return; }
  let html = "", day = null;
  all.forEach(t => {
    if (t.date !== day) { if (day) html += `</div>`; day = t.date; const sum = all.filter(x => x.date === day && x.kind !== "income").reduce((a, x) => a + (x.kind === "refund" ? -x.amount : x.amount), 0); html += `<div class="gh tx-day"><span>${esc(dayLabel(day))}</span><span class="num">${eur(sum)}</span></div><div class="grp">`; }
    const sign = t.kind === "expense" ? "" : "+", title = t.payee || catName(t.categoryId);
    const sub = [t.payee ? catName(t.categoryId) : null, t.note, t.kind !== "expense" ? (t.kind === "income" ? "Income" : "Refund") : null, t.source === "voice" ? "Spoken" : null].filter(Boolean).join(" · ");
    html += `<button type="button" class="row" ${t.fromSetup ? `data-item="${esc(t.itemId)}"` : `data-tx="${esc(t.id)}"`}><span class="rt">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="rv${t.kind !== "expense" ? " good" : ""}">${sign}${eur(t.amount)}</span></button>`;
  });
  $("#moTx", root).innerHTML = html + `</div>`;
}

/* ---------- Add / edit expense ---------- */
const cats = () => store.model.categories.slice().sort((a, b) => a.position - b.position);
const recentPayees = () => [...new Set(store.model.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).map(t => t.payee).filter(Boolean))].slice(0, 30);
const payeeCat = payee => { const t = store.model.transactions.filter(x => x.payee && x.payee.toLowerCase() === String(payee).toLowerCase()).sort((a, b) => b.date.localeCompare(a.date))[0]; return t ? t.categoryId : null; };

export function openExpense({ tx = null, mode = "type", draft = null } = {}) {
  const editing = !!tx, d = tx || draft || { amount: null, categoryId: null, payee: "", date: todayISO(), note: "", kind: "expense" };
  let catId = d.categoryId, kind = d.kind || "expense", source = (tx && tx.source) || (draft && draft.source) || "manual", stop = null;
  openSheet({
    title: editing ? "Expense" : "Add expense", right: "Save",
    onClose: () => { if (stop) stop(); },
    body: B => {
      B.innerHTML = `
        ${editing ? "" : `<div class="seg" role="tablist" aria-label="What to add"><button type="button" aria-pressed="true">Expense</button><button type="button" data-switch="item">Checklist item</button></div>`}
        ${editing ? "" : `<div class="seg" id="exMode" aria-label="How to add"><button type="button" data-m="type" aria-pressed="${mode === "type"}">Type</button><button type="button" data-m="speak" aria-pressed="${mode === "speak"}">${icon("mic", "ic xs")} Speak</button><button type="button" data-m="scan" aria-pressed="false" title="Coming with receipts">Scan</button></div>`}
        <div id="exBody" style="display:grid;gap:12px"></div>
        <p class="msg" id="exMsg" aria-live="polite"></p>
        ${editing ? `<button type="button" class="btn danger" id="exDel">${icon("trash", "ic sm")} Delete expense</button>` : ""}`;
      const sw = $("[data-switch=item]", B); if (sw) sw.onclick = () => { closeSheet(); setTimeout(() => import("./setup.js").then(m => m.openAdd()), 260); };
      const modeSeg = $("#exMode", B);
      if (modeSeg) modeSeg.addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (!b) return; if (b.dataset.m === "scan") { msg("Receipt scanning arrives in a later update.", ""); return; } if (stop) { stop(); stop = null; } $$("[data-m]", modeSeg).forEach(x => x.setAttribute("aria-pressed", x === b)); paint(b.dataset.m); });
      const del = $("#exDel", B); if (del) del.onclick = () => { closeSheet(); const copy = { ...tx }; store.remove("transactions", tx.id); toast(`Deleted ${eur(tx.amount)}`, { label: "Undo", run: () => store.put("transactions", copy) }); };
      paint(editing ? "type" : mode);

      function msg(t, s = "error") { const m = $("#exMsg", B); m.textContent = t; m.dataset.state = s; }
      function chipsHTML() { return `<div class="chips cat-chips" role="radiogroup" aria-label="Category">${cats().map(c => `<button type="button" class="fchip" role="radio" data-c="${esc(c.id)}" aria-pressed="${c.id === catId}" aria-checked="${c.id === catId}">${esc(c.name)}</button>`).join("")}</div>`; }
      function bindChips(scope) { $(".cat-chips", scope).addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; catId = catId === b.dataset.c ? null : b.dataset.c; $$(".cat-chips [data-c]", scope).forEach(x => { x.setAttribute("aria-pressed", x.dataset.c === catId); x.setAttribute("aria-checked", x.dataset.c === catId); }); }); }

      function paint(m) {
        const E = $("#exBody", B);
        if (m === "type") {
          E.innerHTML = `
            <label class="amount-in"><span class="sr">Amount in euros</span><span aria-hidden="true">€</span><input id="exAmt" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${d.amount != null ? String(d.amount.toFixed(2)).replace(".", ",") : ""}" ${editing ? "" : "autofocus"}></label>
            ${chipsHTML()}
            <div class="grp">
              <label class="row"><span class="rt">Where</span><input class="inl" id="exPayee" list="exPayees" placeholder="Shop or place" autocomplete="off" maxlength="120" value="${esc(d.payee || "")}" style="max-width:60%"></label>
              <label class="row"><span class="rt">Date</span><input class="inl" id="exDate" type="date" value="${esc(d.date || todayISO())}"></label>
              <label class="row"><span class="rt">Note</span><input class="inl" id="exNote" placeholder="Optional" autocomplete="off" maxlength="500" value="${esc(d.note || "")}" style="max-width:60%"></label>
            </div>
            <datalist id="exPayees">${recentPayees().map(p => `<option value="${esc(p)}">`).join("")}</datalist>
            <div class="seg" id="exKind" aria-label="Type">${TX_KINDS.map(k => `<button type="button" data-k="${k}" aria-pressed="${k === kind}">${{ expense: "Paid", refund: "Refund", income: "Income" }[k]}</button>`).join("")}</div>`;
          bindChips(E);
          $("#exPayee", E).addEventListener("change", e => { if (!catId) { const c = payeeCat(e.target.value); if (c) { catId = c; $$(".cat-chips [data-c]", E).forEach(x => x.setAttribute("aria-pressed", x.dataset.c === catId)); } } });
          $("#exKind", E).addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (!b) return; kind = b.dataset.k; $$("#exKind button", E).forEach(x => x.setAttribute("aria-pressed", x === b)); });
          $("#exAmt", E).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });
          setTimeout(() => !editing && $("#exAmt", E) && $("#exAmt", E).focus(), 80);
        } else {
          const lang = store.model.settings.voiceLang || "en-GB", can = speechSupported();
          E.innerHTML = `
            ${can ? `<div class="talk"><button type="button" class="micbtn" id="exMic" aria-label="Start listening">${icon("mic")}</button><span class="hint" id="exMicHint" style="font-size:13px">Tap and say it, like “12,50 lunch at Savu”</span>
              <div class="seg" id="exLang" style="width:200px" aria-label="Language"><button type="button" data-l="en-GB" aria-pressed="${lang === "en-GB"}">English</button><button type="button" data-l="fi-FI" aria-pressed="${lang === "fi-FI"}">Suomi</button></div></div>` : ""}
            <div class="field"><label for="exSaid">${can ? "What you said (you can edit it)" : "Say it with your keyboard's microphone, or type it"}</label><input class="inp" id="exSaid" placeholder="12,50 lunch at Savu yesterday" autocomplete="off" enterkeyhint="done" ${can ? "" : "autofocus"}></div>
            <div class="grp" id="exParsed"></div>
            <button type="button" class="btn" id="exFix">Fix something</button>`;
          let parsed = null;
          const update = () => {
            parsed = parseExpense($("#exSaid", E).value, { categories: store.model.categories, history: store.model.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)) });
            const P = $("#exParsed", E), has = $("#exSaid", E).value.trim();
            P.innerHTML = has ? [["Amount", parsed.amount != null ? eur(parsed.amount) : "Not heard yet"], ["Category", parsed.categoryId ? catName(parsed.categoryId) : "Choose in Fix something"], ["Where", parsed.payee || "–"], ["Date", parsed.date === todayISO() ? "Today" : fmtDay(parseDay(parsed.date))], ...(parsed.note ? [["Note", parsed.note]] : [])]
              .map(([k, v]) => `<div class="row"><span class="rt muted">${k}</span><span class="rv">${esc(v)}</span></div>`).join("") : "";
            catId = parsed.categoryId; d.amount = parsed.amount; d.payee = parsed.payee || ""; d.date = parsed.date; d.note = parsed.note || "";
          };
          $("#exSaid", E).addEventListener("input", () => { source = "voice"; update(); });
          $("#exSaid", E).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });
          $("#exFix", E).onclick = () => { if (stop) { stop(); stop = null; } if (modeSeg) $$("[data-m]", modeSeg).forEach(x => x.setAttribute("aria-pressed", x.dataset.m === "type")); paint("type"); };
          const L = $("#exLang", E); if (L) L.addEventListener("click", e => { const b = e.target.closest("[data-l]"); if (!b) return; store.updateSettings({ voiceLang: b.dataset.l }); $$("#exLang button", E).forEach(x => x.setAttribute("aria-pressed", x === b)); });
          const mic = $("#exMic", E);
          if (mic) mic.onclick = () => {
            if (stop) { stop(); stop = null; return; }
            mic.classList.add("on"); mic.setAttribute("aria-label", "Stop listening"); $("#exMicHint", E).textContent = "Listening…";
            stop = listen({ lang: store.model.settings.voiceLang || "en-GB",
              onText: (t, final) => { $("#exSaid", E).value = t; source = "voice"; update(); if (final) $("#exMicHint", E).textContent = "Check it, then Save"; },
              onEnd: () => { stop = null; mic.classList.remove("on"); mic.setAttribute("aria-label", "Start listening"); if ($("#exMicHint", E).textContent === "Listening…") $("#exMicHint", E).textContent = "Didn't catch that. Tap to try again."; },
              onError: err => { $("#exMicHint", E).textContent = err === "not-allowed" ? "Microphone access is off. Allow it in your browser settings, or type below." : "Couldn't listen. Type below instead."; } });
          };
          if (draft && draft.said) { $("#exSaid", E).value = draft.said; update(); }
        }
      }

      function save() {
        const E = $("#exBody", B), typed = $("#exAmt", E);
        let amount = d.amount, payee = d.payee, date = d.date, note = d.note;
        if (typed) {
          amount = parseMoney(typed.value); payee = $("#exPayee", E).value.trim(); date = $("#exDate", E).value || todayISO(); note = $("#exNote", E).value.trim();
          if (Number.isNaN(amount)) return msg("Type the amount as a number, like 12,50.");
        }
        if (!amount || amount <= 0) return msg(typed ? "Type how much it was." : "Say or type the amount, like 12,50.");
        if (!catId && payee) catId = payeeCat(payee);
        const saved = store.put("transactions", { ...(tx || {}), id: tx ? tx.id : undefined, date, amount, kind, categoryId: catId, payee: payee || null, note: note || null, source: tx ? tx.source : source });
        closeSheet();
        if (editing) toast("Saved");
        else toast(`Saved ${eur(saved.amount)}${catId ? ` · ${catName(catId)}` : ""}`, { label: "Undo", run: () => store.remove("transactions", saved.id) });
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
