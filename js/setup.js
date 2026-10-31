// Project view (Home setup and other projects): floor plan when the project has one, progress, budget,
// room lists with swipe actions; also the item sheet and the add-item sheet for projects.
import { store, PRIOS, ZONES, ZONE_ORDER, zoneStats, sortedLists, itemsOf, listOf, todayISO, roomsOf, projectItems, projectSpent, HOME_PROJECT, HOME_PLAN, topLists } from "./data.js";
import { $, $$, esc, eur, eur0, icon, parseMoney, parseDay, fmtDay, openSheet, closeSheet, toast } from "./ui.js";
import { drawFullPlan, miniPlanHTML, drawLine, drawBars } from "./charts.js";
import { sync } from "./sync.js";

const ui = { room: "all", status: "todo", query: "" };
let root = null, lastList = null, pid = HOME_PROJECT;
export const currentProject = () => pid;
export function setProject(id) { if (id !== pid) { pid = id; ui.room = "all"; ui.query = ""; const q = root && $("#suSearch", root); if (q) q.value = ""; } renderSetup(); }
const project = () => listOf(pid) || { id: pid, name: "Project", budget: null, extraSpend: 0, plan: null };
const projLists = () => { const r = roomsOf(pid); return r.length ? r : [project()]; };

export function mountSetup(el) {
  root = el;
  root.innerHTML = `
  <div class="setup">
    <header class="vh"><div><a class="back" href="#expenses">${icon("chev", "ic sm flip")} Expenses</a><h1 id="suTitle">Home setup</h1><div class="sub" id="suSub"></div></div><div class="hbtns"><button type="button" class="hbtn" data-proj-settings aria-label="Project settings">${icon("more", "ic")}</button></div></header>
    <div id="suBanner"></div>
    <div class="setup-top">
      <div>
        <div class="mplan" id="miniPlan" role="group" aria-label="Rooms"></div>
        <section class="card plan-full" aria-labelledby="planTitle">
          <div class="card-head"><div><h2 id="planTitle">Rooms</h2><div class="hint">Fill level shows how much of each room's list is bought. Click a room to show its lists.</div></div></div>
          <div class="chart" id="planWrap"><svg id="plan" viewBox="50 5 640 945" role="group" aria-label="Floor plan with progress per room"></svg><div class="tip" id="planTip"></div></div>
        </section>
      </div>
      <div class="side-col">
        <div class="stats">
          <div class="stat"><div class="k">Bought</div><div class="v" id="stPct">0%</div><div class="meter"><i id="stPctBar"></i></div><div class="s" id="stPctSub"></div></div>
          <div class="stat"><div class="k" style="display:flex;justify-content:space-between;gap:6px">Budget<span id="stChip"></span></div><div class="v" id="stSpent">€0</div><div class="meter"><i id="stBudBar"></i></div><div class="s" id="stBudSub"></div></div>
        </div>
        <section class="card desk-only"><h2 style="margin-bottom:12px">By priority</h2><div class="prio" data-prio></div></section>
        <section class="card desk-only"><div class="card-head"><div><h2>Spending by room</h2><div class="hint">Prices of bought items</div></div></div><div class="chart" data-bars><svg role="img"></svg><div class="tip"></div></div></section>
      </div>
    </div>
    <section class="card desk-only" style="margin-top:16px"><div class="card-head"><div><h2>Spending over time</h2><div class="hint" data-linehint></div></div><div class="key"><span><i class="ln" style="background:var(--spruce)"></i>Spent</span><span><i class="ln" style="background:var(--amber)"></i>Budget</span></div></div><div class="chart" data-line><svg role="img" aria-label="Running total of spending against budget"></svg><div class="tip"></div></div></section>

    <div class="controls">
      <div class="seg" role="group" aria-label="Show items" id="suSeg"><button type="button" data-v="todo">To buy</button><button type="button" data-v="done">Bought</button><button type="button" data-v="all">All</button></div>
      <div class="chips" id="suChips" role="group" aria-label="Filter by room"></div>
      <label class="search">${icon("search", "ic sm")}<span class="sr">Search items</span><input id="suSearch" type="search" placeholder="Search items…" autocomplete="off" enterkeyhint="search"></label>
    </div>
    <div class="lists" id="suLists"></div>
    <p class="legend"><span class="pdot Essential"></span>Essential <span class="pdot Soon"></span>Soon <span class="pdot Later"></span>Later</p><p class="note">Tap an item to edit it. On a phone, swipe left for price or delete.</p>

    <div class="phone-insights">
      <div class="gh"><h2>Spending</h2></div>
      <section class="card"><div class="card-head"><div><h2>Over time</h2><div class="hint" data-linehint></div></div></div><div class="chart" data-line><svg role="img" aria-label="Running total of spending against budget"></svg><div class="tip"></div></div></section>
      <section class="card" style="margin-top:10px"><h2 style="margin-bottom:6px">By room</h2><div class="chart" data-bars><svg role="img"></svg><div class="tip"></div></div></section>
      <section class="card" style="margin-top:10px"><h2 style="margin-bottom:12px">By priority</h2><div class="prio" data-prio></div></section>
    </div>
  </div>`;

  $("#suSeg", root).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; ui.status = b.dataset.v; renderLists(); });
  $("#suSearch", root).addEventListener("input", e => { ui.query = e.target.value; renderLists(); });
  $("#suChips", root).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; pickRoom(b.dataset.zone, false); });
  $("#miniPlan", root).addEventListener("click", e => { const b = e.target.closest("[data-zone]"); if (b) pickRoom(b.dataset.zone, true); });
  bindListEvents($("#suLists", root));
  root.addEventListener("click", e => { if (e.target.closest("[data-proj-settings]")) import("./lists.js").then(m => m.openListSettings(listOf(pid))); });
}

