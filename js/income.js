// Income: sources (salary, side jobs, one-off payments), expected vs received each month, paydays.
// Receiving income records a transaction (kind "income") linked to the source and pay date, like paying a bill.
import { store, todayISO, INCOME_FREQS } from "./data.js";
import { $, $$, esc, eur, eur0, icon, parseMoney, moneyField, parseDay, fmtDay, openSheet, closeSheet, toast, svgEl as el, showTip, hideTip } from "./ui.js";
import { periodFor, shift, periodLabel, navHTML } from "./money.js";

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const FREQ = { monthly: "Monthly", varies: "Varies each month", once: "One-off" };
export const incId = (sid, due) => `inc:${sid}:${due}`;
const receivedOf = (sid, due) => store.model.transactions.find(t => t.id === incId(sid, due)) || null;
const payDate = (src, y, m) => { const last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, src.payDay === 0 ? last : Math.min(src.payDay, last)); };
const dayText = src => src.frequency === "once" ? (src.expectedDate ? fmtDay(parseDay(src.expectedDate)) : "No date") : src.payDay === 0 ? "last day" : `${src.payDay}${["th", "st", "nd", "rd"][(src.payDay % 10 < 4 && Math.floor(src.payDay / 10) !== 1) ? src.payDay % 10 : 0]}`;

/* ---------- Occurrences and totals ---------- */
export function incomeOccurrences(p) {
  const out = [];
  store.model.income.filter(s => s.active).forEach(src => {
    if (src.frequency === "once") { if (src.expectedDate && src.expectedDate >= p.from && src.expectedDate <= p.to) out.push({ src, due: src.expectedDate }); return; }
    for (let k = -1; k <= 1; k++) { const due = iso(payDate(src, p.start.getFullYear(), p.start.getMonth() + k)); if (due >= p.from && due <= p.to && (!src.endDate || due <= src.endDate)) out.push({ src, due }); }
  });
  return out.map(o => ({ ...o, got: receivedOf(o.src.id, o.due), missed: (o.src.missed || []).includes(o.due) })).sort((a, b) => a.due.localeCompare(b.due));
}
export function incomeTotals(p) {
  const occ = incomeOccurrences(p);
  let expected = 0, received = 0, pending = 0;
  occ.forEach(o => { const exp = Number(o.src.amount) || 0; if (o.got) { received += o.got.amount; expected += exp; } else if (!o.missed) { expected += exp; pending += exp; } });
  return { occ, expected, received, pending, total: received + pending };
}
/* Next payday: from the biggest monthly source; falls back to the payday setting. */
export function nextPay(today = new Date()) {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const main = store.model.income.filter(s => s.active && s.frequency !== "once").sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
  const pd = main ? (main.payDay === 0 ? "last" : main.payDay) : store.model.settings.payday;
  if (!pd) return null;
  const inMonth = (y, m) => pd === "last" ? new Date(y, m + 1, 0) : new Date(y, m, Math.min(Number(pd), new Date(y, m + 1, 0).getDate()));
  let d = inMonth(t0.getFullYear(), t0.getMonth()); if (d < t0) d = inMonth(t0.getFullYear(), t0.getMonth() + 1);
  return { date: d, days: Math.round((d - t0) / 864e5), source: main || null };
}
/* "It didn't come": this expected payment is marked missed, so it stops being expected. */
export function setMissed(o, missed = true) {
  const src = store.model.income.find(x => x.id === o.src.id); if (!src) return;
  const set = new Set(src.missed || []); if (missed) set.add(o.due); else set.delete(o.due);
  store.put("income", { ...src, missed: [...set] });
}
export function receive(o, amount, date) {
  const today = todayISO();
  return store.put("transactions", { id: incId(o.src.id, o.due), date: date || (o.due <= today ? o.due : today), amount, kind: "income", categoryId: null, payee: o.src.name, note: null, source: "manual", incomeId: o.src.id, incomeDue: o.due });
}

