// Expenses screen (spending, bills, list cards), an opened list, sending a list, new list and list settings, and the + menu.
import { store, listCategory, topLists, roomsOf, itemsOf, listOf, projectItems, projectSpent, todayISO, HOME_PLAN, HOME_PROJECT } from "./data.js";
import { $, $$, esc, eur, eur0, icon, parseMoney, moneyField, parseDay, fmtDay, openSheet, closeSheet, toast } from "./ui.js";
import { periodFor, totals, periodLabel, openExpense, catName, setSpendingFilter } from "./money.js";
import { occurrences, nextDue, perYear } from "./plan.js";
import { openScan } from "./scan.js";

const est = items => items.reduce((a, i) => a + (i.price > 0 ? i.price * (i.qty || 1) : 0), 0);
const qtyText = q => (q && q !== 1 ? `${String(q).replace(".", ",")} ×` : "");
const MINI = { PARVEKE: [0, 0, 100, 17], OH: [0, 17, 58, 45], MH: [58, 17, 42, 45], K: [0, 62, 28, 38], ET: [28, 62, 30, 38], KPH: [58, 62, 42, 38] };

/* ---------- Expenses screen ---------- */
let eroot = null;
export function mountExpenses(elm) {
  eroot = elm;
  eroot.innerHTML = `<header class="vh"><div><h1>Expenses</h1><div class="sub" id="exSub"></div></div><a class="sync" href="#settings" data-sync><span class="dot"></span><span class="t"></span></a></header>
    <div class="ex-top"><a class="card link-card" href="#spending" id="exSpend"></a><a class="card link-card" href="#bills" id="exBills"></a></div>
    <div class="gh"><h2>Lists</h2><button type="button" class="link" data-new-list>New list</button></div>
    <div class="lgrid" id="exLists"></div>`;
  eroot.addEventListener("click", e => { const cf = e.target.closest("[data-cat-filter]"); if (cf) setSpendingFilter(cf.dataset.catFilter); });
  eroot.addEventListener("click", e => { if (e.target.closest("[data-new-list]")) { e.preventDefault(); openNewList(); } });
}
export function renderExpenses() {
  if (!eroot) return;
  const p = periodFor(new Date()), T = totals(p), today = todayISO();
  const n = T.tx.filter(t => t.kind !== "income").length, rc = T.tx.filter(t => t.receiptPath).length;
  $("#exSub", eroot).textContent = periodLabel(p);
  $("#exSpend", eroot).innerHTML = `<div class="card-head" style="margin:0"><span class="k">Spent in ${p.start.toLocaleDateString("en-GB", { month: "long" })}</span><span class="go">All spending ${icon("chev", "ic xs")}</span></div>
    <b class="big" style="font-size:34px">${eur0(T.total)}</b><span class="s">${n} expense${n === 1 ? "" : "s"}${rc ? ` · ${rc} with receipts` : ""}${T.projects ? ` · ${eur0(T.projects)} on projects` : ""}</span>
    ${Object.keys(T.byCat).length ? `<span class="catchips">${Object.entries(T.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `<span class="cchip" data-cat-filter="${esc(k)}">${esc(catName(k))} <b>${eur0(v)}</b></span>`).join("")}</span>` : ""}`;
  const occ = occurrences(p), paid = occ.filter(o => o.paid).length, monthly = store.model.bills.filter(b => b.active).reduce((a, b) => a + perYear(b), 0) / 12;
  const next = occ.find(o => !o.paid && o.due >= today), late = occ.filter(o => !o.paid && o.due < today).length;
  const days = Math.round((p.end - p.start) / 864e5) + 1;
  const strip = Array.from({ length: days }, (_, k) => { const d = new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate() + k), s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; const o = occ.filter(x => x.due === s);
    return `<i class="${!o.length ? "" : o.every(x => x.paid) ? "p" : s < today ? "l" : "d"}${s === today ? " t" : ""}"></i>`; }).join("");
  $("#exBills", eroot).innerHTML = store.model.bills.length ? `<div class="card-head" style="margin:0"><span class="k">Bills · ${eur0(monthly)} a month</span><span class="go">${late ? `<span class="chip crit">${late} overdue</span>` : ""} ${icon("chev", "ic xs")}</span></div>
    <b style="font:700 20px var(--display)">${occ.length ? `${paid} of ${occ.length} paid` : "None due this month"}</b><span class="s">${next ? `Next: ${esc(next.bill.name)} ${eur(next.amount)} · ${fmtDay(parseDay(next.due))}` : occ.length ? "All paid this month" : ""}</span>
    <span class="strip" aria-hidden="true">${strip}</span>`
    : `<div class="card-head" style="margin:0"><span class="k">Bills</span><span class="go">${icon("chev", "ic xs")}</span></div><b style="font:700 18px var(--display)">Add your bills</b><span class="s">Rent, electricity, phone, subscriptions</span>`;

  const lists = topLists();
  $("#exLists", eroot).innerHTML = lists.map(l => l.kind === "project" ? projectCard(l) : listCard(l, T)).join("") + `<button type="button" class="lcard new" data-new-list>${icon("plus", "ic sm")}<span>New list</span></button>`;
}
function listCard(l, T) {
  const its = itemsOf(l.id), todo = its.filter(i => !i.done), e = est(todo), lc = listCategory(l), spent = lc && T ? T.byCat[lc.id] || 0 : 0;
  return `<a class="lcard" href="#list/${encodeURIComponent(l.id)}"><b>${esc(l.name)}</b>
    <span class="s">${its.length ? (todo.length ? `${todo.length} to buy${e ? ` · about ${eur0(e)}` : ""}` : "All bought") : "Empty"}</span>
    ${lc ? `<span class="lc-cat">${esc(lc.name)}: ${eur0(spent)} this month${lc.budget ? ` of ${eur0(lc.budget)}` : ""}</span>` : ""}
    ${todo.length ? `<span class="peek">${esc(todo.slice(0, 3).map(i => i.name).join(" · "))}${todo.length > 3 ? ` · +${todo.length - 3}` : ""}</span>` : ""}
    <span class="meter sm"><i style="width:${its.length ? (its.length - todo.length) / its.length * 100 : 0}%"></i></span></a>`;
}
function projectCard(pr) {
  const its = projectItems(pr.id), done = its.filter(i => i.done).length, pct = its.length ? Math.round(done / its.length * 100) : 0, spent = projectSpent(pr.id), b = Number(pr.budget) || 0;
  return `<a class="lcard proj" href="#list/${encodeURIComponent(pr.id)}"><span class="k">Project</span>${pr.plan === HOME_PLAN ? miniPlan(pr.id) : `<span class="pico">${icon("list")}</span>`}
    <b>${esc(pr.name)}</b><span class="s">${pct}% bought · ${eur0(spent)}${b ? ` of ${eur0(b)}` : ""}</span>
    <span class="meter sm"><i style="width:${b ? Math.min(100, spent / b * 100) : pct}%;background:${b && spent > b ? "var(--crit)" : "var(--amber)"}"></i></span></a>`;
}
function miniPlan(pid) {
  const rooms = roomsOf(pid), by = {};
  rooms.forEach(r => { const its = itemsOf(r.id); by[r.room] = by[r.room] || { t: 0, d: 0 }; by[r.room].t += its.length; by[r.room].d += its.filter(i => i.done).length; });
  return `<span class="mp" aria-hidden="true">${Object.entries(MINI).map(([k, [x, y, w, h]]) => { const s = by[k]; return `<i style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"${s ? "" : ` class="nl"`}>${s && s.t ? `<u style="height:${s.d / s.t * 100}%"></u>` : ""}</i>`; }).join("")}</span>`;
}

