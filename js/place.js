// Projects: your home (with its floor plan) and any other projects, each as a card with what's spent and bought,
// then your shopping lists. Reached from the month screen.
import { topLists, itemsOf, projectItems, projectSpent, HOME_PLAN } from "./data.js";
import { esc, eur0, icon } from "./ui.js";
import { miniPlanHTML } from "./charts.js";
import { openNewList } from "./lists.js";
import { monthName } from "./period.js";

let root = null;
export function mountPlace(el) {
  root = el;
  root.addEventListener("click", e => {
    if (e.target.closest("[data-new-list]")) { openNewList(); return; }
    const z = e.target.closest("[data-zone]"); if (z) { const pr = topLists().find(l => l.kind === "project" && l.plan === HOME_PLAN); if (pr) location.hash = "#list/" + encodeURIComponent(pr.id); }
  });
}

function card(l, flat) {
  const its = projectItems(l.id), done = its.filter(i => i.done).length, b = Number(l.budget) || 0, spent = projectSpent(l.id);
  const money = b ? `<b>${eur0(spent)}</b> of ${eur0(b)}` : spent ? `<b>${eur0(spent)}</b> spent` : "";
  const bar = b ? Math.min(100, spent / b * 100) : its.length ? done / its.length * 100 : 0;
  return `<div class="pcard${flat ? " flat" : ""}">
    <a class="pc-top" href="#list/${encodeURIComponent(l.id)}">
      <span class="pc-t"><b>${esc(l.name)}</b>${!flat && !money && !its.length ? `<small>Nothing on it yet</small>` : ""}</span>${icon("chev", "ic sm")}</a>
    ${flat ? `<div class="mplan pplan pc-plan" role="group" aria-label="Rooms in ${esc(l.name)}">${miniPlanHTML(null)}</div>` : ""}
    ${money || its.length ? `<a class="pc-num" href="#list/${encodeURIComponent(l.id)}"><span>${money}</span><span class="pc-m">${its.length ? `${done} of ${its.length} bought` : ""}</span></a>
    <span class="pc-bar" aria-hidden="true"><i class="${b && spent > b ? "over" : ""}" style="width:${bar}%"></i></span>` : ""}
  </div>`;
}

export function renderPlace() {
  if (!root) return;
  const lists = topLists(), projects = lists.filter(l => l.kind === "project"), shops = lists.filter(l => l.kind !== "project");
  const flat = projects.find(l => l.plan === HOME_PLAN), others = projects.filter(l => l !== flat);
  const row = l => { const all = itemsOf(l.id), left = all.filter(i => !i.done).length;
    return `<a class="prow" href="#list/${encodeURIComponent(l.id)}"><span><b>${esc(l.name)}</b><small>${left ? `${left} to buy` : all.length ? "All bought" : "Empty"}</small></span><span class="pn">${left || ""}</span></a>`; };
  root.innerHTML = `<header class="vh"><div><a class="back" href="#month">${icon("chev", "ic sm flip")} ${esc(monthName())}</a><h1>Projects</h1></div></header>
    <div class="pcards">${flat ? card(flat, true) : ""}${others.map(l => card(l, false)).join("")}</div>
    <button type="button" class="tlink pnew" data-new-list>New project or list</button>
    <div class="mhead"><h2>Lists</h2></div>
    <div class="prows">${shops.map(row).join("") || `<p class="msub">No lists yet. Type in the box below to start one.</p>`}</div>`;
}
