// Koti app entry: routing, views, sync status, offline support.
// Main tabs: Budgets, Income, Expenses, More. Under Expenses: All spending, Bills, and each list or project.
import { store, listOf, HOME_PROJECT } from "./data.js";
import { $, $$, initSheets, closeSheet, toast } from "./ui.js";
import { initSync, onSync } from "./sync.js";
import { mountSetup, renderSetup, renderPlans, renderCharts, openAdd, setProject } from "./setup.js";
import { mountMore, renderMore, bindMore, openNewPassword } from "./more.js";
import { mountMoney, renderMoney, mountSpending, renderSpending, openExpense } from "./money.js";
import { initPullToRefresh } from "./ptr.js";
import { mountPlan, renderPlanView, openBill, runAutopay } from "./plan.js";
import { mountIncome, renderIncome, openSource } from "./income.js";
import { mountExpenses, renderExpenses, mountList, openList, renderList, openAddMenu, openAddToList, currentList } from "./lists.js";
import { initReceipts, uploadPending } from "./receipts.js";

const OLD = { setup: "list/" + HOME_PROJECT, money: "budgets", plan: "bills" };   // links from earlier versions
const TAB = { budgets: "budgets", income: "income", expenses: "expenses", spending: "expenses", bills: "expenses", list: "expenses", project: "expenses", more: "more" };
const TITLE = { budgets: "Budgets", income: "Income", expenses: "Expenses", spending: "All spending", bills: "Bills", more: "More" };
let current = null, currentKey = null;

function parse() {
  let h = decodeURIComponent((location.hash || "").slice(1)) || "budgets";
  if (OLD[h]) { h = OLD[h]; history.replaceState(null, "", "#" + h); }
  if (h.startsWith("list/")) { const id = h.slice(5), l = listOf(id); return { view: l && l.kind === "project" ? "project" : "list", id }; }
  return { view: TITLE[h] ? h : "budgets" };
}
function renderCurrent() {
  ({ budgets: renderMoney, income: renderIncome, expenses: renderExpenses, spending: renderSpending, bills: renderPlanView, list: renderList, more: renderMore,
     project: () => { renderSetup(); } })[current]?.();
}
function route() {
  const r = parse(), key = r.view + ":" + (r.id || "");
  if (key === currentKey) return;
  current = r.view; currentKey = key; closeSheet();
  $$("[data-view]").forEach(v => v.hidden = v.dataset.view !== current);
  $$("[data-route]").forEach(a => { if (a.dataset.route === TAB[current]) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (current === "project") setProject(r.id);
  else if (current === "list") openList(r.id);
  else renderCurrent();
  const l = r.id && listOf(r.id);
  document.title = "Koti · " + (l ? l.name : TITLE[current] || "Koti");
  window.scrollTo(0, 0);
}

function paintSync(s) {
  $$("[data-sync]").forEach(p => { p.dataset.state = s.status; const t = $(".t", p); if (t) t.textContent = s.text; p.title = s.detail || s.text; });
  const f = $("#sideFoot"); if (f) f.textContent = s.user ? s.user.email : (s.configured ? "Not signed in" : "Saved on this device");
}

function init() {
  initSheets();
  mountMoney($("#view-budgets")); mountIncome($("#view-income")); mountExpenses($("#view-expenses")); mountSpending($("#view-spending"));
  mountPlan($("#view-bills")); mountList($("#view-list")); mountSetup($("#view-project"));
  mountMore($("#view-more")); bindMore();
  runAutopay();

  let autoT; store.on(kind => {
    if (current === "project" && !listOf(parse().id)) { location.hash = "#expenses"; return; }
    renderCurrent();
    if (kind === "remote") { clearTimeout(autoT); autoT = setTimeout(runAutopay, 400); }
  });
  onSync((s, ev) => { paintSync(s); renderCurrent(); if (ev === "recovery") openNewPassword(); });
  initSync();
  initReceipts();

  document.addEventListener("click", e => {
    if (!e.target.closest("[data-action=add]")) return;
    e.preventDefault();
    if (current === "project") openAdd();
    else if (current === "list") { const i = $("#liAdd"); if (i) { i.focus(); i.scrollIntoView({ block: "center" }); } else openAddToList(currentList()); }
    else if (current === "bills") openBill();
    else if (current === "income") openSource();
    else openAddMenu();
  });
  window.addEventListener("hashchange", route);
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (current === "project") { renderPlans(); renderCharts(); } else renderCurrent(); }, 120); });
  route();
  initPullToRefresh({ onRefreshed: () => { runAutopay(); uploadPending(); renderCurrent(); } });
  const q = new URLSearchParams(location.search);
  if (q.get("add") === "item") openAddToList();
  if (q.get("add") === "expense") openExpense({ mode: q.get("mode") === "scan" ? "scan" : "type" });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").then(reg => {
      reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) toast("A new version of Koti is ready", { label: "Reload", run: () => location.reload() });
      }); });
    }).catch(() => {});
  }
}
init();