function pickRoom(code, fromPlan) {
  ui.room = ui.room === code && fromPlan ? "all" : code;
  renderPlans(); renderLists();
  if (fromPlan && ui.room !== "all") $(".controls", root).scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Render ---------- */
export function renderSetup() {
  if (!root) return;
  const P = project(), hasPlan = P.plan === HOME_PLAN;
  root.classList.toggle("noplan", !hasPlan);
  $("#suTitle", root).textContent = P.name;
  const items = projectItems(pid), done = items.filter(i => i.done).length, pct = items.length ? Math.round(done / items.length * 100) : 0;
  const ess = items.filter(i => !i.done && i.priority === "Essential").length;
  $("#suSub", root).textContent = `${pct}% bought · ${ess} essential${ess === 1 ? "" : "s"} left`;
  $("#stPct", root).textContent = pct + "%"; $("#stPctBar", root).style.width = pct + "%";
  $("#stPctSub", root).textContent = `${done} of ${items.length} items`;
  const spent = projectSpent(pid), b = Number(P.budget) || 0, ratio = b > 0 ? spent / b : 0;
  $("#stSpent", root).textContent = eur0(spent);
  const bar = $("#stBudBar", root); bar.style.width = Math.min(100, ratio * 100) + "%";
  bar.style.background = ratio > 1 ? "var(--crit)" : ratio >= .85 ? "var(--amber)" : "var(--spruce)";
  $("#stBudSub", root).textContent = b > 0 ? (b - spent >= 0 ? `${eur(b - spent)} left of ${eur0(b)}` : `${eur(spent - b)} over ${eur0(b)}`) : "Set a budget with ⋯ at the top";
  $("#stChip", root).innerHTML = b > 0 ? (ratio > 1 ? `<span class="chip crit">Over</span>` : ratio >= .85 ? `<span class="chip warn">${Math.round(ratio * 100)}%</span>` : `<span class="chip ok">${Math.round(ratio * 100)}%</span>`) : "";
  $$("[data-prio]", root).forEach(box => { box.innerHTML = PRIOS.map(p => { const its = items.filter(i => i.priority === p), d = its.filter(i => i.done).length;
    return `<div class="prio-row"><span class="pill ${p}">${p}</span><div class="meter" role="img" aria-label="${p}: ${d} of ${its.length} bought"><i style="width:${its.length ? d / its.length * 100 : 0}%"></i></div><span class="num">${d}/${its.length}</span></div>`; }).join(""); });
  renderBanner(); renderPlans(); renderLists(); renderCharts();
}

function renderBanner() {
  const B = $("#suBanner", root);
  if (sync.configured && !sync.user) B.innerHTML = `<div class="banner"><div class="t"><b>Sync your phone and computer</b><small>Sign in once on each device. Your list stays on this device until then.</small></div><a class="go" href="#more" data-open="auth">Sign in</a></div>`;
  else B.innerHTML = "";
}

export function renderPlans() {
  if (!root) return;
  if (project().plan !== HOME_PLAN) { $("#suChips", root).innerHTML = ""; $$("#suSeg button", root).forEach(b => b.setAttribute("aria-pressed", b.dataset.v === ui.status)); return; }
  $("#miniPlan", root).innerHTML = miniPlanHTML(ui.room);
  if (getComputedStyle($(".plan-full", root)).display !== "none") drawFullPlan($("#plan", root), $("#planWrap", root), $("#planTip", root), ui.room, code => pickRoom(code, true));
  const st = zoneStats(pid);
  $("#suChips", root).innerHTML = [["all", "All rooms"], ...ZONE_ORDER.filter(k => st[k].total).map(k => [k, ZONES[k].label])]
    .map(([k, l]) => `<button type="button" class="fchip" data-zone="${k}" aria-pressed="${ui.room === k}">${esc(l)}</button>`).join("");
  $$("#suSeg button", root).forEach(b => b.setAttribute("aria-pressed", b.dataset.v === ui.status));
}

export function renderCharts() {
  if (!root) return;
  $$("[data-line]", root).forEach(w => { if (w.offsetParent !== null) drawLine($("svg", w), w, $(".tip", w), w.closest("section").querySelector("[data-linehint]"), pid); });
  $$("[data-bars]", root).forEach(w => { if (w.offsetParent !== null) drawBars($("svg", w), w, $(".tip", w), pid); });
}

function renderLists() {
  $$("#suSeg button", root).forEach(b => b.setAttribute("aria-pressed", b.dataset.v === ui.status));
  const box = $("#suLists", root), q = ui.query.trim().toLowerCase();
  let html = "";
  projLists().forEach(l => {
    if (ui.room !== "all" && l.room !== ui.room) return;
    const all = itemsOf(l.id), done = all.filter(i => i.done).length;
    const shown = all.filter(i => (!q || i.name.toLowerCase().includes(q)) && (ui.status === "all" || (ui.status === "done" ? i.done : !i.done)));
    if (!shown.length && (q || ui.status !== "all")) return;
    html += `<div class="lgroup"><div class="gh"><h3>${esc(l.name)}</h3><span class="num">${esc(ZONES[l.room].label)} · ${done}/${all.length}</span></div><div class="grp">`;
    if (!all.length) html += `<div class="row"><span class="rt muted"><small>No items yet. Use + to add one.</small></span></div>`;
    shown.forEach(i => {
      const sub = i.done ? [i.price != null ? eur(i.price) : "Add price", i.boughtAt ? fmtDay(parseDay(i.boughtAt)) : ""].filter(Boolean).join(" · ") : "";
      html += `<div class="swipe" data-id="${esc(i.id)}"><div class="acts"><button type="button" class="a-price" tabindex="-1">Price</button><button type="button" class="a-del" tabindex="-1">Delete</button></div>
        <div class="row item${i.done ? " done" : ""}"><button type="button" class="cb" role="checkbox" aria-checked="${i.done}" aria-label="${esc(i.name)} bought">${icon("check", "ic xs")}</button>
        <button type="button" class="item-name" aria-label="${esc(i.name)}, ${i.priority}${i.done ? ", bought" : ""}. Edit"><span>${esc(i.name)}</span>${sub ? `<small class="num">${esc(sub)}</small>` : ""}</button>
        <span class="pdot ${i.priority}" title="${i.priority}"></span></div></div>`;
    });
    html += `</div></div>`;
  });
  if (!html) html = `<div class="empty">${ui.status === "todo" && !q ? "Everything here is bought. Switch to All to see the full list." : "No items match. Try another room or search."}</div>`;
  box.innerHTML = html;
}

/* ---------- List interactions: tick, open, swipe ---------- */
function bindListEvents(box) {
  let drag = null, open = null;
  const close = sw => { if (sw) { $(".row", sw).style.transform = ""; if (open === sw) open = null; } };
  box.addEventListener("click", e => {
    const sw = e.target.closest(".swipe"); if (!sw) return;
    const id = sw.dataset.id, it = store.model.items.find(i => i.id === id); if (!it) return;
    if (e.target.closest(".a-del")) { close(sw); removeItem(it); return; }
    if (e.target.closest(".a-price")) { close(sw); openItem(it, { focusPrice: true }); return; }
    if (sw.dataset.swiped) { delete sw.dataset.swiped; return; }
    if (open && open !== sw) { close(open); return; }
    if (open === sw) { close(sw); return; }
    if (e.target.closest(".cb")) { store.updateItem(id, { done: !it.done }); if (navigator.vibrate) navigator.vibrate(8); return; }
    if (e.target.closest(".item-name")) openItem(it);
  });
  box.addEventListener("pointerdown", e => {
    const sw = e.target.closest(".swipe"); if (!sw || e.target.closest(".acts") || e.pointerType === "mouse") return;
    drag = { sw, x: e.clientX, y: e.clientY, dx: 0, base: open === sw ? -152 : 0, moving: false };
  });
  box.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moving) { if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } if (Math.abs(dx) < 8) return; drag.moving = true; drag.sw.classList.add("dragging"); if (open && open !== drag.sw) close(open); }
    drag.dx = dx; $(".row", drag.sw).style.transform = `translateX(${Math.min(0, Math.max(-170, drag.base + dx))}px)`;
  });
  const end = () => {
    if (!drag) return; const { sw, moving, dx, base } = drag; drag = null; sw.classList.remove("dragging");
    if (!moving) return;
    sw.dataset.swiped = "1"; setTimeout(() => delete sw.dataset.swiped, 350);
    if (base + dx < -60) { $(".row", sw).style.transform = "translateX(-152px)"; open = sw; } else close(sw);
  };
  box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
}