/* ---------- View ---------- */
let root = null, view = null;
export function mountIncome(elm) {
  root = elm; view = periodFor(new Date());
  root.innerHTML = `
  <header class="vh"><div><h1>Income</h1><div class="sub" id="inSub"></div></div><a class="sync" href="#settings" data-sync><span class="dot"></span><span class="t"></span></a></header>
  ${navHTML("ishift")}
  <div class="pl-top">
    <section class="card" id="inHero"></section>
    <section class="card"><div class="card-head"><div><h2>Last 6 months</h2><div class="hint">Income received</div></div></div><div class="chart" id="inColsWrap"><svg id="inCols" role="img"></svg><div class="tip"></div></div></section>
  </div>
  <div class="gh"><h2>Sources</h2><button type="button" class="link" data-inc-add>Add</button></div>
  <div id="inSources"></div>
  <div id="inOther"></div>`;
  root.addEventListener("click", e => {
    const s = e.target.closest("[data-ishift]"); if (s) { const n = Number(s.dataset.ishift); view = n === 0 ? periodFor(new Date()) : shift(view, n); renderIncome(); return; }
    if (e.target.closest("[data-inc-add]")) { openSource(); return; }
    const q = e.target.closest("[data-quick]"); if (q) { openSource(null, { name: q.dataset.quick, frequency: q.dataset.freq }); return; }
    const r = e.target.closest("[data-recv]"); if (r) { toggleReceived(r.dataset.recv, r.dataset.due); return; }
    const ms = e.target.closest("[data-miss]"); if (ms) { const o = incomeOccurrences(view).find(x => x.src.id === ms.dataset.miss && x.due === ms.dataset.due); if (o) { setMissed(o, !o.missed); if (!o.missed) toast(`${o.src.name}: marked as didn't come`, { label: "Undo", run: () => setMissed(o, false) }); } return; }
    const src = e.target.closest("[data-src]"); if (src) { openSource(store.model.income.find(x => x.id === src.dataset.src)); return; }
    const tx = e.target.closest("[data-itx]"); if (tx) { import("./money.js").then(m => m.openExpense({ tx: store.model.transactions.find(x => x.id === tx.dataset.itx) })); }
  });
}
function toggleReceived(sid, due) {
  const o = incomeOccurrences(view).find(x => x.src.id === sid && x.due === due); if (!o) return;
  if (o.got) { store.remove("transactions", o.got.id); toast(`${o.src.name} marked not received`); return; }
  if (o.src.amount == null || o.src.frequency === "varies") { openReceive(o); return; }
  const saved = receive(o, o.src.amount); if (navigator.vibrate) navigator.vibrate(8);
  toast(`${o.src.name} received · ${eur(saved.amount)}`, { label: "Undo", run: () => store.remove("transactions", saved.id) });
}

