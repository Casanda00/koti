// Koti app entry: routing, views, sync status, offline support.
import { store } from "./data.js";
import { $, $$, icon, initSheets, closeSheet, toast } from "./ui.js";
import { initSync, onSync, sync } from "./sync.js";
import { mountSetup, renderSetup, renderPlans, renderCharts, openAdd } from "./setup.js";
import { mountMore, renderMore, bindMore, openAuth, openNewPassword } from "./more.js";

const ROUTES = ["setup", "money", "plan", "more"];
let current = null;

function soon(view, title, ico, lead, points) {
  view.innerHTML = `<header class="vh"><div><h1>${title}</h1></div><a class="sync" href="#more" data-sync><span class="dot"></span><span class="t"></span></a></header>
    <div class="soon"><span class="ico g">${icon(ico)}</span><h2>Coming in the next updates</h2><p>${lead}</p><ul>${points.map(p => `<li>${p}</li>`).join("")}</ul></div>`;
}

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
  window.scrollTo(0, 0);
}

function paintSync(s) {
  $$("[data-sync]").forEach(p => { p.dataset.state = s.status; $(".t", p).textContent = s.text; p.title = s.detail || s.text; });
  const f = $("#sideFoot"); if (f) f.textContent = s.user ? s.user.email : (s.configured ? "Not signed in" : "Saved on this device");
}

function init() {
  initSheets();
  mountSetup($("#view-setup"));
  soon($("#view-money"), "Money", "money", "Your monthly money in one place, added in a few seconds.", ["Add expenses by typing, speaking or scanning a receipt", "Monthly budgets by category, with what's left until payday", "Bank CSV import for any bank, with category rules", "Charts by category and month. Home setup purchases count here too."]);
  soon($("#view-plan"), "Plan", "plan", "What's coming up and what you're saving for.", ["Bills and subscriptions on a calendar, with monthly and yearly totals", "Savings goals with how much to put aside each month"]);
  mountMore($("#view-more")); bindMore();
  renderSetup();

  store.on(() => { renderSetup(); if (current === "more") renderMore(); });
  onSync((s, ev) => { paintSync(s); if (current === "more") renderMore(); renderSetup(); if (ev === "recovery") openNewPassword(); });
  initSync();

  document.addEventListener("click", e => { if (e.target.closest("[data-action=add]")) { e.preventDefault(); openAdd(); } });
  window.addEventListener("hashchange", route);
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (current === "setup") { renderPlans(); renderCharts(); } }, 120); });
  route();
  if (/[?&]add=1/.test(location.search)) openAdd();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").then(reg => {
      reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) toast("A new version of Koti is ready", { label: "Reload", run: () => location.reload() });
      }); });
    }).catch(() => {});
  }
}
init();
