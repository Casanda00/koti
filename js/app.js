// Koti app entry: routing, views, sync status, offline support.
// Main places: Now, Month and Home, named at the top. "You" (settings) is behind your initial.
// Under Month: Bills, Income, Budgets and All spending. Under Home: each list and project.
import { store, listOf, HOME_PROJECT } from "./data.js";
import { $, $$, esc, initSheets, closeSheet, toast } from "./ui.js";
import { initSync, onSync } from "./sync.js";
import { mountSetup, renderSetup, renderPlans, renderCharts, openAdd, setProject } from "./setup.js";
import { mountMore, renderMore, bindMore, openNewPassword } from "./more.js";
import { mountMoney, renderMoney, mountSpending, renderSpending, openExpense } from "./money.js";
import { initPullToRefresh } from "./ptr.js";
import { mountPlan, renderPlanView, openBill, runAutopay } from "./plan.js";
import { mountIncome, renderIncome, openSource } from "./income.js";
import { mountList, openList, renderList, openAddMenu, openAddToList, currentList } from "./lists.js";
import { initReceipts, uploadPending } from "./receipts.js";
import { initUpdates, checkForUpdate } from "./update.js";
import { openScan } from "./scan.js";
import { mountNow, renderNow } from "./now.js";
import { mountMonth, renderMonth } from "./month.js";
import { mountPlace, renderPlace } from "./place.js";
import { initComposer, paintComposer } from "./composer.js";
import { shouldOnboard, openOnboarding, dismissIfAnswered } from "./onboarding.js";

const OLD = { setup: "list/" + HOME_PROJECT, money: "budgets", plan: "bills", more: "settings", expenses: "home" };   // links from earlier versions
const TAB = { now: "now", month: "month", budgets: "month", income: "month", spending: "month", bills: "month", home: "home", list: "home", project: "home", settings: "settings" };
const TITLE = { now: "Now", month: "Month", home: "Home", budgets: "Budgets", income: "Income", spending: "All spending", bills: "Bills", settings: "You" };
let current = null, currentKey = null;

function parse() {
  let h = decodeURIComponent((location.hash || "").slice(1)) || "now";
  if (OLD[h]) { h = OLD[h]; history.replaceState(null, "", "#" + h); }
  if (h.startsWith("list/")) { const id = h.slice(5), l = listOf(id); return { view: l && l.kind === "project" ? "project" : "list", id }; }
  return { view: TITLE[h] ? h : "now" };
}
function renderCurrent() {
  ({ now: renderNow, month: renderMonth, home: renderPlace, budgets: renderMoney, income: renderIncome, spending: renderSpending, bills: renderPlanView, list: renderList, settings: renderMore,
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
  if (current !== "now") delete document.body.dataset.mood;
  paintComposer();
  const l = r.id && listOf(r.id);
  document.title = "Koti · " + (l ? l.name : TITLE[current] || "Koti");
  window.scrollTo(0, 0);
}

function paintSync(s) {
  $$("[data-sync]").forEach(p => { p.dataset.state = s.status; const t = $(".t", p); if (t) t.textContent = s.text; p.title = s.detail || s.text; });
  paintMe();
}

function paintMe() {
  const S = store.model.settings, nm = (S.name || "").trim(), me = $("#meLink"); if (!me) return;
  me.innerHTML = nm ? esc(nm[0].toUpperCase()) : `<svg class="ic" aria-hidden="true"><use href="#i-user"/></svg>`;
}
/* Colours and light/dark follow your account: a change on another device applies here too. */
/* One-time change of defaults: documents aren't kept (storage costs), and Koti is light green. */
function applyDefaults2() {
  const S = store.model.settings; if (S.defaults2) return;
  store.updateSettings({ keepBills: false, keepReceipts: false, palette: "koti", mode: "light", defaults2: true });
  if (window.kotiTheme) { window.kotiTheme.set("palette", "koti"); window.kotiTheme.set("mode", "light"); }
}
function syncLook() {
  const S = store.model.settings, T = window.kotiTheme; if (!T) return; const cur = T.get();
  if (S.palette && S.palette !== cur.palette) T.set("palette", S.palette);
  if (S.mode && S.mode !== cur.mode) T.set("mode", S.mode);
}
function init() {
  initSheets();
  mountNow($("#view-now")); mountMonth($("#view-month")); mountPlace($("#view-home")); mountMoney($("#view-budgets")); mountIncome($("#view-income")); mountSpending($("#view-spending"));
  mountPlan($("#view-bills")); mountList($("#view-list")); mountSetup($("#view-project"));
  mountMore($("#view-more")); bindMore();
  runAutopay();

  let autoT; store.on(kind => {
    if (kind === "remote") { applyDefaults2(); syncLook(); dismissIfAnswered(); }
    if (current === "project" && !listOf(parse().id)) { location.hash = "#home"; return; }
    renderCurrent(); paintMe(); paintComposer();
    if (kind === "remote") { clearTimeout(autoT); autoT = setTimeout(runAutopay, 400); }
  });
  onSync((s, ev) => { paintSync(s); renderCurrent(); if (ev === "recovery") openNewPassword(); });
  applyDefaults2();
  initSync();
  initReceipts();

  document.addEventListener("click", e => {
    if (e.target.closest("[data-scan]")) { e.preventDefault(); openScan(); return; }
  });
  window.addEventListener("hashchange", route);
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (current === "project") { renderPlans(); renderCharts(); } else renderCurrent(); }, 120); });
  initComposer(() => current);
  route();
  if (shouldOnboard() && !new URLSearchParams(location.search).get("add")) openOnboarding();
  initPullToRefresh({ beforeRefresh: () => checkForUpdate(), onRefreshed: () => { runAutopay(); uploadPending(); renderCurrent(); } });
  initUpdates();
  const q = new URLSearchParams(location.search);
  if (q.get("add") === "item") openAddToList();
  if (q.get("add") === "expense") { if (q.get("mode") === "scan") openScan(); else openExpense(); }
  if (q.get("add") === "scan") openScan();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").then(reg => {
      reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) checkForUpdate({ quiet: true });
      }); });
    }).catch(() => {});
  }
}
init();
