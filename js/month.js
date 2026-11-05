// The month (named, like November): income, bills, savings and living expenses, then each budget,
// what's still left to plan, and a way to match the balance to the bank.
import { store, todayISO, BILLS_CAT } from "./data.js";
import { $, esc, eur0, toast } from "./ui.js";
import { periodFor, totals, openCategories, openCheckBank } from "./money.js";
import { setSpendingFilter } from "./spent.js";
import { monthName } from "./period.js";
import { monthLedger, effectiveBudgets, startPoint } from "./ledger.js";
import { billTotals } from "./plan.js";
import { incomeTotals, openSource } from "./income.js";
import * as E from "./engine.js";

const nextMonthName = p => new Date(p.end.getFullYear(), p.end.getMonth() + 1, 1).toLocaleDateString("en-GB", { month: "long" });
const keptKey = p => `kept:${p.from}`;

let root = null;
export function mountMonth(el) {
  root = el;
  root.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-add-income]")) { openSource(null, { name: "Salary", frequency: "monthly" }); return; }
    if (t.closest("[data-plan-cats]")) { openCategories(); return; }
    if (t.closest("[data-keep]")) { const p = periodFor(new Date()); store.updateSettings({ kept: { ...(store.model.settings.kept || {}), [keptKey(p)]: true } }); toast(`Kept for ${nextMonthName(p)}. Whatever you don't spend carries over.`); return; }
    if (t.closest("[data-bank]")) { openCheckBank(); return; }
    const c = t.closest("[data-catgo]"); if (c) { setSpendingFilter(c.dataset.catgo); location.hash = "#spending"; }
  });
}

export function renderMonth() {
  if (!root) return;
  const p = periodFor(new Date()), I = incomeTotals(p), B = billTotals(p), T = totals(p), eb = effectiveBudgets(p), L = monthLedger(p);
  const looseIncome = T.incomeLoose || 0, income = I.total + looseIncome;
  const saving = E.euros(E.goalsMonthly(store.model));   // this month's plan for goals not yet reached
  const living = income - B.total - saving, unplanned = Math.round(living - eb.total);
  const m = monthName(p);

  const left = Math.max(0, Math.round((p.end - new Date(new Date().setHours(0, 0, 0, 0))) / 864e5) + 1);
  const num = (k, v, href) => `<a class="mnum" href="${href}"><small>${k}</small><b class="num">${eur0(v)}</b></a>`;
  const top = income > 0
    ? `<p class="mleft">${left} day${left === 1 ? "" : "s"} left in ${esc(m)}</p>
       <div class="mnums">${num("Income", income, "#income")}${num("Bills", B.total, "#bills")}${num("Savings", saving, "#budgets")}${num("Living expenses", Math.max(0, living), "#budgets")}</div>
       <nav class="mbar" aria-label="Where ${eur0(income)} goes"><a class="b" href="#bills" style="width:${Math.min(100, B.total / income * 100)}%" aria-label="Bills, ${eur0(B.total)}"></a>${saving ? `<a class="s" href="#budgets" style="width:${Math.min(100, saving / income * 100)}%" aria-label="Savings, ${eur0(saving)}"></a>` : ""}<a class="l" href="#spending/month" aria-label="Living expenses, ${eur0(Math.max(0, living))}"></a></nav>`
    : `<p class="msent">Add your pay to plan ${esc(m)}.</p><button type="button" class="pill" data-add-income>Add your pay</button>`;

  const rows = store.model.categories.filter(c => c.id !== BILLS_CAT && eb.byId[c.id] != null).sort((a, b) => a.position - b.position).map(c => {
    const b = Math.max(0, eb.byId[c.id]), s = T.byCat[c.id] || 0, over = s > b, r = b ? Math.min(1, s / b) : (s ? 1 : 0);
    return `<button type="button" class="mrow" data-catgo="${esc(c.id)}"><span class="mr-t"><b>${esc(c.name)}</b><span class="${over ? "danger" : r >= .85 ? "warn-t" : ""}">${over ? `<b>${eur0(s - b)}</b> over` : `<b>${eur0(b - s)}</b> left`}</span></span>
      <span class="mr-bar"><i class="${over ? "over" : r >= .85 ? "low" : ""}" style="width:${r * 100}%"></i></span></button>`;
  }).join("");
  const kept = (store.model.settings.kept || {})[keptKey(p)];

  root.innerHTML = `
    ${top}
    <div class="mhead"><h2>Budgets</h2><a href="#budgets">Change</a></div>
    <div class="mrows">${rows || `<button type="button" class="pill" data-plan-cats>Set budgets</button>`}</div>
    ${income > 0 && unplanned > 0 && !kept ? `<div class="mplan2"><p>You have ${eur0(unplanned)} left to plan.</p><div class="btns"><button type="button" class="pill" data-plan-cats>Add to a category</button><button type="button" class="pill ghost" data-keep>Keep for ${esc(nextMonthName(p))}</button></div></div>` : ""}
    ${income > 0 && unplanned < 0 ? `<div class="mplan2 warn"><p>Your budgets are ${eur0(-unplanned)} more than your living expenses.</p><div class="btns"><button type="button" class="pill" data-plan-cats>Change budgets</button></div></div>` : ""}
    <nav class="mlinks" aria-label="More in ${esc(m)}"><a href="#bills">Bills</a><a href="#income">Income</a><a href="#spending/month">Spent</a><a href="#budgets">Savings</a><a href="#projects">Projects</a></nav>
    ${L.kind === "current" ? `<p class="mbank">${startPoint().set ? `In your account: ${eur0(L.now)}.` : "Your bank balance is missing."} <button type="button" class="tlink" data-bank>${startPoint().set ? "Match it to my bank" : "Add it"}</button></p>` : ""}`;
}
