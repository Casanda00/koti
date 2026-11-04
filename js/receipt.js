// "Today's payments": the sum behind what's left, printed like a receipt, for any period you pick from the title.
//   Today: left until payday this morning, divided by the days to payday, minus what went out today.
//   This month: what you started with, income, bills (paid and still to come), what was spent, left until payday.
//   Any other period: what went out, line by line (one day) or by category, and the total.
// Also where today's share is worked out, for Today.
import { store, todayISO, BILLS_CAT } from "./data.js";
import { $, esc, eur, eur0, parseDay, openSheet, closeSheet } from "./ui.js";
import { periodFor, catName, openCheckBank } from "./money.js";
import { monthLedger } from "./ledger.js";
import { nextPay } from "./income.js";
import { rangeOf, spentBetween } from "./spent.js";
import { pickerHTML, bindPicker, labelOf } from "./period.js";

const money = v => (v < 0 ? "−" : "") + eur(Math.abs(v), Math.abs(v) >= 100 || Number.isInteger(Math.round(Math.abs(v) * 100) / 100) ? 0 : 2);
const minus = v => (v > 0.004 ? "−" : "") + eur(Math.abs(v), Number.isInteger(Math.round(Math.abs(v) * 100) / 100) ? 0 : 2);
const eur0s = v => (v < 0 ? "−" : "") + eur0(Math.abs(v));
const longDay = d => parseDay(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/* Today's share: what was left until payday this morning, shared out over the days to payday. Bills paid today
   don't count against it: they were already taken off. */
export function dayShare() {
  const L = monthLedger(periodFor(new Date())), pd = nextPay(), t = todayISO();
  if (L.kind !== "current") return null;
  const S = spentBetween(t, t), billsToday = S.byCat[BILLS_CAT] || 0, spent = S.total - billsToday;
  const days = pd ? Math.max(1, pd.days) : null, morning = L.left + spent;
  const share = days ? Math.max(0, morning) / days : null;
  return { L, pd, days, spent, morning, share, left: share != null ? share - spent : null, entries: S.entries.filter(e => !(e.categoryId === BILLS_CAT)) };
}

const title = sel => sel === "today" ? "Today's payments" : sel === "yesterday" ? "Yesterday's payments" : sel === "week" ? "This week's payments" : sel === "lastweek" ? "Last week's payments" : `${labelOf(sel)} payments`;
const row = (label, value, sub, cls = "") => `<div class="rc-r ${cls}"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><b>${value}</b></div>`;

function body(sel) {
  if (sel === "today") {
    const D = dayShare(); if (!D || D.share == null) return null;
    const lines = D.entries.map(e => row(e.payee || catName(e.categoryId), minus(e.kind === "refund" ? -e.amount : e.amount)));
    return { date: longDay(todayISO()), rows: [row("Left until payday", eur0s(D.morning), "This morning, after bills still to come"), row(`Divided by ${D.days} day${D.days === 1 ? "" : "s"}`, eur0s(D.share), null, "dbl"), ...lines], total: ["Left to spend today", eur0s(D.left)],
      foot: D.left > 0 ? "Not spent today? It goes into tomorrow's share." : D.left < 0 ? "Over today? Tomorrow's share is a little smaller." : "" };
  }
  const r = rangeOf(sel), S = spentBetween(r.from, r.to), cur = periodFor(new Date());
  const inc = store.model.transactions.filter(t => t.kind === "income" && t.date >= r.from && t.date <= r.to).reduce((a, t) => a + t.amount, 0);
  const bills = S.byCat[BILLS_CAT] || 0, spent = S.total - bills;
  const cats = Object.entries(S.byCat).filter(([k, v]) => k !== BILLS_CAT && v > 0.004).sort((a, b) => b[1] - a[1]);
  const catLine = cats.slice(0, 3).map(([k, v]) => `${catName(k).toLowerCase()} ${eur0(v)}`).join(", ");
  const range = r.from === r.to ? longDay(r.from) : `${parseDay(r.from).toLocaleDateString("en-GB", { day: "numeric", month: "long" })} to ${parseDay(r.to).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
  if (sel === "month") {
    const L = monthLedger(cur);
    if (L.kind === "current") {
      const start = L.left + L.due + bills + spent - inc;
      return { date: `${range} · so far`, rows: [row("At the start", money(start)), row("Income received", money(inc)), row("Bills", minus(bills + L.due), L.due ? `${eur0(bills)} paid, ${eur0(L.due)} still to come` : null), row("Spent", minus(spent), catLine || null, "dbl")], total: ["Left until payday", money(L.left)], foot: "" };
    }
  }
  const rows = r.days === 1
    ? S.entries.map(e => row(e.payee || catName(e.categoryId), minus(e.kind === "refund" ? -e.amount : e.amount), e.payee ? catName(e.categoryId) : null))
    : [...(bills ? [row("Bills", minus(bills))] : []), ...cats.map(([k, v]) => row(catName(k), minus(v)))];
  if (rows.length) rows[rows.length - 1] = rows[rows.length - 1].replace('class="rc-r ', 'class="rc-r dbl ');
  return { date: range, rows: inc ? [row("Income received", money(inc)), ...rows] : rows, total: ["Paid in total", eur(S.total, Number.isInteger(Math.round(S.total * 100) / 100) ? 0 : 2)], foot: rows.length ? "" : "Nothing paid." };
}

export function openPayments(sel = "today") {
  const paint = (B, s) => {
    const R = body(s) || body("week");
    B.innerHTML = `<div class="pay-h">${pickerHTML(s, title(s))}</div>
      <div class="receipt num">
        <p class="rc-d">${esc(R.date)}</p>
        ${R.rows.join("")}
        <div class="rc-r rc-t"><span>${esc(R.total[0])}</span><b>${R.total[1]}</b></div>
        ${R.foot ? `<p class="rc-f">${esc(R.foot)}</p>` : ""}
      </div>
      <button type="button" class="btn primary" id="payBank">Match it to my bank</button>`;
    bindPicker(B, s, pick => paint(B, pick));
    $("#payBank", B).onclick = () => { closeSheet(); setTimeout(openCheckBank, 260); };
  };
  openSheet({ title: "Payments", left: "Close", body: B => paint(B, sel) });
}
