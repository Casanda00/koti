// Spent: what went out today, yesterday, this week, last week, this month or last month. One number, a sentence
// comparing it with what's usual, the categories ranked by what they took, a bar a day for weeks, then the purchases.
// Reached from Month, from the Today / Yesterday / This week row on Now, and by asking in the add box
// ("what did I spend last week?").
import { store, todayISO, BILLS_CAT } from "./data.js";
import { $, $$, esc, eur, eur0, icon, parseDay } from "./ui.js";
import { periodFor, shift, catName, projectEntries, openExpense } from "./money.js";
import { ADJUST_CAT } from "./ledger.js";
import { openBill } from "./plan.js";

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const today0 = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

export const RANGES = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["lastweek", "Last week"], ["month", "This month"], ["lastmonth", "Last month"]];

/* The dates a range covers. Weeks start on Monday; months follow your month start (Budgets → month starts on). */
export function rangeOf(k, now = today0()) {
  if (k === "today") return { k, from: iso(now), to: iso(now), days: 1 };
  if (k === "yesterday") { const y = addDays(now, -1); return { k, from: iso(y), to: iso(y), days: 1 }; }
  if (k === "week") { const m = monday(now); return { k, from: iso(m), to: iso(now), start: m, days: Math.round((now - m) / 864e5) + 1, full: 7 }; }
  if (k === "lastweek") { const m = addDays(monday(now), -7); return { k, from: iso(m), to: iso(addDays(m, 6)), start: m, days: 7, full: 7 }; }
  const p = k === "lastmonth" ? shift(periodFor(now), -1) : periodFor(now);
  const end = k === "month" ? now : p.end;
  return { k, from: p.from, to: iso(end), start: p.start, days: Math.round((end - p.start) / 864e5) + 1, full: Math.round((p.end - p.start) / 864e5) + 1, period: p };
}

/* Everything that went out between two dates: receipt lines in their own category or project, refunds taken off,
   bills paid, project purchases. Income and balance corrections aren't spending. */
export function spentBetween(from, to) {
  const byCat = {}, byDay = {}, entries = [];
  const add = (k, v, d) => { byCat[k] = (byCat[k] || 0) + v; byDay[d] = (byDay[d] || 0) + v; };
  store.model.transactions.forEach(t => {
    if (t.date < from || t.date > to || t.kind === "income" || t.categoryId === ADJUST_CAT) return;
    entries.push(t);
    if (t.kind === "refund") { add(t.categoryId || "none", -t.amount, t.date); return; }
    if (t.lines && t.lines.length) {
      let rest = t.amount;
      t.lines.forEach(l => { add(l.categoryId || t.categoryId || "none", l.price, t.date); rest -= l.price; });
      if (Math.abs(rest) >= 0.005) add(t.categoryId || "none", rest, t.date);
      return;
    }
    add(t.categoryId || "none", t.amount, t.date);
  });
  projectEntries({ from, to }).forEach(e => { add(e.categoryId, e.amount, e.date); entries.push(e); });
  const total = Object.values(byCat).reduce((a, v) => a + v, 0);
  return { total, byCat, byDay, entries };
}
const sumBetween = (from, to) => spentBetween(from, to).total;
const firstDay = () => store.model.transactions.reduce((m, t) => (t.kind !== "income" && (!m || t.date < m) ? t.date : m), null);

