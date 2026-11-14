// The month (named, like November): what's yours to spend, worked out from the bank balance (the same figure as
// Today's "left until payday", with the lines that make it), the next pay, what's been spent, then each budget.
import { store, BILLS_CAT } from "./data.js";
import { esc, eur0 } from "./ui.js";
import { periodFor, totals, openCategories, openCheckBank, payWords } from "./money.js";
import { setSpendingFilter } from "./spent.js";
import { monthName } from "./period.js";
import { monthLedger, effectiveBudgets, startPoint } from "./ledger.js";
import { openSource } from "./income.js";


let root = null;
export function mountMonth(el) {
  root = el;
  root.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-add-income]")) { openSource(null, { name: "Salary", frequency: "monthly" }); return; }
    if (t.closest("[data-plan-cats]")) { openCategories(); return; }
    if (t.closest("[data-bank]")) { openCheckBank(); return; }
    const c = t.closest("[data-catgo]"); if (c) { setSpendingFilter(c.dataset.catgo); location.hash = "#spending"; }
  });
}

export function renderMonth() {
  if (!root) return;
  const p = periodFor(new Date()), T = totals(p), eb = effectiveBudgets(p), L = monthLedger(p), m = monthName(p);
  const days = Math.max(0, Math.round((p.end - new Date(new Date().setHours(0, 0, 0, 0))) / 864e5) + 1);
  const money = v => (v < 0 ? "−" : "") + eur0(Math.abs(v));
  const until = L.until ? new Date(L.until + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : null;

  // One figure, worked out from the bank balance the same way as Today: where the month started, what came in and went
  // out since (every expense so far is a line), what's in the account now, less what's already spoken for. The plan from the whole month's pay (pay − bills = "living expenses") is gone: it never matched the bank
  // and said the same 2 109 € twice (14 November 2026).
  let top = "";
  if (L.kind === "current") {
    const sp = startPoint(), set = sp.set, dayWord = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" }), line = (k, v, href) => `<${href ? `a href="${href}"` : "div"} class="mrec-r"><span>${k}</span><b class="num">${money(v)}</b></${href ? "a" : "div"}>`;
    const pay = (L.expected || []).find(o => o.src.amount);
    top = `<p class="mleft">${days} day${days === 1 ? "" : "s"} left in ${esc(m)}</p>
    <div class="mhero"><small>${L.left < 0 ? "Over" : "Yours to spend"}${L.payday ? " until payday" : until ? ` until ${esc(until)}` : ""}</small><b class="num">${money(L.left)}</b></div>
    <div class="mrec">
      ${set ? `${line(L.startsHere ? (sp.date === p.from ? `In your account on ${esc(dayWord(sp.date))}` : `Your bank on ${esc(dayWord(sp.date))}`) : `At the start of ${esc(m)}`, L.carried)}
      ${L.income ? line("Pay in", L.income, "#income") : ""}
      ${L.spent ? line(L.startsHere && sp.date > p.from ? "Spent since then" : "Spent so far", -L.spent, "#spending/month") : ""}
      ${L.bills ? line("Bills paid", -L.bills, "#bills") : ""}
      ${L.saved ? line(L.saved > 0 ? "Moved to savings" : "Taken from savings", -L.saved, "#budgets") : ""}
      ${L.fromSavings ? line("Paid from savings", L.fromSavings, "#budgets") : ""}
      ${L.adjust ? line("Corrections to match the bank", L.adjust) : ""}
      <div class="mrec-r mrec-t"><span>In your account now <button type="button" class="tlink" data-bank>Match to bank</button></span><b class="num">${money(L.now)}</b></div>`
            : `<div class="mrec-r"><span>Your bank balance is missing. <button type="button" class="tlink" data-bank>Add it</button></span><b class="num">${money(L.now)}</b></div>`}
      ${L.due ? line(`Bills still to pay${L.payday ? " before payday" : ""}`, -L.due, "#bills") : ""}
      ${L.aheadSum ? line("Payments planned ahead", -L.aheadSum, "#spending/month") : ""}
      ${L.savingsDue ? line("To move to savings", -L.savingsDue, "#budgets") : ""}
      ${L.due || L.aheadSum || L.savingsDue ? `<div class="mrec-r mrec-t"><span>Yours to spend</span><b class="num">${money(L.left)}</b></div>` : ""}
    </div>
    ${set && L.startsHere && sp.date > p.from ? `<p class="mnext">What you spent before ${esc(dayWord(sp.date))} is already in that bank balance.</p>` : ""}
    ${pay ? `<p class="mnext">Then ${esc(pay.src.name.toLowerCase() === "salary" ? "your salary" : pay.src.name)}, ${eur0(pay.src.amount)}, on ${esc(payWords({ date: pay.due }))}${L.owedSum ? `, less ${eur0(L.owedSum)} you said comes out of it` : ""}.</p>` : ""}`;
  } else top = `<p class="msent">Add your bank balance to see ${esc(m)}.</p><button type="button" class="pill" data-bank>Add it</button>`;

  const rows = store.model.categories.filter(c => c.id !== BILLS_CAT && eb.byId[c.id] != null).sort((a, b) => a.position - b.position).map(c => {
    const b = Math.max(0, eb.byId[c.id]), s = T.byCat[c.id] || 0, over = s > b, r = b ? Math.min(1, s / b) : (s ? 1 : 0);
    return `<button type="button" class="mrow" data-catgo="${esc(c.id)}"><span class="mr-t"><b>${esc(c.name)}</b><span class="${over ? "danger" : r >= .85 ? "warn-t" : ""}">${over ? `<b>${eur0(s - b)}</b> over` : `<b>${eur0(b - s)}</b> left`}</span></span>
      <span class="mr-bar"><i class="${over ? "over" : r >= .85 ? "low" : ""}" style="width:${r * 100}%"></i></span></button>`;
  }).join("");

  root.innerHTML = `
    ${top}
    <div class="mhead"><h2>Budgets</h2><a href="#budgets">${rows ? "Change" : "Set them"}</a></div>
    <div class="mrows">${rows || `<p class="hint" style="margin:0">No budgets yet. <button type="button" class="tlink" data-suggest-budgets>Let Koti suggest them</button></p>`}</div>
    <nav class="mlinks" aria-label="More in ${esc(m)}"><a href="#income">Income</a><a href="#budgets">Savings</a><a href="#projects">Projects</a></nav>`;
}
