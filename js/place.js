// Home: the flat itself. The floor plan fills as you buy things, then your lists.
import { store, topLists, itemsOf, projectItems, projectSpent, HOME_PLAN } from "./data.js";
import { esc, eur0 } from "./ui.js";
import { miniPlanHTML } from "./charts.js";
import { openNewList } from "./lists.js";

let root = null;
export function mountPlace(el) {
  root = el;
  root.addEventListener("click", e => {
    if (e.target.closest("[data-new-list]")) { openNewList(); return; }
    const z = e.target.closest("[data-zone]"); if (z) { const pr = topLists().find(l => l.kind === "project" && l.plan === HOME_PLAN); if (pr) location.hash = "#list/" + encodeURIComponent(pr.id); }
  });
}

export function renderPlace() {
  if (!root) return;
  const lists = topLists(), projects = lists.filter(l => l.kind === "project"), shops = lists.filter(l => l.kind !== "project");
  const flat = projects.find(l => l.plan === HOME_PLAN);
  let top = "";
  if (flat) {
    const its = projectItems(flat.id), done = its.filter(i => i.done).length, pct = its.length ? done / its.length : 0, b = Number(flat.budget) || 0, spent = projectSpent(flat.id);
    const how = !its.length ? "Add what your new flat needs, room by room." : pct >= 1 ? "Everything on the list is bought." : pct >= .66 ? "Your flat is nearly kitted out." : pct >= .33 ? "Your flat is about half kitted out." : "Your flat is just getting started.";
    const money = b ? (spent > b ? ` You're ${eur0(spent - b)} over the ${eur0(b)}.` : ` ${eur0(b - spent)} of the ${eur0(b)} is left.`) : "";
    top = `<p class="psent">${esc(how + money)}</p>
      <div class="mplan pplan" role="group" aria-label="Rooms in ${esc(flat.name)}">${miniPlanHTML(null)}</div>
      <p class="mhint">The blue fills up as you buy. Tap a room for what's still missing.</p>`;
  }
  const row = l => {
    if (l.kind === "project") { const its = projectItems(l.id), d = its.filter(i => i.done).length;
      return `<a class="prow" href="#list/${encodeURIComponent(l.id)}"><span><b>${esc(l.name)}</b><small>${its.length ? `${d} of ${its.length} bought` : "Nothing on it yet"}</small></span><span class="pn">${its.length ? Math.round(d / its.length * 100) + "%" : ""}</span></a>`; }
    const left = itemsOf(l.id).filter(i => !i.done).length;
    return `<a class="prow" href="#list/${encodeURIComponent(l.id)}"><span><b>${esc(l.name)}</b><small>${left ? `${left} left` : itemsOf(l.id).length ? "All done" : "Empty"}</small></span><span class="pn">${left || ""}</span></a>`;
  };
  root.innerHTML = `${top}
    <div class="mhead"><h2>Lists</h2><button type="button" class="tlink" data-new-list>New list</button></div>
    <div class="prows">${shops.map(row).join("") || `<p class="msub">No lists yet. Type something in the box below to start one.</p>`}</div>
    ${projects.filter(l => l !== flat).length || (flat && projects.length) ? `<div class="mhead"><h2>Projects</h2></div><div class="prows">${projects.map(row).join("")}</div>` : ""}`;
}
