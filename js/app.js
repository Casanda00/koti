// Koti app entry: routing, views, sync status, offline support.
// Main places: Now, Month and Home, named at the top. "You" (settings) is behind your initial.
// Under Month: Bills, Income, Budgets and Spent. Under Home: each list and project.
import { store, listOf, HOME_PROJECT } from "./data.js";
import { $, $$, esc, initSheets, closeSheet, toast } from "./ui.js";
import { initSync, onSync, refresh } from "./sync.js";
import { mountSetup, renderSetup, renderPlans, renderCharts, openAdd, setProject } from "./setup.js";
import { mountMore, renderMore, bindMore, openNewPassword } from "./more.js";
import { mountMoney, renderMoney, openExpense } from "./money.js";
import { mountSpending, renderSpending } from "./spent.js";
import { initPullToRefresh } from "./ptr.js";
import { mountPlan, renderPlanView, openBill } from "./plan.js";
import { mountIncome, renderIncome, openSource } from "./income.js";
import { mountList, openList, renderList, openAddMenu, openAddToList, currentList } from "./lists.js";
import { initReceipts, uploadPending } from "./receipts.js";
import { initUpdates, checkForUpdate } from "./update.js";
import { openScan } from "./scan.js";
import { mountNow, renderNow } from "./now.js";
import { mountMonth, renderMonth } from "./month.js";
import { mountPlace, renderPlace } from "./place.js";
import { mountReminders, renderReminders } from "./reminders.js";
import { initComposer, paintComposer } from "./composer.js";
import { shouldOnboard, openOnboarding, dismissIfAnswered } from "./onboarding.js";
import { startInstall, openInstall, snoozeStrip } from "./install.js";
import { monthName } from "./period.js";

const OLD = { setup: "list/" + HOME_PROJECT, money: "budgets", plan: "bills", more: "settings", expenses: "projects", home: "projects", today: "now" };   // links from earlier versions
const TAB = { now: "now", month: "month", budgets: "month", income: "month", spending: "month", bills: "month", projects: "month", list: "month", project: "month", settings: "settings", reminders: "settings" };
const TITLE = { now: "Today", month: "Month", projects: "Projects", budgets: "Budgets", income: "Income", spending: "Spent", bills: "Bills", settings: "You", reminders: "Reminders" };
let current = null, currentKey = null;