/* One sentence: how it compares with what's usual, and where most of it went. */
export function sentenceFor(r, S, now = today0()) {
  const out = [], first = firstDay(), wd = d => parseDay(d).toLocaleDateString("en-GB", { weekday: "long" });
  const diff = (v, usual, what) => { const d = Math.round(v - usual); return Math.abs(d) < 3 ? `About the same as ${what}.` : `${eur0(Math.abs(d))} ${d > 0 ? "more" : "less"} than ${what}.`; };
  if (r.days === 1) {
    // the same weekday over the last eight weeks, counting only weeks after you started using Koti
    const past = [1, 2, 3, 4, 5, 6, 7, 8].map(w => iso(addDays(parseDay(r.from), -7 * w))).filter(d => first && d >= first);
    if (past.length >= 2 && S.total > 0) out.push(diff(S.total, past.reduce((a, d) => a + sumBetween(d, d), 0) / past.length, `your usual ${wd(r.from)}`));
  } else if (r.k === "week" || r.k === "lastweek") {
    const ps = addDays(r.start, -7), pe = addDays(ps, r.days - 1);
    if (first && first <= iso(pe)) out.push(diff(S.total, sumBetween(iso(ps), iso(pe)), r.k === "week" ? "this time last week" : "the week before"));
    const big = Object.entries(S.byDay).sort((a, b) => b[1] - a[1])[0];
    if (big && Object.keys(S.byDay).length > 1) out.push(`${wd(big[0])} was the biggest day.`);
  } else {
    const prev = shift(r.period, -1), pe = iso(addDays(prev.start, r.days - 1));
    if (first && first <= prev.to) out.push(diff(S.total, sumBetween(prev.from, pe < prev.to ? pe : prev.to), r.k === "month" ? "by this day last month" : "the month before"));
  }
  const top = Object.entries(S.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (top.length > 1 && top[0][1] >= S.total * 0.4) out.unshift(`Most of it went to ${esc(catName(top[0][0]).toLowerCase())}.`);
  return out.join(" ");
}

/* Reading a question typed or said in the add box: "how much did I spend yesterday", "what did I spend last week",
   "paljonko kulutin eilen". Returns a range key, or null when it isn't a question about spending. */
export function spendQuestion(text) {
  const s = String(text || "").toLowerCase().trim();
  if (!/(spen[dt]|spending|how much|kulu|käytin|kaytin|meni|menny|paljonko)/.test(s) || /\d/.test(s)) return null;
  if (/last month|viime kuu/.test(s)) return "lastmonth";
  if (/this month|tässä kuussa|tassa kuussa|tämän kuun|taman kuun|kuussa/.test(s)) return "month";
  if (/last week|viime viikolla|viime viikko/.test(s)) return "lastweek";
  if (/this week|tällä viikolla|talla viikolla|viikolla/.test(s)) return "week";
  if (/yesterday|eilen/.test(s)) return "yesterday";
  if (/today|tänään|tanaan/.test(s)) return "today";
  return /\?$|^(how|what|paljon|mitä|mita)/.test(s) ? "week" : null;
}

/* The three numbers on Now. */
export function quickHTML() {
  const cells = ["today", "yesterday", "week"].map(k => { const r = rangeOf(k); return [k, RANGES.find(x => x[0] === k)[1], spentBetween(r.from, r.to).total]; });
  if (!store.model.transactions.length) return "";
  return `<a class="sp-quick" href="#spending/today" aria-label="What you spent">${cells.map(([k, t, v]) => `<span class="sq" data-sq="${k}"><small>${t}</small><b class="num">${eur0(v)}</b></span>`).join("")}</a>`;
}

/* ---------- The screen ---------- */
let root = null, filter = null, current = "week";
export function setSpendingFilter(k) { filter = k || null; current = "month"; }
const rangeFromHash = () => { const h = decodeURIComponent(location.hash.slice(1)); const k = h.startsWith("spending/") ? h.slice(9) : null; return RANGES.some(x => x[0] === k) ? k : null; };

export function mountSpending(el) {
  root = el;
  root.addEventListener("click", e => {
    const r = e.target.closest("[data-range]"); if (r) { current = r.dataset.range; filter = null; history.replaceState(null, "", "#spending/" + current); renderSpending(); return; }
    const f = e.target.closest("[data-sf]"); if (f) { filter = filter === f.dataset.sf ? null : f.dataset.sf; renderSpending(); return; }
    const t = e.target.closest("[data-tx]"); if (t) { const tx = store.model.transactions.find(x => x.id === t.dataset.tx); if (tx && tx.billId) { const b = store.model.bills.find(x => x.id === tx.billId); if (b) { openBill(b); return; } } if (tx) openExpense({ tx }); return; }
    const it = e.target.closest("[data-item]"); if (it) { import("./setup.js").then(m => { const item = store.model.items.find(i => i.id === it.dataset.item); if (item) m.openItem(item); }); }
  });
}

function dayLabel(d) {
  const t = todayISO(), y = iso(addDays(today0(), -1));
  if (d === t) return "Today"; if (d === y) return "Yesterday";
  return parseDay(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
const inCat = (t, k) => t.fromProject ? t.categoryId === k : t.categoryId === k || (t.lines || []).some(l => (l.categoryId || t.categoryId) === k);
const catColor = k => k.startsWith("proj:") ? "var(--amber)" : k === BILLS_CAT ? "var(--crit)" : "var(--spruce)";

export function renderSpending() {
  if (!root) return;
  const fromHash = rangeFromHash(); if (fromHash) current = fromHash;
  const r = rangeOf(current), S = spentBetween(r.from, r.to);
  const head = r.days === 1 ? dayLabel(r.from) + "." : r.k === "week" ? "Since Monday." : r.k === "lastweek" ? `${parseDay(r.from).toLocaleDateString("en-GB", { day: "numeric", month: "long" })} to ${parseDay(r.to).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.` : r.k === "month" ? `Since ${parseDay(r.from).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.` : `${r.period.start.toLocaleDateString("en-GB", { month: "long" })}.`;
  const cats = Object.entries(S.byCat).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]), max = cats.length ? cats[0][1] : 0;
  const shops = k => { const p = [...new Set(S.entries.filter(t => t.kind !== "refund" && inCat(t, k)).map(t => t.payee).filter(Boolean))]; return p.length === 1 ? p[0] : p.length > 1 ? `${p.length} places` : ""; };

  // a bar a day, for weeks
  let days = "";
  if (r.full === 7) {
    const vals = Array.from({ length: 7 }, (_, k) => { const d = iso(addDays(r.start, k)); return { d, v: Math.max(0, S.byDay[d] || 0), future: d > todayISO() }; }), top = Math.max(1, ...vals.map(x => x.v));
    days = `<div class="sp-days" role="img" aria-label="${esc(vals.filter(x => !x.future).map(x => `${parseDay(x.d).toLocaleDateString("en-GB", { weekday: "long" })} ${eur0(x.v)}`).join(", "))}">${vals.map(x => `<span class="sd${x.d === todayISO() ? " now" : ""}${x.future ? " later" : ""}"><small>${x.v ? eur0(x.v) : ""}</small><i style="height:${Math.max(4, Math.round(x.v / top * 84))}px"></i><b>${parseDay(x.d).toLocaleDateString("en-GB", { weekday: "narrow" })}</b></span>`).join("")}</div>`;
  }

  // purchases, by day, newest first
  const list = S.entries.filter(t => !filter || inCat(t, filter)).sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  let tx = "", day = null;
  list.forEach(t => {
    if (t.date !== day) { if (day) tx += `</div>`; day = t.date; tx += `<div class="gh tx-day"><span>${esc(dayLabel(day))}</span></div><div class="grp">`; }
    const title = t.payee || catName(t.categoryId);
    const lc = t.lines ? [...new Set(t.lines.map(l => catName(l.categoryId || t.categoryId)))] : null;
    const sub = [t.lines ? `${t.lines.length} item${t.lines.length === 1 ? "" : "s"}` : null, lc ? lc.slice(0, 3).join(", ") : t.payee ? catName(t.categoryId) : null, t.note, t.kind === "refund" ? "Refund" : null].filter(Boolean).join(" · ");
    tx += `<button type="button" class="row" ${t.fromProject ? `data-item="${esc(t.itemId)}"` : `data-tx="${esc(t.id)}"`}><span class="rt">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>${t.receiptPath ? `<span class="rc-ic" title="Has a receipt">${icon("cam", "ic xs")}</span>` : ""}<span class="rv${t.kind === "refund" ? " good" : ""}">${t.kind === "refund" ? "+" : ""}${eur(t.amount)}</span></button>`;
  });
  if (day) tx += `</div>`;

  const words = { today: "today", yesterday: "yesterday", week: "this week", lastweek: "last week", month: "this month", lastmonth: "last month" }[r.k];
  root.innerHTML = `<header class="vh"><div><a class="back" href="#month">${icon("chev", "ic sm flip")} Month</a><h1>Spent</h1></div></header>
    <div class="chips sp-ranges" role="tablist" aria-label="When">${RANGES.map(([k, t]) => `<button type="button" class="fchip" role="tab" data-range="${k}" aria-selected="${k === r.k}" aria-pressed="${k === r.k}">${t}</button>`).join("")}</div>
    <div class="sp-big num" aria-label="${esc(eur(S.total))} spent ${words}">${eur(S.total, S.total >= 1000 || Number.isInteger(Math.round(S.total * 100) / 100) ? 0 : 2)}</div>
    <p class="sp-s">${S.total ? `${esc(head)} ${sentenceFor(r, S)}` : `Nothing spent ${words}.`}</p>
    ${days}
    ${cats.length ? `<div class="sp-cats">${cats.map(([k, v]) => `<button type="button" class="sp-cat" data-sf="${esc(k)}" aria-pressed="${filter === k}"><span class="sc-t"><b>${esc(catName(k))}</b><small>${esc(shops(k))}</small><b class="num">${eur(v)}</b></span><span class="sc-bar"><i style="width:${Math.max(2, v / max * 100)}%;background:${catColor(k)}"></i></span></button>`).join("")}</div>` : ""}
    ${list.length ? `<div class="gh sp-list-h"><h3>${filter ? `${esc(catName(filter))}: ` : ""}${list.length} purchase${list.length === 1 ? "" : "s"}</h3>${filter ? `<button type="button" class="tlink" data-sf="${esc(filter)}">Show all</button>` : ""}</div>${tx}` : ""}`;
}