/* ---------- An opened list ---------- */
let lroot = null, curId = null, showDone = false;
export const currentList = () => curId;
export function mountList(elm) {
  lroot = elm;
  lroot.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-share]")) { shareList(curId); return; }
    if (t.closest("[data-list-settings]")) { openListSettings(listOf(curId)); return; }
    if (t.closest("[data-add-items]")) { addFromInput(); return; }
    if (t.closest("[data-clear]")) { clearBought(curId); return; }
    if (t.closest("[data-toggle-done]")) { showDone = !showDone; renderList(); return; }
    const sug = t.closest("[data-sug]"); if (sug) { store.addItem(curId, sug.dataset.sug, "Soon", lastOf(curId, sug.dataset.sug)); forget(curId, sug.dataset.sug); return; }
    const row = t.closest("[data-item]"); if (!row) return;
    const it = store.model.items.find(i => i.id === row.dataset.item); if (!it) return;
    if (t.closest(".cb")) { store.updateItem(it.id, { done: !it.done }); if (navigator.vibrate) navigator.vibrate(8); return; }
    import("./setup.js").then(m => m.openItem(it));
  });
  lroot.addEventListener("keydown", e => { if (e.target.id === "liAdd" && e.key === "Enter") { e.preventDefault(); addFromInput(); } });
}
export function openList(id) { if (curId !== id) showDone = false; curId = id; renderList(); }
export function renderList() {
  if (!lroot || !curId) return;
  const l = listOf(curId);
  if (!l) { lroot.innerHTML = `<header class="vh"><div><a class="back" href="#expenses">${icon("chev", "ic sm flip")} Expenses</a><h1>List not found</h1></div></header><div class="empty">This list was deleted.</div>`; return; }
  const parent = l.parentId ? listOf(l.parentId) : null, its = itemsOf(l.id), todo = its.filter(i => !i.done), done = its.filter(i => i.done), e = est(todo);
  const keepVal = $("#liAdd", lroot) ? $("#liAdd", lroot).value : "", hadFocus = document.activeElement && document.activeElement.id === "liAdd";
  const row = i => `<div class="row item${i.done ? " done" : ""}" data-item="${esc(i.id)}"><button type="button" class="cb" role="checkbox" aria-checked="${i.done}" aria-label="${esc(i.name)} bought">${icon("check", "ic xs")}</button>
    <button type="button" class="item-name" aria-label="${esc(i.name)}. Edit"><span>${esc(i.name)}</span>${[qtyText(i.qty), i.price > 0 ? eur(i.price) : "", i.note].filter(Boolean).length ? `<small class="num">${esc([qtyText(i.qty), i.price > 0 ? eur(i.price) : "", i.note].filter(Boolean).join(" · "))}</small>` : ""}</button>
    ${l.kind === "room" ? `<span class="pdot ${i.priority}" title="${i.priority}"></span>` : ""}</div>`;
  const sugs = suggestions(l.id).filter(n => !its.some(i => i.name.toLowerCase() === n.toLowerCase())).slice(0, 8);
  lroot.innerHTML = `
    <header class="vh"><div><a class="back" href="#${parent ? "list/" + encodeURIComponent(parent.id) : "expenses"}">${icon("chev", "ic sm flip")} ${esc(parent ? parent.name : "Expenses")}</a><h1>${esc(l.name)}</h1><div class="sub">${todo.length ? `${todo.length} to buy${e ? ` · about ${eur(e)}` : ""}` : its.length ? "Everything's bought" : "Empty list"}</div></div>
      <div class="hbtns"><button type="button" class="hbtn" data-scan aria-label="Scan a receipt for this list">${icon("cam", "ic")}</button><button type="button" class="hbtn" data-share aria-label="Send this list">${icon("share", "ic")}</button><button type="button" class="hbtn" data-list-settings aria-label="List settings">${icon("more", "ic")}</button></div></header>
    <div class="add-line"><label for="liAdd" class="sr">Add items</label><input id="liAdd" placeholder="Add items: milk, eggs, 2 × yogurt" autocomplete="off" enterkeyhint="done" value="${esc(keepVal)}"><button type="button" class="add-btn" data-add-items aria-label="Add">${icon("plus", "ic sm")}</button></div>
    ${sugs.length ? `<div class="chips sugs" aria-label="Add again">${sugs.map(n => `<button type="button" class="fchip" data-sug="${esc(n)}">+ ${esc(n)}</button>`).join("")}</div>` : ""}
    ${todo.length ? `<div class="gh"><h2>To buy</h2><span class="num">${todo.length}</span></div><div class="grp">${todo.map(row).join("")}</div>` : its.length ? "" : `<div class="empty">Nothing here yet. Type items above, separated by commas.</div>`}
    ${done.length ? `<div class="gh"><button type="button" class="link" data-toggle-done aria-expanded="${showDone}">Bought · ${done.length} ${showDone ? "▾" : "▸"}</button>${l.kind === "shopping" ? `<button type="button" class="link" data-clear>Clear bought</button>` : ""}</div>${showDone ? `<div class="grp">${done.map(row).join("")}</div>` : ""}` : ""}
    <p class="note">Tap an item to change its amount, price or note.${l.kind === "shopping" ? " Send the list with the share button at the top." : ""}</p>`;
  if (hadFocus) { const inp = $("#liAdd", lroot); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

/* "milk, eggs, 2 × yogurt" → three items; quantities like "2 x", "2×", "x2", "3 kpl". */
export function parseItems(text) {
  return String(text).split(/[,\n;]+/).map(s => s.trim()).filter(Boolean).map(s => {
    let m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×|kpl|pcs|pc)?\s+(.+)$/i), qty = null, name = s;
    if (m) { qty = Number(m[1].replace(",", ".")); name = m[2]; }
    else if ((m = s.match(/^(.+?)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)$/i))) { name = m[1]; qty = Number(m[2].replace(",", ".")); }
    name = name.replace(/^(x|×)\s+/i, "").trim(); name = name.charAt(0).toUpperCase() + name.slice(1);
    return { name: name.slice(0, 200), qty: qty && qty > 0 ? qty : null };
  }).filter(x => x.name);
}
function addFromInput() {
  const inp = $("#liAdd", lroot); if (!inp) return;
  const parsed = parseItems(inp.value); if (!parsed.length) { inp.focus(); return; }
  inp.value = "";
  parsed.forEach(p => { store.addItem(curId, p.name, "Soon", { qty: p.qty, ...lastOf(curId, p.name, true) }); forget(curId, p.name); });
  toast(parsed.length === 1 ? `Added ${parsed[0].name}` : `Added ${parsed.length} items`);
  setTimeout(() => { const i = $("#liAdd", lroot); if (i) i.focus(); }, 30);
}