function removeItem(it) {
  const copy = { ...it }; store.deleteItem(it.id);
  toast(`Deleted "${it.name}"`, { label: "Undo", run: () => store.restoreItem(copy) });
}

/* ---------- Item sheet ---------- */
/* Lists an item can live in: shopping lists, and each project's rooms (or the project itself if it has none). */
function listOptions(sel, onlyProject = null) {
  const out = [];
  topLists().forEach(l => { if (l.kind === "project") { if (onlyProject && l.id !== onlyProject) return; const r = roomsOf(l.id); (r.length ? r : [l]).forEach(x => out.push([x.id, r.length ? `${l.name} › ${x.name}` : l.name])); } else if (!onlyProject) out.push([l.id, l.name]); });
  return out.map(([id, n]) => `<option value="${esc(id)}"${id === sel ? " selected" : ""}>${esc(n)}</option>`).join("");
}
function prioSeg(sel) { return `<div class="seg" role="radiogroup" aria-label="Priority">${PRIOS.map(p => `<button type="button" role="radio" data-p="${p}" aria-pressed="${p === sel}" aria-checked="${p === sel}">${p}</button>`).join("")}</div>`; }
function bindPrio(B) { $(".seg", B).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $$(".seg button", B).forEach(x => { x.setAttribute("aria-pressed", x === b); x.setAttribute("aria-checked", x === b); }); }); }
const chosenPrio = B => ($(".seg [aria-pressed='true']", B) || {}).dataset?.p || "Soon";

