// Month: the plan as one sentence you can tap (money in, bills, saving, living), then living money by category,
// what's still left to plan, and a way to match the balance to the bank.
import { store, todayISO, BILLS_CAT } from "./data.js";
import { $, esc, eur0, toast } from "./ui.js";
import { periodFor, totals, openCategories, openCheckBank } from "./money.js";
import { setSpendingFilter } from "./spent.js";
import { monthLedger, effectiveBudgets, startPoint } from "./ledger.js";
import { billTotals } from "./plan.js";
import { incomeTotals, openSource } from "./income.js";

const monthName = p => p.end.toLocaleDateString("en-GB", { month: "long" });
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
  const saving = store.model.goals.reduce((a, g) => a + (g.saved < g.target ? Number(g.monthly) || 0 : 0), 0);
  const living = income - B.total - saving, unplanned = Math.round(living - eb.total);
  const m = monthName(p);
  const chip = (cls, href, v) => `<a class="mchip ${cls}" href="${href}">${eur0(v)}</a>`;

  const sentence = income > 0
    ? `<p class="msent">In ${esc(m)} ${chip("in", "#income", income)} comes in. ${B.total ? `${chip("bills", "#bills", B.total)} goes to bills, ` : `<a class="mchip bills" href="#bills">No bills</a> yet, `}${saving ? `${chip("save", "#budgets", saving)} to savings, and ` : "and "}${chip("live", "#budgets", Math.max(0, living))} is for living.</p>
       <div class="mbar" role="img" aria-label="Of ${eur0(income)}: bills ${eur0(B.total)}, savings ${eur0(saving)}, living ${eur0(Math.max(0, living))}"><i class="b" style="width:${Math.min(100, B.total / income * 100)}%"></i>${saving ? `<i class="s" style="width:${Math.min(100, saving / income * 100)}%"></i>` : ""}<i class="l"></i></div>
       <p class="mhint">Tap a number to change it.</p>`
    : `<p class="msent">What comes in each month? Add your pay and Koti plans ${esc(m)} around it.</p><button type="button" class="pill" data-add-income>Add your pay</button>`;

  const rows = store.model.categories.filter(c => c.id !== BILLS_CAT && eb.byId[c.id] != null).sort((a, b) => a.position - b.position).map(c => {
    const b = Math.max(0, eb.byId[c.id]), s = T.byCat[c.id] || 0, over = s > b, r = b ? Math.min(1, s / b) : (s ? 1 : 0);
    return `<button type="button" class="mrow" data-catgo="${esc(c.id)}"><span class="mr-t"><b>${esc(c.name)}</b><span class="${over ? "danger" : r >= .85 ? "warn-t" : ""}">${over ? `<b>${eur0(s - b)}</b> over` : `<b>${eur0(b - s)}</b> to go`}</span></span>
      <span class="mr-bar"><i class="${over ? "over" : r >= .85 ? "low" : ""}" style="width:${r * 100}%"></i></span></button>`;
  }).join("");
  const kept = (store.model.settings.kept || {})[keptKey(p)];

  root.innerHTML = `
    ${sentence}
    <div class="mhead"><h2>Living money</h2><a href="#budgets">Budgets</a></div>
    <p class="msub">${eb.total ? `${eur0(eb.total)} shared out between ${store.model.categories.filter(c => eb.byId[c.id] > 0).length} categories.` : "No budgets yet. Share out your living money to see how each part is going."}</p>
    <div class="mrows">${rows || `<button type="button" class="pill" data-plan-cats>Set budgets</button>`}</div>
    ${income > 0 && unplanned > 0 && !kept ? `<div class="mplan2"><p>You have ${eur0(unplanned)} left to plan.</p><div class="btns"><button type="button" class="pill" data-plan-cats>Add to a category</button><button type="button" class="pill ghost" data-keep>Keep for ${esc(nextMonthName(p))}</button></div></div>` : ""}
    ${income > 0 && unplanned < 0 ? `<div class="mplan2 warn"><p>Your budgets are ${eur0(-unplanned)} more than your living money.</p><div class="btns"><button type="button" class="pill" data-plan-cats>Change budgets</button></div></div>` : ""}
    <nav class="mlinks" aria-label="More in Month"><a href="#bills">Bills</a><a href="#income">Income</a><a href="#spending/week">Spent</a><a href="#budgets">Budgets and savings</a></nav>
    ${L.kind === "current" ? `<p class="mbank">${startPoint().set ? `Koti thinks you have ${eur0(L.now)} right now.` : "Koti doesn't know your bank balance yet."} <button type="button" class="tlink" data-bank>${startPoint().set ? "Check against my bank" : "Tell Koti"}</button></p>` : ""}`;
}