export function renderIncome() {
  if (!root) return;
  const cur = periodFor(new Date()), isCur = view.from === cur.from, today = todayISO();
  const I = incomeTotals(view), np = nextPay();
  $("[data-period]", root).textContent = periodLabel(view); $(".mo-today", root).hidden = isCur;
  $("#inSub", root).textContent = np ? `Next payday ${fmtDay(np.date)}${np.days === 0 ? " (today)" : ""}` : "Where your money comes from";
  const loose = store.model.transactions.filter(t => t.kind === "income" && !t.incomeId && t.date >= view.from && t.date <= view.to);
  const looseSum = loose.reduce((a, t) => a + t.amount, 0), got = I.received + looseSum, exp = I.expected + looseSum;
  $("#inHero", root).innerHTML = store.model.income.length || looseSum ? `
    <div class="card-head" style="margin-bottom:2px"><h2>${view.from > cur.from ? "Planned" : isCur ? "Received this month" : "Received"}</h2>${exp && got >= exp ? `<span class="chip ok">All in</span>` : I.occ.some(o => !o.got && o.due < today) ? `<span class="chip warn">Late</span>` : ""}</div>
    <div class="big">${eur0(got)}</div>
    <div class="meter" style="margin:12px 0 8px" role="img" aria-label="${eur0(got)} of ${eur0(exp)} received"><i style="width:${exp ? Math.min(100, got / exp * 100) : 0}%"></i></div>
    <div class="hint" style="font-size:13px">of ${eur0(exp)} expected${I.occ.length ? ` · ${I.occ.filter(o => o.got).length} of ${I.occ.length} payments in` : ""}</div>`
    : `<h2>Add your income</h2><p class="hint" style="font-size:13px;margin-top:6px">Your salary and other income set what's left until payday in Budgets.</p>`;

  const check = icon("check", "ic xs");
  let sh = "";
  if (!store.model.income.length) {
    sh = `<div class="empty" style="text-align:left"><b style="color:var(--ink)">Where does your money come from?</b><p style="margin:6px 0 12px">Tap one to add it.</p><div class="chips" style="margin:0;padding:0;flex-wrap:wrap">${[["Salary", "monthly"], ["Side job", "varies"], ["Benefits", "monthly"], ["Student grant", "monthly"], ["Tax refund", "once"]].map(([n, f]) => `<button type="button" class="fchip" data-quick="${n}" data-freq="${f}">${n}</button>`).join("")}</div></div>`;
  } else {
    sh = I.occ.length ? `<div class="grp">${I.occ.map(o => {
      const late = !o.got && !o.missed && o.due < today, amt = o.got ? o.got.amount : o.src.amount, future = view.from > cur.from;
      const status = o.got ? `Received ${fmtDay(parseDay(o.got.date))}` : o.missed ? "Didn't come" : late ? `Expected ${fmtDay(parseDay(o.due))} · not marked yet` : future ? `Planned ${fmtDay(parseDay(o.due))}` : `Expected ${fmtDay(parseDay(o.due))}`;
      if (o.missed && !o.got) return `<div class="row bill-row skipped"><span class="cb off" aria-hidden="true"></span><button type="button" class="item-name" data-src="${esc(o.src.id)}"><span>${esc(o.src.name)}</span><small>Didn't come · expected ${fmtDay(parseDay(o.due))}</small></button><button type="button" class="link" data-miss="${esc(o.src.id)}" data-due="${o.due}">Undo</button></div>`;
      return `<div class="row bill-row"><button type="button" class="cb" role="checkbox" aria-checked="${!!o.got}" aria-label="${esc(o.src.name)} received" data-recv="${esc(o.src.id)}" data-due="${o.due}">${check}</button>
        <button type="button" class="item-name" data-src="${esc(o.src.id)}" aria-label="${esc(o.src.name)}. Edit"><span>${esc(o.src.name)}</span><small>${esc([o.src.payer, FREQ[o.src.frequency]].filter(Boolean).join(" · "))}</small></button>
        <span class="rv bill-amt"><b class="num${!o.got && future ? " muted" : ""}">${amt != null ? eur(amt) : "Varies"}</b><small class="${o.got ? "good" : late ? "warn-t" : ""}">${esc(status)}</small></span>
        ${late ? `<span class="od-acts in-row"><button type="button" class="btn sm primary" data-recv="${esc(o.src.id)}" data-due="${o.due}">It arrived</button><button type="button" class="btn sm" data-miss="${esc(o.src.id)}" data-due="${o.due}">It didn't come</button></span>` : ""}</div>`; }).join("")}</div>` : `<div class="empty">No income expected in ${esc(periodLabel(view))}.</div>`;
    const rest = store.model.income.filter(src => !I.occ.some(o => o.src.id === src.id));
    if (rest.length) sh += `<div class="gh" style="margin-top:14px"><h3>Other sources</h3></div><div class="grp">${rest.map(src => `<button type="button" class="row" data-src="${esc(src.id)}"><span class="rt">${esc(src.name)}${src.active ? "" : " (paused)"}<small>${FREQ[src.frequency]} · ${src.frequency === "once" ? "expected " : "paid on the "}${dayText(src)}</small></span><span class="rv">${src.amount != null ? eur(src.amount) : "Varies"}</span></button>`).join("")}</div>`;
  }
  $("#inSources", root).innerHTML = sh;
  $("#inOther", root).innerHTML = loose.length ? `<div class="gh"><h2>Other income</h2><span class="num">${eur(looseSum)}</span></div><div class="grp">${loose.map(t => `<button type="button" class="row" data-itx="${esc(t.id)}"><span class="rt">${esc(t.payee || "Income")}<small>${fmtDay(parseDay(t.date))}${t.note ? " · " + esc(t.note) : ""}</small></span><span class="rv good">+${eur(t.amount)}</span></button>`).join("")}</div>` : "";
  drawCols();
}