export function openItem(it, { focusPrice = false } = {}) {
  openSheet({
    title: "Item", right: "Done",
    body: B => {
      B.innerHTML = `
        <div class="field"><label for="itName">Name</label><input class="inp" id="itName" value="${esc(it.name)}" autocomplete="off" maxlength="200"></div>
        <div class="field"><span class="flabel">Priority</span>${prioSeg(it.priority)}</div>
        <div class="grp">
          <label class="row"><span class="rt">Bought</span><input type="checkbox" id="itDone" ${it.done ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--spruce)"></label>
          <label class="row"><span class="rt">Amount</span><input class="inl" id="itQty" inputmode="decimal" placeholder="1" value="${it.qty != null ? String(it.qty).replace(".", ",") : ""}" autocomplete="off"></label>
          <label class="row"><span class="rt">Note</span><input class="inl" id="itNote" placeholder="Brand, size…" value="${esc(it.note || "")}" maxlength="300" autocomplete="off" style="max-width:60%"></label>
          <label class="row"><span class="rt">Price</span><input class="inl" id="itPrice" inputmode="decimal" placeholder="€0.00" value="${it.price != null ? it.price.toFixed(2) : ""}" autocomplete="off"></label>
          <label class="row"><span class="rt">Bought on</span><input class="inl" id="itDate" type="date" value="${it.boughtAt || ""}"></label>
          <label class="row"><span class="rt">List</span><select class="inl" id="itList">${listOptions(it.listId)}</select></label>
        </div>
        <p class="msg" id="itMsg" aria-live="polite"></p>
        <button type="button" class="btn danger" id="itDel">${icon("trash", "ic sm")} Delete item</button>`;
      bindPrio(B);
      $("#itDel", B).onclick = () => { closeSheet(); removeItem(it); };
      if (focusPrice) setTimeout(() => $("#itPrice", B).focus(), 80);
    },
    onRight: B => {
      const name = $("#itName", B).value.trim(); if (!name) { $("#itMsg", B).dataset.state = "error"; $("#itMsg", B).textContent = "Give the item a name."; return; }
      const price = parseMoney($("#itPrice", B).value);
      if (Number.isNaN(price)) { $("#itMsg", B).dataset.state = "error"; $("#itMsg", B).textContent = "Type the price as a number, like 24,90."; return; }
      let done = $("#itDone", B).checked; if (price != null && price > 0 && !it.done && !done) done = true;
      const date = $("#itDate", B).value || null;
      const q = parseMoney($("#itQty", B).value);
      store.updateItem(it.id, { name, priority: chosenPrio(B), price, qty: q && !Number.isNaN(q) ? q : null, note: $("#itNote", B).value.trim() || null, listId: $("#itList", B).value, done, boughtAt: done ? (date || todayISO()) : null });
      closeSheet();
    },
  });
}

