// The box at the bottom of every main screen. On Now and Month you type (or say) what you spent, like "Lidl 23,40",
// and Koti shows what it heard before saving. On Home and in a list, what you type goes onto a list.
import { store, todayISO, topLists, listOf, newId } from "./data.js";
import { $, $$, esc, eur, eur0, openSheet, closeSheet, toast, kotiSays } from "./ui.js";
import { parseExpense, speechSupported } from "./voice.js";
import { periodFor, totals, openExpense, payAfter, payWords } from "./money.js";
import { effectiveBudgets } from "./ledger.js";
import { parseItems, currentList } from "./lists.js";
import { isReminderPhrase, parseReminder } from "./remindparse.js";
import { spendQuestion } from "./spent.js";
import { aiVoice, understand, toParsed } from "./hear.js";
import { aiPossible } from "./receipts.js";
import { initTalk } from "./talk.js";
import { goalFor, savedOf, spendFromGoal } from "./plan.js";
import { looksLikeQuestion } from "./brain.js";
import { applyLearned, learnFromSave } from "./learn.js";
const toKoti = message => import("./koti.js").then(m => m.openKoti({ message }));

let getView = () => "now", form, input, stop = null;

function listTarget() {
  const v = getView();
  if (v === "list" || v === "project") { const l = listOf(currentList() || (location.hash.slice(1).startsWith("list/") ? decodeURIComponent(location.hash.slice(6)) : "")); if (l) return l; }
  return topLists().find(l => l.kind === "shopping") || null;
}
const listMode = () => ["projects", "list", "project"].includes(getView());

/* The round button: + opens the add sheet when the box is empty; once something is typed it is Send. */
export function goIcon() {
  if (!form || form.classList.contains("busy")) return;
  const typed = !!input.value.trim(), lm = listMode(), t = lm ? listTarget() : null, go = $("#dockGo");
  go.classList.toggle("send", typed);
  $("use", go).setAttribute("href", typed ? "#i-send" : "#i-plus");
  go.setAttribute("aria-label", typed ? (lm ? (t ? `Add to ${t.name}` : "Add to a new list") : "Send") : lm ? "Add to the list" : "Add what you spent");
  input.setAttribute("enterkeyhint", typed && !lm ? "send" : "done");
}
export function paintComposer() {
  if (!form) return;
  const v = getView(), off = ["settings", "reminders", "list", "project"].includes(v);   // lists and projects have their own add box
  document.body.classList.toggle("no-dock", off);
  if (off) return;
  const lm = listMode(), t = lm ? listTarget() : null;
  input.placeholder = lm ? (t ? `Add to ${t.name}` : "Start a list: milk, eggs…") : "Spent? Try “Lidl 23,40”";
  $("#dockLbl").textContent = lm ? (t ? `Add to ${t.name}` : "Start a shopping list") : "Spent something?";
  $("#dockCam").hidden = lm;
  goIcon();
}

export function initComposer(viewGetter) {
  getView = viewGetter; form = $("#dock"); input = $("#dockIn");
  form.addEventListener("submit", e => { e.preventDefault(); go(); });
  input.addEventListener("input", goIcon);
  const mic = $("#dockMic");
  if (speechSupported() || aiVoice()) {
    mic.hidden = false;
    // Hold to talk (js/talk.js): a recording goes to the AI; the phone's own words are put in the box and added.
    initTalk(mic, { send: async ({ audio, text }) => {
      if (audio) { await ask({ audio }); return; }
      input.value = text; goIcon(); go();
    } });
  }
  paintComposer();
}