function parse() {
  let h = decodeURIComponent((location.hash || "").slice(1)) || "now";
  if (OLD[h]) { h = OLD[h]; history.replaceState(null, "", "#" + h); }
  if (h.startsWith("spending/")) return { view: "spending", id: h.slice(9) };
  if (h.startsWith("list/")) { const id = h.slice(5), l = listOf(id); return { view: l && l.kind === "project" ? "project" : "list", id }; }
  return { view: TITLE[h] ? h : "now" };
}
function renderCurrent() {
  ({ now: renderNow, month: renderMonth, projects: renderPlace, reminders: renderReminders, budgets: renderMoney, income: renderIncome, spending: renderSpending, bills: renderPlanView, list: renderList, settings: renderMore,
     project: () => { renderSetup(); } })[current]?.();
}
function route() {
  const r = parse(), key = r.view + ":" + (r.id || "");
  if (key === currentKey) return;
  const from = current;
  current = r.view; currentKey = key; closeSheet();
  $$("[data-view]").forEach(v => { v.hidden = v.dataset.view !== current; v.classList.remove("sw-in-l", "sw-in-r"); });
  if ((from === "now" && current === "month") || (from === "month" && current === "now")) { const v = $(`[data-view="${current}"]`); if (v) v.classList.add(current === "month" ? "sw-in-l" : "sw-in-r"); }
  paintTabs();
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

/* The month tab is named after the month ("November"); the dots show which of the two tabs you're on. */
function paintTabs() {
  const t = $("#monthTab"); if (t) t.textContent = monthName();
  const d = $("#swdots"), two = current === "now" || current === "month";
  if (d) { d.hidden = !two; $$("i", d).forEach((x, k) => x.classList.toggle("on", (k === 0) === (current === "now"))); }
}
/* Swipe left from Today for the month, right from the month for Today. Not while a sheet is open, and not when the
   swipe starts on something that scrolls sideways or takes text. */
function initSwipe() {
  let x0 = null, y0 = null, t0 = 0, ok = false;
  const main = $("#main");
  main.addEventListener("touchstart", e => {
    ok = (current === "now" || current === "month") && $("#layer").hidden && e.touches.length === 1 && !e.target.closest("input, textarea, select, .chips, .pk-m, .sp-days, [data-noswipe]");
    if (!ok) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  main.addEventListener("touchend", e => {
    if (!ok || x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - t0 > 700) return;
    if (dx < 0 && current === "now") location.hash = "#month";
    else if (dx > 0 && current === "month") location.hash = "#now";
  }, { passive: true });
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
/* The phone's time zone, saved with the settings: reminders use it for "today" and for the hour they arrive. */
function saveTimeZone() {
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz && store.model.settings.tz !== tz) store.updateSettings({ tz }); } catch { /* the reminders keep Helsinki */ }
}
function init() {
  initSheets();
  mountNow($("#view-now")); mountMonth($("#view-month")); mountPlace($("#view-home")); mountReminders($("#view-reminders")); mountMoney($("#view-budgets")); mountIncome($("#view-income")); mountSpending($("#view-spending"));
  mountPlan($("#view-bills")); mountList($("#view-list")); mountSetup($("#view-project"));
  mountMore($("#view-more")); bindMore();

  store.on(kind => {
    if (kind === "remote") { applyDefaults2(); syncLook(); dismissIfAnswered(); }
    if (current === "project" && !listOf(parse().id)) { location.hash = "#projects"; return; }
    renderCurrent(); paintMe(); paintComposer();
  });
  onSync((s, ev) => { paintSync(s); renderCurrent(); if (ev === "recovery") openNewPassword(); });
  applyDefaults2();
  saveTimeZone();
  initSync();
  initReceipts();

  document.addEventListener("click", e => {
    if (e.target.closest("[data-scan]")) { e.preventDefault(); openScan(); return; }
    if (e.target.closest("[data-suggest-budgets]")) { e.preventDefault(); closeSheet(); setTimeout(() => import("./budgetai.js").then(m => m.openBudgetHelp()), 60); return; }
    if (e.target.closest("[data-install]")) { e.preventDefault(); openInstall(); return; }
    if (e.target.closest("[data-ask-koti]")) { e.preventDefault(); import("./koti.js").then(m => m.openKoti()); return; }
    if (e.target.closest("[data-install-later]")) { e.preventDefault(); snoozeStrip(); renderCurrent(); return; }
  });
  // A reminder was answered from its notification: fetch the change so Now and Month show it.
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "koti-refresh") refresh(); });
  document.addEventListener("koti-install-ready", () => { if (current === "now") renderCurrent(); });
  document.addEventListener("koti:brief", () => { if (current === "now") renderCurrent(); });
  window.addEventListener("hashchange", route);
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (current === "project") { renderPlans(); renderCharts(); } else renderCurrent(); }, 120); });
  initComposer(() => current);
  initSwipe();
  route();
  if (shouldOnboard() && !new URLSearchParams(location.search).get("add")) openOnboarding();
  startInstall({ ready: () => !document.body.classList.contains("onb-open") });   // the Home Screen sheet waits for the first-time questions
  initPullToRefresh({ beforeRefresh: () => checkForUpdate(), onRefreshed: () => { uploadPending(); renderCurrent(); } });
  initUpdates();
  const q = new URLSearchParams(location.search);
  if (q.get("add") === "item") openAddToList();
  if (q.get("add") === "expense") { if (q.get("mode") === "scan") openScan(); else openExpense(); }
  if (q.get("add") === "scan") openScan();
  if (q.get("ask") != null) { history.replaceState(null, "", location.pathname + "#now"); import("./koti.js").then(m => m.openKoti({ message: q.get("ask") || "" })); }
  if (q.get("payments")) { const sel = q.get("payments"); history.replaceState(null, "", location.pathname + "#now"); import("./receipt.js").then(m => m.openPayments(["today", "yesterday", "week", "lastweek", "month", "lastmonth"].includes(sel) ? sel : "today")); }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").then(reg => {
      reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) checkForUpdate({ quiet: true });
      }); });
    }).catch(() => {});
  }
}
init();