/* Remember cleared items (name, quantity, last price) so they can be added again with one tap. */
const MEM = "koti.listMemory";
const mem = () => { try { return JSON.parse(localStorage.getItem(MEM)) || {}; } catch { return {}; } };
function remember(listId, items) { const m = mem(); m[listId] = m[listId] || {}; items.forEach(i => { m[listId][i.name] = { qty: i.qty, price: i.price, at: Date.now() }; }); try { localStorage.setItem(MEM, JSON.stringify(m)); } catch {} }
function forget(listId, name) { const m = mem(); if (m[listId]) { delete m[listId][name]; try { localStorage.setItem(MEM, JSON.stringify(m)); } catch {} } }
function suggestions(listId) { const m = mem()[listId] || {}; return Object.entries(m).sort((a, b) => b[1].at - a[1].at).map(([n]) => n); }
function lastOf(listId, name, priceOnly = false) { const r = (mem()[listId] || {})[name]; if (!r) return {}; return priceOnly ? { price: r.price ?? null } : { qty: r.qty ?? null, price: r.price ?? null }; }

function clearBought(id) {
  const done = itemsOf(id).filter(i => i.done); if (!done.length) return;
  remember(id, done);
  const copies = done.map(i => ({ ...i, done: false, boughtAt: null }));
  done.forEach(i => store.deleteItem(i.id));
  toast(`Cleared ${done.length} bought item${done.length === 1 ? "" : "s"}`, { label: "Undo", run: () => { copies.forEach(c => store.restoreItem({ ...c, done: true })); done.forEach(i => forget(id, i.name)); } });
}