/* ---------- Add sheet ---------- */
export function openAdd() {
  const lists = projLists();
  if (!lists.length) { toast("Add a list first in More → Lists and rooms"); location.hash = "#more"; return; }
  const def = (lastList && lists.some(l => l.id === lastList)) ? lastList : (ui.room !== "all" ? (lists.find(l => l.room === ui.room) || lists[0]).id : lists[0].id);
  openSheet({
    title: "Add item", right: "Add",
    body: B => {
      B.innerHTML = `
        <div class="seg" aria-label="What to add"><button type="button" data-switch="expense">Expense</button><button type="button" aria-pressed="true">Checklist item</button></div>
        <div class="field"><label for="adName">Item</label><input class="inp" id="adName" placeholder="e.g. Shower curtain…" autocomplete="off" maxlength="200" enterkeyhint="done" autofocus></div>
        <div class="field"><label for="adList">List</label><select class="inp" id="adList">${listOptions(def, pid)}</select></div>
        <div class="field"><span class="flabel">Priority</span>${prioSeg("Soon")}</div>
        <p class="msg" id="adMsg" aria-live="polite"></p>
        <p class="note">Bought it already? Tick it in the list and add the price: it counts in Money as Home setup.</p>`;
      bindPrio(B);
      $("[data-switch=expense]", B).onclick = () => { closeSheet(); setTimeout(() => import("./money.js").then(m => m.openExpense()), 260); };
      $("#adName", B).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#sheet .sh-head .r").click(); } });
    },
    onRight: B => {
      const name = $("#adName", B).value.trim(); if (!name) { $("#adMsg", B).dataset.state = "error"; $("#adMsg", B).textContent = "Type what you need to buy."; return; }
      const listId = $("#adList", B).value; lastList = listId;
      store.addItem(listId, name, chosenPrio(B));
      if (ui.status === "done") ui.status = "todo";
      closeSheet(); toast(`Added to ${listOf(listId).name}`);
    },
  });
}
