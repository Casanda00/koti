// Koti app entry: routing, views, sync status, offline support.
import { store } from "./data.js";
import { $, $$, icon, initSheets, closeSheet, toast } from "./ui.js";
import { initSync, onSync, sync } from "./sync.js";
import { mountSetup, renderSetup, renderPlans, renderCharts, openAdd } from "./setup.js";
import { mountMore, renderMore, bindMore, openAuth, openNewPassword } from "./more.js";
import { mountMoney, renderMoney, openExpense } from "./money.js";
import { initPullToRefresh } from "./ptr.js";
import { mountPlan, renderPlanView, openBill, runAutopay } from "./plan.js";

const ROUTES = ["setup", "money", "plan", "more"];
let current = null;

function route() {
  let r = (location.hash || "#setup").slice(1);
  if (!ROUTES.includes(r)) r = "setup";
  if (r === current) return;
  current = r; closeSheet();
  $$("[data-view]").forEach(v => v.hidden = v.dataset.view !== r);
  $$("[data-route]").forEach(a => { if (a.dataset.route === r) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  document.title = { setup: "Koti · Home setup", money: "Koti · Money", plan: "Koti · Plan", more: "Koti · More" }[r];
  if (r === "setup") { renderPlans(); renderCharts(); }
  if (r === "more") renderMore();
  if (r === "money") renderMoney();
  if (r === "plan") renderPlanView();
  window.scrollTo(0, 0);
}

function paintSync(s) {
  $$("[data-sync]").forEach(p => { p.dataset.state = s.status; $(".t", p).textContent = s.text; p.title = s.detail || s.text; });
  const f = $("#sideFoot"); if (f) f.textContent = s.user ? s.user.email : (s.configured ? "Not signed in" : "Saved on this device");
}

function init() {
  initSheets();
  mountSetup($("#view-setup"));
  mountMoney($("#view-money"));
  mountPlan($("#view-plan"));
  mountMore($("#view-more")); bindMore();
  renderSetup(); renderMoney(); renderPlanView();
  runAutopay();

  let autoT; store.on(kind => { renderSetup(); renderMoney(); renderPlanView(); if (current === "more") renderMore(); if (kind === "remote") { clearTimeout(autoT); autoT = setTimeout(runAutopay, 400); } });
  onSync((s, ev) => { paintSync(s); if (current === "more") renderMore(); renderSetup(); renderMoney(); renderPlanView(); if (ev === "recovery") openNewPassword(); });
  initSync();

  document.addEventListener("click", e => { if (e.target.closest("[data-action=add]")) { e.preventDefault(); if (current === "setup") openAdd(); else if (current === "plan") openBill(); else openExpense(); } });
  window.addEventListener("hashchange", route);
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (current === "setup") { renderPlans(); renderCharts(); } if (current === "money") renderMoney(); }, 120); });
  route();
  initPullToRefresh({ onRefreshed: () => { runAutopay(); renderSetup(); renderMoney(); renderPlanView(); if (current === "setup") { renderPlans(); renderCharts(); } if (current === "more") renderMore(); } });
  const q = new URLSearchParams(location.search);
  if (q.get("add") === "1" || q.get("add") === "item") openAdd();
  if (q.get("add") === "expense") openExpense({ mode: q.get("mode") === "speak" ? "speak" : "type" });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").then(reg => {
      reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) toast("A new version of Koti is ready", { label: "Reload", run: () => location.reload() });
      }); });
    }).catch(() => {});
  }
}
init();