/* ---------- Send a list ---------- */
export function listText(id) {
  const l = listOf(id), todo = itemsOf(id).filter(i => !i.done);
  return `${l.name} (${todo.length})\n${todo.map(i => `☐ ${i.name}${i.qty && i.qty !== 1 ? ` ×${String(i.qty).replace(".", ",")}` : ""}${i.note ? ` (${i.note})` : ""}`).join("\n")}\n\nSent from Koti`;
}
async function shareList(id) {
  const l = listOf(id), todo = itemsOf(id).filter(i => !i.done);
  if (!todo.length) { toast("Nothing left to buy on this list"); return; }
  const text = listText(id);
  openSheet({ title: "Send list", left: "Close", body: B => {
    B.innerHTML = `<div class="msgprev" aria-label="Message preview">${esc(text).replace(/\n/g, "<br>")}</div>
      <div class="btns">${navigator.share ? `<button type="button" class="btn primary" id="shGo">Send with…</button>` : ""}<button type="button" class="btn${navigator.share ? "" : " primary"}" id="shCopy">Copy the list</button></div>
      <p class="note">Sends the ${todo.length} item${todo.length === 1 ? "" : "s"} still to buy. A live link they can tick off is coming next.</p>`;
    const go = $("#shGo", B); if (go) go.onclick = async () => { try { await navigator.share({ title: l.name, text }); closeSheet(); } catch (e) { if (e && e.name !== "AbortError") toast("Couldn't open sharing. Copy the list instead."); } };
    $("#shCopy", B).onclick = async () => { try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into a message."); closeSheet(); } catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied. Paste it into a message."); closeSheet(); } };
  } });
}

