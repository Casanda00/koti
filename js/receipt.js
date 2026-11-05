// "Today's payments": the payments you made, printed like a receipt, for any period you pick from its title.
// Also where today's share is worked out, for Today.
import { store, todayISO, BILLS_CAT } from "./data.js";
import * as E from "./engine.js";
import { esc, eur, eur0, parseDay, openSheet } from "./ui.js";
import { periodFor, catName } from "./money.js";
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
  return { L: monthLedger(periodFor(new Date())), pd: nextPay(), days: D.days, spent: eu(D.spent), morning: eu(D.morning), share: eu(D.share), left: eu(D.left),
    entries: spentBetween(t, t).entries.filter(e => !(e.categoryId === BILLS_CAT)) };
}

const title = sel => sel === "today" ? "Today's payments" : sel === "yesterday" ? "Yesterday's payments" : sel === "week" ? "This week's payments" : sel === "lastweek" ? "Last week's payments" : `${labelOf(sel)} payments`;
const row = (label, value, sub, cls = "") => `<div class="rc-r ${cls}"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><b>${value}</b></div>`;

/* The payments themselves: every expense and bill paid in the period, newest first, and the total. */
function body(sel) {
  const r = rangeOf(sel), S = spentBetween(r.from, r.to), one = r.from === r.to;
  const list = S.entries.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const day = d => parseDay(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const rows = list.map(e => row(e.payee || catName(e.categoryId), minus(e.kind === "refund" ? -e.amount : e.amount), [e.payee ? catName(e.categoryId) : null, one ? null : day(e.date)].filter(Boolean).join(" · ") || null));
  if (rows.length) rows[rows.length - 1] = rows[rows.length - 1].replace('class="rc-r ', 'class="rc-r dbl ');
  const range = one ? longDay(r.from) : `${parseDay(r.from).toLocaleDateString("en-GB", { day: "numeric", month: "long" })} to ${parseDay(r.to).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
  return { date: range, rows, total: ["Total", eur(S.total, Number.isInteger(Math.round(S.total * 100) / 100) ? 0 : 2)], foot: rows.length ? "" : "No payments." };
}

export function openPayments(sel = "today") {
  const paint = (B, s) => {
    const R = body(s);
    B.innerHTML = `<div class="pay-h">${pickerHTML(s, title(s))}</div>
      <div class="receipt num">
        <p class="rc-d">${esc(R.date)}</p>
        ${R.rows.join("")}
        ${R.rows.length ? `<div class="rc-r rc-t"><span>${esc(R.total[0])}</span><b>${R.total[1]}</b></div>` : ""}
        ${R.foot ? `<p class="rc-f">${esc(R.foot)}</p>` : ""}
      </div>`;
    bindPicker(B, s, pick => paint(B, pick));
  };
  openSheet({ title: "Payments", left: "Close", body: B => paint(B, sel) });
}