/* More than a shop and an amount: five words or more, or words a person uses about themselves. */
export const isSentence = t => String(t).trim().split(/\s+/).length >= 5 || /\b(i|i'm|my|we|our|me|minä|mä|mun|maksoin|ostin|paid|bought|spent)\b/i.test(t);

/* Sends a recording or a phrase to the AI and does what it meant. Saving always goes through a sheet to check.
   fallback: what the phone's own rules read, used when the AI can't answer or isn't sure. */
/* The add box while the AI works: a spinner in the Add button, and the box can't be sent twice. */
function busy(on, what = "Working it out…") {
  if (!form) return;   // no page (the tests)
  form.classList.toggle("busy", on); form.setAttribute("aria-busy", on); input.readOnly = on;
  $("#dockGo").disabled = on;
  if (on) { $("#dockGo").setAttribute("aria-label", what); busy.ph = input.placeholder; input.placeholder = what; } else { if (busy.ph) input.placeholder = busy.ph; goIcon(); }
}
async function ask({ audio = null, text = "", fallback = null }) {
  let d;
  busy(true, audio ? "Working out what you said…" : "Working it out…");
  try { d = await understand({ audio, text }); }
  catch (e) { if (fallback) { showHeard(fallback); return; } toast(String(e.message || e)); if (text) input.focus(); return; }
  finally { busy(false); }
  if (fallback && !(d.intent === "spend" && d.spend && d.spend.total) && d.intent !== "question" && d.intent !== "remind" && d.intent !== "ask") { showHeard(fallback); return; }
  const said = d.transcript || text;
  // A question or a request beyond a purchase: Koti's brain answers it, with the person's own figures.
  if (d.intent === "ask" && said) { input.value = ""; toKoti(said); return; }
  if (d.intent === "question" && d.range) { input.value = ""; location.hash = "#spending/" + d.range; return; }
  if (d.intent === "remind") { input.value = ""; import("./reminders.js").then(m => m.openReminder(null, parseReminder(said, { bills: store.model.bills }))); return; }
  if (d.intent === "list" && d.items.length) {
    let l = listTarget();
    if (!l) { const id = newId("list"); store.put("lists", { id, name: "Groceries", kind: "shopping", position: store.model.lists.length }); l = listOf(id); }
    d.items.forEach(x => store.addItem(l.id, x.name, "Soon", { qty: x.qty && Number.isInteger(x.qty) && x.qty > 1 ? x.qty : null }));
    input.value = ""; toast(d.reply || `Added ${d.items.length === 1 ? d.items[0].name : d.items.length + " things"} to ${l.name}`); return;
  }
  if (d.intent === "spend" && d.spend && d.spend.total) {
    const P = applyLearned(toParsed(d.spend)); input.value = "";
    if (P.lines.length > 1 || P.lines.some(l => l.placeId)) { import("./scan.js").then(m => m.openParsed({ ...P, reply: d.reply })); return; }
    showHeard({ amount: P.amount, payee: P.payee, date: P.date, note: P.note, categoryId: P.categoryId, fromNextPay: P.fromNextPay, fromSavings: P.fromSavings, goal: P.goal }, d.reply); return;
  }
  // Not enough to save: the AI says what it understood and asks for what's missing.
  input.value = said; input.focus();
  toast(d.reply || (said ? `“${said.length > 60 ? said.slice(0, 57) + "…" : said}”: how much was it?` : "I didn't catch that. Try again, or type it."));
}

/* Whatever happened (saved, sent to the AI, put back to fix), the button follows what is left in the box. */
function go() { const r = handleTyped(input.value.trim()); goIcon(); Promise.resolve(r).finally(goIcon); return r; }
/* What was typed into the box, and pressed Add. Returns the AI's work when it asks the AI (for the tests). */
export function handleTyped(text) {
  if (isReminderPhrase(text)) {   // "remind me to pay water on the 15th": open the reminder, filled in, to check and save
    const preset = parseReminder(text, { bills: store.model.bills });
    input.value = ""; import("./reminders.js").then(m => m.openReminder(null, preset)); return;
  }
  const range = !listMode() && spendQuestion(text);   // "what did I spend last week?" opens Spent on last week
  if (range) { input.value = ""; location.hash = "#spending/" + range; return; }
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
  // "Can I afford a sofa?", "how much on coffee in October?": a question for Koti, not something spent.
  if (aiPossible() && looksLikeQuestion(text)) { if (input) input.value = ""; return toKoti(text); }
  const cats = store.model.categories;
  const heard = parseExpense(text, { categories: cats, history: store.model.transactions });
  if (!heard.amount) {
    if (aiPossible()) return ask({ text });   // the rules couldn't read it: let the AI try
    toast("Add an amount, like “Lidl 23,40”."); input.focus(); return;
  }
  // A whole sentence ("I paid 11e from my upcoming salary for lunch") goes to the AI too; what the rules read
  // is the answer if the AI can't be reached.
  if (aiPossible() && isSentence(text)) return ask({ text, fallback: heard });
  showHeard(heard);
}

/* What Koti heard, before it's saved. */
/* Without the AI, the sentence is made from what the phone read, so the sheet still answers in words. Where the
   money came from is said only when it was said (the owner's rule): pay, or a savings goal; otherwise today's money. */
export function localReply(h, categories = store.model.categories) {
  const day = h.date === todayISO() ? "today" : new Date(h.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" });
  const cat = h.categoryId && (categories.find(c => c.id === h.categoryId) || {}).name;
  const what = h.note ? ` for ${h.note}` : cat ? ` on ${cat.toLowerCase()}` : "";
  const from = h.fromPay ? `, from your pay on ${payWords({ date: h.fromPay })}` : h.goalName ? `, from ${h.goalName}` : "";
  const why = !h.fromPay && h.fromNextPay ? " Koti doesn't know your payday yet, so it comes out of today's money."
    : !h.goalName && h.fromSavings ? " You don't have a savings goal in Koti yet, so it comes out of today's money." : "";
  return `${eur(h.amount)}${h.payee ? ` at ${h.payee}` : ""}${what}, ${day}${from}.${why}${h.categoryId ? "" : " What was it for?"}`;
}
/* The same check-before-saving sheet, for a purchase Koti proposed in a conversation. */
export const confirmSpend = (h, reply = null) => showHeard(h, reply, { ai: true });
function showHeard(h, reply = null, { ai = !!reply } = {}) {
  // Said where the money came from: pay (the first payday after the day it was bought), or a savings goal.
  if (h.fromNextPay && !h.fromPay) { const pay = payAfter(h.date); if (pay) h = { ...h, fromPay: pay.date }; }
  if (h.fromSavings && !h.fromPay && !h.goalId) { const g = goalFor(h.goal); if (g) h = { ...h, goalId: g.id, goalName: g.name }; }
  let catId = h.categoryId, fromPay = h.fromPay || null, goalId = h.goalId || null;
  const goal = () => goalId && store.model.goals.find(g => g.id === goalId);
  const leftAfter = () => {
    if (!catId) return "";
    const p = periodFor(new Date()), b = effectiveBudgets(p).byId[catId]; if (b == null) return "";
    const left = b - ((totals(p).byCat[catId] || 0) + h.amount), name = (store.model.categories.find(c => c.id === catId) || {}).name || "";
    return left >= 0 ? `That leaves ${eur(left)} for ${name.toLowerCase()} this month.` : `That puts ${name.toLowerCase()} ${eur0(-left)} over this month.`;
  };
  openSheet({ title: "", left: "Cancel", right: "Save it", body: B => {
    const goals = store.model.goals;
    B.innerHTML = `<div class="heard">
        ${kotiSays(reply || localReply(h))}
        <div class="heard-amt num">${eur(h.amount)}</div>
        <p class="heard-k" id="hdQ">Category</p>
        <div class="chips cat-chips" role="radiogroup" aria-label="Category">${store.model.categories.map(c => `<button type="button" class="fchip" role="radio" data-c="${esc(c.id)}" aria-checked="${c.id === catId}" aria-pressed="${c.id === catId}">${esc(c.name)}</button>`).join("")}</div>
        <p class="heard-left" id="hdLeft">${esc(leftAfter())}</p>
        ${h.fromPay ? `<label class="row heard-pay"><span class="rt">From my next pay<small id="hdPaySm"></small></span><input type="checkbox" class="switch" id="hdPay" checked></label>` : ""}
        ${h.goalId ? `<div class="row heard-pay"><label class="rt" for="hdSave">From my savings<small id="hdSaveSm"></small></label>
          ${goals.length > 1 ? `<select class="inl" id="hdGoal" aria-label="Which savings">${goals.map(g => `<option value="${esc(g.id)}"${g.id === h.goalId ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select>` : ""}
          <input type="checkbox" class="switch" id="hdSave" checked></div>` : ""}
        <button type="button" class="tlink" id="hdMore">Change the details</button>
      </div>`;
    const paySm = () => { const s = $("#hdPaySm", B); if (s) s.textContent = fromPay ? `Comes out of your pay on ${payWords({ date: fromPay })}` : "Off: it comes out of today's money"; };
    paySm(); const sw = $("#hdPay", B); if (sw) sw.onchange = () => { fromPay = sw.checked ? h.fromPay : null; paySm(); };
    const saveSm = () => { const s = $("#hdSaveSm", B); if (!s) return; const g = goal(); s.textContent = g ? `Comes out of ${g.name}, ${eur(savedOf(g))} saved` : "Off: it comes out of today's money"; };
    saveSm(); const sv = $("#hdSave", B), pick = $("#hdGoal", B);
    if (sv) sv.onchange = () => { goalId = sv.checked ? (pick ? pick.value : h.goalId) : null; saveSm(); };
    if (pick) pick.onchange = () => { if (sv.checked) goalId = pick.value; saveSm(); };
    $(".cat-chips", B).addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; catId = catId === b.dataset.c ? null : b.dataset.c;
      $$("[data-c]", B).forEach(x => { x.setAttribute("aria-checked", x.dataset.c === catId); x.setAttribute("aria-pressed", x.dataset.c === catId); });
      $("#hdLeft", B).textContent = leftAfter(); });
    $("#hdMore", B).onclick = () => { closeSheet(); setTimeout(() => openExpense({ draft: { amount: h.amount, categoryId: catId, payee: h.payee || "", date: h.date, note: h.note || "", fromPay, goalId, kind: "expense", source: stop === null ? "manual" : "voice" } }), 260); input.value = ""; goIcon(); };
  }, onRight: () => {
    const tx = store.put("transactions", { id: newId("tx"), date: h.date, amount: h.amount, kind: "expense", categoryId: catId || null, payee: h.payee || null, note: h.note || null, fromPay, source: "manual" });
    if (ai) learnFromSave({ read: { payee: h.payee, categoryId: h.categoryId }, saved: { payee: h.payee, categoryId: catId } });   // Koti suggested it: learn a changed category
    const g = !fromPay && goal(), out = g ? spendFromGoal(g, tx) : null;
    closeSheet(); input.value = ""; goIcon();
    toast(`Saved ${eur(tx.amount)}${tx.payee ? ` at ${tx.payee}` : ""}${tx.fromPay ? `, from your pay on ${payWords({ date: tx.fromPay })}` : g ? `, from ${g.name}` : ""}`,
      { label: "Undo", run: () => { store.remove("transactions", tx.id); if (out) store.remove("transactions", out.id); } });
  } });
}
