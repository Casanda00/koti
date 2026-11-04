// The box at the bottom of every main screen. On Now and Month you type (or say) what you spent, like "Lidl 23,40",
// and Koti shows what it heard before saving. On Home and in a list, what you type goes onto a list.
import { store, todayISO, topLists, listOf, newId } from "./data.js";
import { $, $$, esc, eur, eur0, openSheet, closeSheet, toast } from "./ui.js";
import { parseExpense, speechSupported, listen } from "./voice.js";
import { periodFor, totals, openExpense } from "./money.js";
import { effectiveBudgets } from "./ledger.js";
import { parseItems, currentList } from "./lists.js";

let getView = () => "now", form, input, stop = null;

function listTarget() {
  const v = getView();
  if (v === "list" || v === "project") { const l = listOf(currentList() || (location.hash.slice(1).startsWith("list/") ? decodeURIComponent(location.hash.slice(6)) : "")); if (l) return l; }
  return topLists().find(l => l.kind === "shopping") || null;
}
const listMode = () => ["home", "list", "project"].includes(getView());

export function paintComposer() {
  if (!form) return;
  const v = getView(), off = ["settings", "list", "project"].includes(v);   // lists and projects have their own add box
  document.body.classList.toggle("no-dock", off);
  if (off) return;
  const lm = listMode(), t = lm ? listTarget() : null;
  input.placeholder = lm ? (t ? `Add to ${t.name}` : "Start a list: milk, eggs…") : "Spent? Try “Lidl 23,40”";
  $("#dockLbl").textContent = lm ? (t ? `Add to ${t.name}` : "Start a shopping list") : "Spent something?";
  $("#dockCam").hidden = lm;
  $("#dockGo").setAttribute("aria-label", lm ? "Add to the list" : "Add what you spent");
}

export function initComposer(viewGetter) {
  getView = viewGetter; form = $("#dock"); input = $("#dockIn");
  form.addEventListener("submit", e => { e.preventDefault(); go(); });
  const mic = $("#dockMic");
  if (speechSupported()) {
    mic.hidden = false;
    mic.addEventListener("click", () => {
      if (stop) { stop(); stop = null; mic.classList.remove("listening"); return; }
      mic.classList.add("listening");
      stop = listen({ lang: store.model.settings.voiceLang || "en-GB", onText: (t, fin) => { input.value = t; if (fin && !listMode()) setTimeout(go, 250); }, onEnd: () => { stop = null; mic.classList.remove("listening"); }, onError: () => { stop = null; mic.classList.remove("listening"); toast("Couldn't hear that. Try typing it."); } });
    });
  }
  paintComposer();
}

function go() {
  const text = input.value.trim();
  if (listMode()) {
    if (!text) { input.focus(); return; }
    let l = listTarget();
    if (!l) { const id = newId("list"); store.put("lists", { id, name: "Groceries", kind: "shopping", position: store.model.lists.length }); l = listOf(id); }
    const items = parseItems(text); if (!items.length) return;
    items.forEach(p => store.addItem(l.id, p.name, "Soon", { qty: p.qty }));
    input.value = ""; toast(`Added ${items.length === 1 ? items[0].name : items.length + " things"} to ${l.name}`);
    return;
  }
  if (!text) { openExpense(); return; }
  const cats = store.model.categories;
  const heard = parseExpense(text, { categories: cats, history: store.model.transactions });
  if (!heard.amount) { toast("Add an amount, like “Lidl 23,40”."); input.focus(); return; }
  showHeard(heard);
}

/* What Koti heard, before it's saved. */
function showHeard(h) {
  let catId = h.categoryId;
  const dayWord = h.date === todayISO() ? "today" : new Date(h.date).toLocaleDateString("en-GB", { weekday: "long" });
  const leftAfter = () => {
    if (!catId) return "";
    const p = periodFor(new Date()), b = effectiveBudgets(p).byId[catId]; if (b == null) return "";
    const left = b - ((totals(p).byCat[catId] || 0) + h.amount), name = (store.model.categories.find(c => c.id === catId) || {}).name || "";
    return left >= 0 ? `That leaves ${eur(left)} for ${name.toLowerCase()} this month.` : `That puts ${name.toLowerCase()} ${eur0(-left)} over this month.`;
  };
  openSheet({ title: "Here's what we heard", left: "Cancel", right: "Save it", body: B => {
    B.innerHTML = `<div class="heard">
        <div class="heard-amt num">${eur(h.amount)}</div>
        <p class="heard-s">${h.payee ? `at <b>${esc(h.payee)}</b>, ` : ""}${esc(dayWord)}${h.note ? `, ${esc(h.note)}` : ""}</p>
        <p class="heard-k" id="hdQ">${catId ? "For" : "What was it for?"}</p>
        <div class="chips cat-chips" role="radiogroup" aria-label="Category">${store.model.categories.map(c => `<button type="button" class="fchip" role="radio" data-c="${esc(c.id)}" aria-checked="${c.id === catId}" aria-pressed="${c.id === catId}">${esc(c.name)}</button>`).join("")}</div>
        <p class="heard-left" id="hdLeft">${esc(leftAfter())}</p>
        <button type="button" class="tlink" id="hdMore">Change the details</button>
      </div>`;
    $(".cat-chips", B).addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; catId = catId === b.dataset.c ? null : b.dataset.c;
      $$("[data-c]", B).forEach(x => { x.setAttribute("aria-checked", x.dataset.c === catId); x.setAttribute("aria-pressed", x.dataset.c === catId); });
      $("#hdQ", B).textContent = catId ? "For" : "What was it for?"; $("#hdLeft", B).textContent = leftAfter(); });
    $("#hdMore", B).onclick = () => { closeSheet(); setTimeout(() => openExpense({ draft: { amount: h.amount, categoryId: catId, payee: h.payee || "", date: h.date, note: h.note || "", kind: "expense", source: stop === null ? "manual" : "voice" } }), 260); input.value = ""; };
  }, onRight: () => {
    const tx = store.put("transactions", { id: newId("tx"), date: h.date, amount: h.amount, kind: "expense", categoryId: catId || null, payee: h.payee || null, note: h.note || null, source: "manual" });
    closeSheet(); input.value = "";
    toast(`Saved ${eur(tx.amount)}${tx.payee ? ` at ${tx.payee}` : ""}`, { label: "Undo", run: () => store.remove("transactions", tx.id) });
  } });
}