function drawCols() {
  const wrap = $("#inColsWrap", root), svg = $("#inCols", root), tip = $(".tip", wrap); svg.innerHTML = ""; hideTip(tip);
  if (wrap.offsetParent === null) return;
  const ps = [-5, -4, -3, -2, -1, 0].map(n => shift(view, n)).map(p => { const I = incomeTotals(p), loose = store.model.transactions.filter(t => t.kind === "income" && !t.incomeId && t.date >= p.from && t.date <= p.to).reduce((a, t) => a + t.amount, 0); return { p, v: I.received + loose }; });
  const W = Math.max(240, wrap.clientWidth), H = 160, m = { l: 48, r: 8, t: 18, b: 22 };
  const maxV = Math.max(...ps.map(x => x.v)) * 1.15 || 100;
  const step = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000].find(s => maxV / s <= 3) || 10000, top = Math.ceil(maxV / step) * step;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("aria-label", "Income received by month: " + ps.map(x => `${periodLabel(x.p, false)} ${eur0(x.v)}`).join(", "));
  const Y = v => H - m.b - v / top * (H - m.t - m.b), bw = (W - m.l - m.r) / ps.length, w = Math.min(24, bw * .5);
  const g = el("g", { class: "gridl" }, svg), ax = el("g", { class: "axis" }, svg);
  for (let v = 0; v <= top; v += step) { el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, g); el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, ax).textContent = eur0(v); }
  ps.forEach(({ p, v }, i) => {
    const cx = m.l + bw * i + bw / 2, x = cx - w / 2, y = Y(v), last = i === ps.length - 1;
    if (v > 0) el("path", { d: `M${x} ${Y(0)} V${y + 4} a4 4 0 0 1 4 -4 H${x + w - 4} a4 4 0 0 1 4 4 V${Y(0)} Z`, fill: "var(--spruce)", opacity: last ? 1 : .45 }, svg);
    el("text", { x: cx, y: H - 5, "text-anchor": "middle" }, ax).textContent = periodLabel(p, false).split(" – ")[0].replace(/^\d+ /, "");
    const hit = el("rect", { x: m.l + bw * i, y: m.t, width: bw, height: H - m.t - m.b, fill: "transparent" }, svg);
    const show = () => { const s = svg.getBoundingClientRect().width / W; showTip(tip, `<b>${esc(periodLabel(p))}</b><br>${eur(v)} received`, Math.min(Math.max(cx * s, 70), W * s - 70), Math.max(y, m.t + 24) * s); };
    hit.addEventListener("mousemove", show); hit.addEventListener("touchstart", show, { passive: true }); hit.addEventListener("mouseleave", () => hideTip(tip));
  });
}