/* ---------- New list, list settings ---------- */
export function openNewList() {
  let kind = "shopping";
  openSheet({ title: "New list", right: "Create", body: B => {
    B.innerHTML = `<div class="field"><label for="nlName">Name</label><input class="inp" id="nlName" placeholder="e.g. Groceries…" maxlength="120" autocomplete="off" autofocus></div>
      <div class="field"><span class="flabel">Type</span><div class="seg" id="nlKind"><button type="button" data-k="shopping" aria-pressed="true">Shopping list</button><button type="button" data-k="project" aria-pressed="false">Project</button></div></div>
      <p class="note" id="nlHint" style="margin-top:0">A list you shop from and can send to someone.</p>
      <div class="field" id="nlBudgetF" hidden><label for="nlBudget">Budget</label><input class="inp" id="nlBudget" inputmode="decimal" placeholder="€0 (optional)" autocomplete="off"></div>
      <p class="msg" id="nlMsg" aria-live="polite"></p>`;
    $("#nlKind", B).addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (!b) return; kind = b.dataset.k; $$("#nlKind button", B).forEach(x => x.setAttribute("aria-pressed", x === b));
      $("#nlBudgetF", B).hidden = kind !== "project"; $("#nlHint", B).textContent = kind === "project" ? "Something bigger with a budget, like a balcony makeover. Purchases count in Budgets." : "A list you shop from and can send to someone."; });
    $("#nlName", B).addEventListener("keydown", e => { if (e.key === "Enter") $("#sheet .sh-head .r").click(); });
  }, onRight: B => {
    const name = $("#nlName", B).value.trim(); if (!name) { $("#nlMsg", B).dataset.state = "error"; $("#nlMsg", B).textContent = "Give the list a name."; return; }
    const budget = parseMoney($("#nlBudget", B).value);
    const l = store.addList(name, "OH", { kind, parentId: null, budget: kind === "project" && !Number.isNaN(budget) ? budget : null });
    closeSheet(); location.hash = "#list/" + encodeURIComponent(l.id);
  } });
}
export function openListSettings(l) {
  if (!l) return;
  const isProj = l.kind === "project", isHome = l.id === HOME_PROJECT;
  openSheet({ title: isProj ? "Project" : "List", right: "Save", body: B => {
    B.innerHTML = `<div class="field"><label for="lsName">Name</label><input class="inp" id="lsName" value="${esc(l.name)}" maxlength="120" autocomplete="off"></div>
      ${isProj ? `<div class="field"><label for="lsBudget">Budget</label><input class="inp" id="lsBudget" inputmode="decimal" placeholder="€0 (optional)" value="${moneyField(l.budget)}" autocomplete="off"></div>
      <div class="field"><label for="lsExtra">Other spending<span class="sr"> for this project</span></label><input class="inp" id="lsExtra" inputmode="decimal" placeholder="€0" value="${moneyField(l.extraSpend || "")}" autocomplete="off"><p class="note">Costs that aren't items, like delivery fees.</p></div>` : ""}
      ${!isProj ? `<div class="field"><label for="lsCat">Spending category</label><select class="inp" id="lsCat"><option value="">None</option>${store.model.categories.map(c => `<option value="${esc(c.id)}"${l.categoryId === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select><p class="note">Optional. If you choose one, items ticked off by a scanned receipt count in that category, and the list card shows what you spent there. You can still change any line when you scan.</p></div>` : ""}
      ${isHome ? `<div class="grp">
        <label class="row"><span class="rt">Moved in</span><input class="inl" id="lsMoved" type="date" value="${esc(store.model.settings.movedIn || "")}"></label>
        <button type="button" class="row" id="lsRooms"><span class="rt">Rooms<small>${roomsOf(l.id).length} rooms on your floor plan</small></span>${icon("chev", "ic sm chev")}</button>
        <button type="button" class="row" id="lsNotes"><span class="rt">Moving-in notes<small>${store.model.settings.notes ? esc(store.model.settings.notes.split("\n")[0].slice(0, 48)) : "Measurements, delivery times…"}</small></span>${icon("chev", "ic sm chev")}</button>
      </div>` : ""}
      <p class="msg" id="lsMsg" aria-live="polite"></p>
      ${isHome ? `<button type="button" class="btn danger" id="lsReset">Reset this project</button>` : ""}
      <button type="button" class="btn danger" id="lsDel">${icon("trash", "ic sm")} Delete ${isProj ? "project" : "list"}</button>`;
    if (isHome) {
      const go = f => () => { closeSheet(); setTimeout(() => import("./more.js").then(m => m[f]()), 260); };
      $("#lsRooms", B).onclick = go("openLists"); $("#lsNotes", B).onclick = go("openNotes"); $("#lsReset", B).onclick = () => { closeSheet(); import("./more.js").then(m => m.doReset()); };
    }
    $("#lsDel", B).onclick = () => { const n = isProj ? projectItems(l.id).length : itemsOf(l.id).length;
      if (!confirm(`Delete "${l.name}"${n ? ` and its ${n} items` : ""}? This can't be undone.`)) return;
      closeSheet(); const back = l.parentId ? "#list/" + encodeURIComponent(l.parentId) : "#expenses"; store.deleteList(l.id); location.hash = back; toast(`Deleted ${l.name}`); };
  }, onRight: B => {
    const name = $("#lsName", B).value.trim(); if (!name) { $("#lsMsg", B).dataset.state = "error"; $("#lsMsg", B).textContent = "Give it a name."; return; }
    const patch = { name }; if (!isProj) patch.categoryId = $("#lsCat", B).value || null;
    if (isProj) { const b = parseMoney($("#lsBudget", B).value), x = parseMoney($("#lsExtra", B).value); if (Number.isNaN(b) || Number.isNaN(x)) { $("#lsMsg", B).dataset.state = "error"; $("#lsMsg", B).textContent = "Type amounts as numbers, like 900."; return; } patch.budget = b; patch.extraSpend = x || 0; }
    if (isHome) { const mv = $("#lsMoved", B).value; if (mv !== (store.model.settings.movedIn || "")) store.updateSettings({ movedIn: mv }); }
    store.updateList(l.id, patch); closeSheet(); toast("Saved");
  } });
}

/* ---------- + menu ---------- */
export function openAddMenu() {
  openSheet({ title: "Add", left: "Close", body: B => {
    B.innerHTML = `<div class="acts">
      <button type="button" class="act-big g" data-a="scan">${icon("cam")}<b>Scan or upload</b><small>Receipt or bill</small></button>
      <button type="button" class="act-big" data-a="expense">${icon("money")}<b>Expense</b><small>Type an amount</small></button>
      <button type="button" class="act-big" data-a="income">${icon("up")}<b>Income</b><small>Salary, refund, side job</small></button>
      <button type="button" class="act-big" data-a="list">${icon("list")}<b>To a list</b><small>Groceries, Home setup…</small></button></div>`;
    B.addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (!b) return; closeSheet();
      setTimeout(() => ({ scan: () => openScan(), expense: () => openExpense(), income: () => openExpense({ draft: { kind: "income", date: todayISO(), amount: null, payee: "", note: "" } }), list: () => openAddToList() })[b.dataset.a](), 260); });
  } });
}
export function openAddToList(preselect) {
  const targets = []; topLists().forEach(l => { if (l.kind === "project") roomsOf(l.id).forEach(r => targets.push({ id: r.id, name: `${l.name} › ${r.name}`, room: true })); else targets.push({ id: l.id, name: l.name }); });
  if (!targets.length) { openNewList(); return; }
  const def = preselect || (topLists().find(l => l.kind === "shopping") || {}).id || targets[0].id;
  openSheet({ title: "Add to a list", right: "Add", body: `
    <div class="field"><label for="alItems">Items</label><input class="inp" id="alItems" placeholder="Milk, eggs, 2 × yogurt…" autocomplete="off" autofocus enterkeyhint="done"></div>
    <div class="field"><label for="alList">List</label><select class="inp" id="alList">${targets.map(t => `<option value="${esc(t.id)}"${t.id === def ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
    <p class="msg" id="alMsg" aria-live="polite"></p>`,
    onRight: B => { const items = parseItems($("#alItems", B).value), lid = $("#alList", B).value; if (!items.length) { $("#alMsg", B).dataset.state = "error"; $("#alMsg", B).textContent = "Type at least one item."; return; }
      items.forEach(p => store.addItem(lid, p.name, "Soon", { qty: p.qty })); closeSheet(); toast(`Added ${items.length === 1 ? items[0].name : items.length + " items"} to ${listOf(lid).name}`); } });
  setTimeout(() => { const i = $("#alItems"); if (i) i.addEventListener("keydown", e => { if (e.key === "Enter") $("#sheet .sh-head .r").click(); }); }, 50);
}
