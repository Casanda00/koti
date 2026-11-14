// "Today's payments": the payments you made, printed like a receipt, for any period you pick from its title.
// Also where today's share is worked out, for Today.
import { store, todayISO, BILLS_CAT } from "./data.js";
import * as E from "./engine.js";
import { esc, eur, eur0, parseDay, openSheet } from "./ui.js";
import { periodFor, catName, payWords } from "./money.js";
import { monthLedger } from "./ledger.js";
import { nextPay } from "./income.js";
import { rangeOf, spentBetween } from "./spent.js";
import { pickerHTML, bindPicker, labelOf } from "./period.js";

const minus = v => (v > 0.004 ? "−" : "") + eur(Math.abs(v), Number.isInteger(Math.round(Math.abs(v) * 100) / 100) ? 0 : 2);
const longDay = d => parseDay(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/* Today's share: what was left until payday this morning, shared out over the days to payday. Bills paid today
   don't count against it: they were already taken off. */
export function dayShare() {
  const t = todayISO(), D = E.dayShare(store.model, t);
  if (!D) return null;
  const eu = v => (v == null ? null : E.euros(v));
  return { L: monthLedger(periodFor(new Date())), pd: nextPay(), days: D.days, spent: eu(D.spent), morning: eu(D.morning), share: eu(D.share), left: eu(D.left), tomorrow: eu(D.tomorrow),
    entries: spentBetween(t, t).entries.filter(e => !(e.categoryId === BILLS_CAT)) };
}

const title = sel => sel === "today" ? "Today's payments" : sel === "yesterday" ? "Yesterday's payments" : sel === "week" ? "This week's payments" : sel === "lastweek" ? "Last week's payments" : `${labelOf(sel)} payments`;
const row = (label, value, sub, cls = "") => `<div class="rc-r ${cls}"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><b>${value}</b></div>`;

const isBill = e => !!(e.billId || e.categoryId === BILLS_CAT);
const isPlannedPay = e => E.isPlanned(e);

/* The payments themselves: every expense and bill paid in the period, newest first, and the total. */
export function paymentsBody(sel) { return body(sel); }
function body(sel) {
  const r = rangeOf(sel), S = spentBetween(r.from, r.to), one = r.from === r.to;
  const list = S.entries.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const day = d => parseDay(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  // Spending from the next pay is listed with the day it comes out, and kept out of the total: it isn't this
  // money (the owner, 13 November 2026: two lunches said to come out of the next pay read as today's spending).
  const rows = list.map(e => row(e.payee || catName(e.categoryId), minus(e.kind === "refund" ? -e.amount : e.amount),
    [isBill(e) ? "Bill, paid from money set aside" : isPlannedPay(e) ? `${catName(e.categoryId)} · planned, paid from money set aside` : e.payee ? catName(e.categoryId) : null, one ? null : day(e.date), E.fromNextPay(e) ? `From your pay on ${payWords({ date: e.fromPay })}` : null].filter(Boolean).join(" · ") || null, E.fromNextPay(e) || isBill(e) || isPlannedPay(e) ? "later" : ""));
  if (rows.length) rows[rows.length - 1] = rows[rows.length - 1].replace('class="rc-r ', 'class="rc-r dbl ');
  const range = one ? longDay(r.from) : `${parseDay(r.from).toLocaleDateString("en-GB", { day: "numeric", month: "long" })} to ${parseDay(r.to).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
  // Bills were set aside before they were paid, so paying one isn't spending today's money: it's listed, and shown
  // apart from the total (14 November 2026: bills marked Paid read as today's spending).
  const sum = xs => Math.round(xs.reduce((s, e) => s + (e.kind === "refund" ? -e.amount : e.amount), 0) * 100) / 100;
  const later = sum(list.filter(e => E.fromNextPay(e))), bills = sum(list.filter(e => isBill(e) || isPlannedPay(e))), paid = Math.round((S.total - later - bills) * 100) / 100;
  const money = v => eur(v, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2);
  return { date: range, rows, total: ["Total", money(paid)], later: later ? ["From your next pay", money(later)] : null, bills: bills ? ["Bills and planned payments", money(bills)] : null, foot: rows.length ? "" : "No payments." };
}

export function openPayments(sel = "today") {
  const paint = (B, s) => {
    const R = body(s);
    B.innerHTML = `<div class="pay-h">${pickerHTML(s, title(s))}</div>
      <div class="receipt num">
        <p class="rc-d">${esc(R.date)}</p>
        ${R.rows.join("")}
        ${R.rows.length ? `<div class="rc-r rc-t"><span>${esc(R.total[0])}</span><b>${R.total[1]}</b></div>` : ""}
        ${R.later ? `<div class="rc-r rc-later"><span>${esc(R.later[0])}<small>Not counted in the total</small></span><b>${R.later[1]}</b></div>` : ""}
        ${R.bills ? `<div class="rc-r rc-later"><span>${esc(R.bills[0])}<small>From money set aside, not counted in the total</small></span><b>${R.bills[1]}</b></div>` : ""}
        ${R.foot ? `<p class="rc-f">${esc(R.foot)}</p>` : ""}
      </div>`;
    bindPicker(B, s, pick => paint(B, pick));
  };
  openSheet({ title: "Payments", left: "Close", body: B => paint(B, sel) });
}