/* ---------- Sheets ---------- */
function openReceive(o) {
  openSheet({ title: `${o.src.name} received`, right: "Save", body: `
    <div class="field"><label for="rcAmt">Amount received</label><input class="inp" id="rcAmt" inputmode="decimal" placeholder="€0,00" value="${moneyField(o.src.amount)}" autocomplete="off" autofocus></div>
    <div class="field"><label for="rcDate">Date</label><input class="inp" id="rcDate" type="date" value="${o.due <= todayISO() ? o.due : todayISO()}"></div>
    <p class="msg" id="rcMsg" aria-live="polite"></p>`,
    onRight: B => { const a = parseMoney($("#rcAmt", B).value); if (!a || Number.isNaN(a)) { $("#rcMsg", B).dataset.state = "error"; $("#rcMsg", B).textContent = "Type the amount, like 2950."; return; }
      const saved = receive(o, a, $("#rcDate", B).value || null); closeSheet(); toast(`${o.src.name} received · ${eur(saved.amount)}`, { label: "Undo", run: () => store.remove("transactions", saved.id) }); } });
}
export function openSource(src = null, preset = {}) {
  const x = src || { name: preset.name || "", amount: null, frequency: preset.frequency || "monthly", payDay: 0, expectedDate: "", payer: "" };
  let freq = x.frequency;
  openSheet({ title: src ? "Income source" : "Add income", right: "Save", body: B => {
    B.innerHTML = `
      <div class="field"><label for="soName">Name</label><input class="inp" id="soName" value="${esc(x.name)}" placeholder="e.g. Salary…" maxlength="80" autocomplete="off" ${src ? "" : "autofocus"}></div>
      <div class="field"><span class="flabel">How often</span><div class="seg" id="soFreq">${INCOME_FREQS.map(f => `<button type="button" data-f="${f}" aria-pressed="${f === freq}">${{ monthly: "Monthly", varies: "Varies", once: "One-off" }[f]}</button>`).join("")}</div></div>
      <div class="field"><label for="soAmt" id="soAmtLbl">Amount</label><input class="inp" id="soAmt" inputmode="decimal" placeholder="€0" value="${moneyField(x.amount)}" autocomplete="off"></div>
      <div class="grp">
        <label class="row" id="soDayRow"><span class="rt">Paid on</span><select class="inl" id="soDay"><option value="0"${x.payDay === 0 ? " selected" : ""}>Last day of the month</option>${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${x.payDay === k + 1 ? " selected" : ""}>Day ${k + 1}</option>`).join("")}</select></label>
        <label class="row" id="soDateRow"><span class="rt">Expected on</span><input class="inl" id="soDate" type="date" value="${esc(x.expectedDate || "")}"></label>
        <label class="row" id="soEndRow"><span class="rt">Ends on<small>Optional: a contract end. Not planned after this.</small></span><input class="inl" id="soEnd" type="date" value="${esc(x.endDate || "")}"></label>
        <label class="row"><span class="rt">From</span><input class="inl" id="soPayer" value="${esc(x.payer || "")}" placeholder="Employer, Kela…" maxlength="120" autocomplete="off" style="max-width:60%"></label>
        ${src ? `<label class="row"><span class="rt">Paused<small>Not expected until switched back on</small></span><input type="checkbox" class="switch" id="soPaused" ${x.active ? "" : "checked"}></label>` : ""}
      </div>
      <p class="msg" id="soMsg" aria-live="polite"></p>
      ${src ? `<p class="note" style="margin-top:0">Payments you've marked received stay in your history if you delete this source.</p><button type="button" class="btn danger" id="soDel">${icon("trash", "ic sm")} Delete source</button>` : ""}`;
    const paint = () => { $("#soDayRow", B).hidden = freq === "once"; $("#soEndRow", B).hidden = freq === "once"; $("#soDateRow", B).hidden = freq !== "once"; $("#soAmtLbl", B).textContent = freq === "varies" ? "Usual amount (optional)" : "Amount"; };
    paint();
    $("#soFreq", B).addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (!b) return; freq = b.dataset.f; $$("#soFreq button", B).forEach(y => y.setAttribute("aria-pressed", y === b)); paint(); });
    const del = $("#soDel", B); if (del) del.onclick = () => { if (!confirm(`Delete "${x.name}"?`)) return; closeSheet(); const copy = { ...src }; store.remove("income", src.id); toast(`Deleted ${src.name}`, { label: "Undo", run: () => store.put("income", copy) }); };
  }, onRight: B => {
    const msg = t => { $("#soMsg", B).textContent = t; $("#soMsg", B).dataset.state = "error"; };
    const name = $("#soName", B).value.trim(), amount = parseMoney($("#soAmt", B).value);
    if (!name) return msg("Give it a name, like Salary.");
    if (Number.isNaN(amount)) return msg("Type the amount as a number, like 2950.");
    if (freq !== "varies" && !amount) return msg("Type the amount, or choose Varies.");
    if (freq === "once" && !$("#soDate", B).value) return msg("Choose the date you expect it.");
    store.put("income", { ...(src || {}), id: src ? src.id : undefined, name, amount: amount || null, frequency: freq, payDay: Number($("#soDay", B).value), expectedDate: freq === "once" ? $("#soDate", B).value : null,
      endDate: freq === "once" ? null : ($("#soEnd", B).value || null), payer: $("#soPayer", B).value.trim() || null, active: src ? !$("#soPaused", B).checked : true, position: src ? src.position : store.model.income.length });
    closeSheet(); toast(src ? "Saved" : `Added ${name}`);
  } });
}
