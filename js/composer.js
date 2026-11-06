// The box at the bottom of every main screen. On Now and Month you type (or say) what you spent, like "Lidl 23,40",
// and Koti shows what it heard before saving. On Home and in a list, what you type goes onto a list.
import { store, todayISO, topLists, listOf, newId } from "./data.js";
import { $, $$, esc, eur, eur0, openSheet, closeSheet, toast, kotiSays } from "./ui.js";
import { parseExpense, speechSupported, listen } from "./voice.js";
import { periodFor, totals, openExpense, payAfter, payWords } from "./money.js";
import { effectiveBudgets } from "./ledger.js";
import { parseItems, currentList } from "./lists.js";
import { isReminderPhrase, parseReminder } from "./remindparse.js";
import { spendQuestion } from "./spent.js";
import { aiVoice, record, understand, toParsed } from "./hear.js";
import { aiPossible } from "./receipts.js";

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
  if (speechSupported() || aiVoice()) { mic.hidden = false; holdToTalk(mic); }
  paintComposer();
}

/* ---------- The microphone: hold to talk, let go to send, slide away to cancel ---------- */
export const HOLD = { minMs: 350, cancelPx: 70, maxMs: 60000 };
/* What letting go means: too short to be speech, slid away, or send. */
export function releaseAction({ heldMs, away }) { return away ? "cancel" : heldMs < HOLD.minMs ? "short" : "send"; }
const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function holdToTalk(mic) {
  let session = null, lastPointerUp = 0;
  const ph = () => session && session.ph;
  const show = () => {
    if (!session || !session.live) return;
    input.placeholder = session.away ? "Let go to cancel" : `${clock(Date.now() - session.t0)}  ‹ Slide to cancel`;
    mic.classList.toggle("away", session.away);
  };
  const end = () => {
    if (!session) return;
    clearInterval(session.tick); mic.classList.remove("listening", "away"); document.body.classList.remove("talking");
    input.placeholder = ph(); session = null; goIcon();
  };
  async function press(mode) {   // mode: "hold" (finger, mouse, Space) or "toggle" (a tap from a screen reader)
    if (session) return;
    if (!aiVoice() && !speechSupported()) { toast("Sign in and go online to use the microphone."); return; }
    session = { mode, t0: Date.now(), ph: input.placeholder, away: false, live: false, released: false, outcome: null };
    const S = session;
    mic.classList.add("listening"); document.body.classList.add("talking");
    input.placeholder = "Starting the microphone…";
    if (aiVoice()) {
      try {
        S.rec = await record({ maxMs: HOLD.maxMs, onStop: async blob => {
          const outcome = S.outcome || "send";   // the time limit sends what was said
          end();
          if (outcome !== "send") { if (outcome === "short") toast("Hold the microphone while you talk, then let go."); return; }
          mic.disabled = true;
          try { await ask({ audio: blob }); } finally { mic.disabled = false; goIcon(); }
        } });
      } catch (e) { end(); toast(/denied|NotAllowed/i.test(String(e && (e.name || e.message))) ? "Koti can't use the microphone. Allow it in your browser's settings." : "Couldn't start the microphone."); return; }
      if (session !== S) { S.rec.cancel(); return; }
      // Let go while the phone was still asking for the microphone (the first time): nothing was said yet.
      if (S.released) { S.outcome = "cancel"; S.rec.cancel(); toast("The microphone is ready. Hold it while you talk."); return; }
    } else {
      S.stopListen = listen({ lang: store.model.settings.voiceLang || "en-GB", continuous: true,
        onText: t => { input.value = t; goIcon(); },
        onEnd: () => { const o = S.outcome; end(); if (o === "send" && input.value.trim() && !listMode()) go(); else if (o === "cancel") { input.value = ""; goIcon(); } },
        onError: () => { end(); toast("Couldn't hear that. Try typing it."); } });
    }
    S.live = true; S.t0 = Date.now(); show(); S.tick = setInterval(show, 250);
  }
  function release(away = false) {
    const S = session; if (!S) return;
    S.released = true;
    if (!S.live) return;   // still starting: press() sees "released" and stops
    S.outcome = releaseAction({ heldMs: Date.now() - S.t0, away: away || S.away });
    if (S.rec) { if (S.outcome === "send") S.rec.stop(); else S.rec.cancel(); }
    else if (S.stopListen) S.stopListen();
  }

  mic.setAttribute("aria-label", "Hold to talk");
  mic.addEventListener("contextmenu", e => e.preventDefault());   // a long press is talking, not a menu
  mic.addEventListener("pointerdown", e => {
    if (e.button > 0) return;
    e.preventDefault(); try { mic.setPointerCapture(e.pointerId); } catch {}
    session && session.mode === "toggle" ? release() : press("hold");
  });
  mic.addEventListener("pointermove", e => {
    if (!session || session.mode !== "hold") return;
    const r = mic.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const away = Math.hypot(dx, dy) > HOLD.cancelPx;
    if (away !== session.away) { session.away = away; show(); }
  });
  const up = e => { lastPointerUp = Date.now(); if (session && session.mode === "hold") release(e.type === "pointercancel"); };
  mic.addEventListener("pointerup", up); mic.addEventListener("pointercancel", up);
  // Space held down on a keyboard works like a finger.
  mic.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); if (e.key === " ") press("hold"); else session ? release() : press("toggle"); } });
  mic.addEventListener("keyup", e => { if (e.key === " " && session && session.mode === "hold") { e.preventDefault(); release(); } });
  // A click with no finger before it (a screen reader's double tap): first starts, the next one sends.
  mic.addEventListener("click", e => { e.preventDefault(); if (Date.now() - lastPointerUp < 700) return; session ? release() : press("toggle"); });
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
  if (fallback && !(d.intent === "spend" && d.spend && d.spend.total) && d.intent !== "question" && d.intent !== "remind") { showHeard(fallback); return; }
  const said = d.transcript || text;
  if (d.intent === "question" && d.range) { input.value = ""; location.hash = "#spending/" + d.range; return; }
  if (d.intent === "remind") { input.value = ""; import("./reminders.js").then(m => m.openReminder(null, parseReminder(said, { bills: store.model.bills }))); return; }
  if (d.intent === "list" && d.items.length) {
    let l = listTarget();
    if (!l) { const id = newId("list"); store.put("lists", { id, name: "Groceries", kind: "shopping", position: store.model.lists.length }); l = listOf(id); }
    d.items.forEach(x => store.addItem(l.id, x.name, "Soon", { qty: x.qty && Number.isInteger(x.qty) && x.qty > 1 ? x.qty : null }));
    input.value = ""; toast(d.reply || `Added ${d.items.length === 1 ? d.items[0].name : d.items.length + " things"} to ${l.name}`); return;
  }
  if (d.intent === "spend" && d.spend && d.spend.total) {
    const P = toParsed(d.spend); input.value = "";
    if (P.lines.length > 1 || P.lines.some(l => l.placeId)) { import("./scan.js").then(m => m.openParsed({ ...P, reply: d.reply })); return; }
    showHeard({ amount: P.amount, payee: P.payee, date: P.date, note: P.note, categoryId: P.categoryId, fromNextPay: P.fromNextPay }, d.reply); return;
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
/* Without the AI, the sentence is made from what the phone read, so the sheet still answers in words. */
export function localReply(h, categories = store.model.categories) {
  const day = h.date === todayISO() ? "today" : new Date(h.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" });
  const cat = h.categoryId && (categories.find(c => c.id === h.categoryId) || {}).name;
  const what = h.note ? ` for ${h.note}` : cat ? ` on ${cat.toLowerCase()}` : "";
  const pay = h.fromPay ? ` It comes out of your pay on ${payWords({ date: h.fromPay })}, so today's money stays as it is.` : h.fromNextPay ? " Koti doesn't know your payday yet, so it comes out of today's money." : "";
  return `${eur(h.amount)}${h.payee ? ` at ${h.payee}` : ""}${what}, ${day}.${pay}${h.categoryId ? "" : " What was it for?"}`;
}
function showHeard(h, reply = null) {
  // "From my upcoming salary": it comes out of the first payday after the day it was bought.
  if (h.fromNextPay && !h.fromPay) { const pay = payAfter(h.date); if (pay) h = { ...h, fromPay: pay.date }; }
  let catId = h.categoryId, fromPay = h.fromPay || null;
  const leftAfter = () => {
    if (!catId) return "";
    const p = periodFor(new Date()), b = effectiveBudgets(p).byId[catId]; if (b == null) return "";
    const left = b - ((totals(p).byCat[catId] || 0) + h.amount), name = (store.model.categories.find(c => c.id === catId) || {}).name || "";
    return left >= 0 ? `That leaves ${eur(left)} for ${name.toLowerCase()} this month.` : `That puts ${name.toLowerCase()} ${eur0(-left)} over this month.`;
  };
  openSheet({ title: "", left: "Cancel", right: "Save it", body: B => {
    B.innerHTML = `<div class="heard">
        ${kotiSays(reply || localReply(h))}
        <div class="heard-amt num">${eur(h.amount)}</div>
        <p class="heard-k" id="hdQ">Category</p>
        <div class="chips cat-chips" role="radiogroup" aria-label="Category">${store.model.categories.map(c => `<button type="button" class="fchip" role="radio" data-c="${esc(c.id)}" aria-checked="${c.id === catId}" aria-pressed="${c.id === catId}">${esc(c.name)}</button>`).join("")}</div>
        <p class="heard-left" id="hdLeft">${esc(leftAfter())}</p>
        ${h.fromPay ? `<label class="row heard-pay"><span class="rt">From my next pay<small id="hdPaySm"></small></span><input type="checkbox" class="switch" id="hdPay" checked></label>` : ""}
        <button type="button" class="tlink" id="hdMore">Change the details</button>
      </div>`;
    const paySm = () => { const s = $("#hdPaySm", B); if (s) s.textContent = fromPay ? `Comes out of your pay on ${payWords({ date: fromPay })}` : "Off: it comes out of today's money"; };
    paySm(); const sw = $("#hdPay", B); if (sw) sw.onchange = () => { fromPay = sw.checked ? h.fromPay : null; paySm(); };
    $(".cat-chips", B).addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; catId = catId === b.dataset.c ? null : b.dataset.c;
      $$("[data-c]", B).forEach(x => { x.setAttribute("aria-checked", x.dataset.c === catId); x.setAttribute("aria-pressed", x.dataset.c === catId); });
      $("#hdLeft", B).textContent = leftAfter(); });
    $("#hdMore", B).onclick = () => { closeSheet(); setTimeout(() => openExpense({ draft: { amount: h.amount, categoryId: catId, payee: h.payee || "", date: h.date, note: h.note || "", fromPay, kind: "expense", source: stop === null ? "manual" : "voice" } }), 260); input.value = ""; goIcon(); };
  }, onRight: () => {
    const tx = store.put("transactions", { id: newId("tx"), date: h.date, amount: h.amount, kind: "expense", categoryId: catId || null, payee: h.payee || null, note: h.note || null, fromPay, source: "manual" });
    closeSheet(); input.value = ""; goIcon();
    toast(`Saved ${eur(tx.amount)}${tx.payee ? ` at ${tx.payee}` : ""}${tx.fromPay ? `, from your pay on ${payWords({ date: tx.fromPay })}` : ""}`, { label: "Undo", run: () => store.remove("transactions", tx.id) });
  } });
}
