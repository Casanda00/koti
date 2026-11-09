// Talking to Koti, and Koti speaking first.
//   openKoti()   a conversation over the screen: type or hold the microphone, Koti answers with your own figures,
//                offers follow-up questions to tap, and proposes actions as cards (Save it, Add, Remind me…).
//                It opens from the spark at the top, from a question typed in the add box, and from today's note.
//   briefHTML()  "Koti noticed": today's note at the top of Today, one to three things worth knowing, with any
//                action Koti suggests. Fetched once a day (js/brain.js).
// Replies to something said out loud are read out loud too, unless that's switched off in You.
import { $, esc, toast, icon, openSheet } from "./ui.js";
import { store } from "./data.js";
import { ask, conversation, saveConversation, newConversation, pastConversations, openConversation, deleteConversation, canAsk, describeAction, doAction, cachedBrief, brief, dismissBriefAction, memory, remember, forget } from "./brain.js";
import { initTalk } from "./talk.js";
import { learned, forgetLearned } from "./learn.js";
import { aiVoice } from "./hear.js";
import { aiOffReason } from "./receipts.js";
import { speechSupported } from "./voice.js";
import { playReply, stopVoice, unlockAudio, speaks } from "./voiceout.js";
import { createConversation } from "./converse.js";

let ui = null, msgs = [], busy = false, past = false;
const STARTERS = ["How am I doing this month?", "Can I afford a €60 dinner out?", "What bills are coming before payday?", "Where did my money go last week?"];
const STARTERS_FI = ["Miten kuukausi menee?", "Onko minulla varaa 60 € illalliseen?", "Mitä laskuja tulee ennen palkkapäivää?", "Mihin rahani menivät viime viikolla?"];
const fi = () => String(store.model.settings.voiceLang || "").startsWith("fi");

function sheet() {
  if (ui) return ui;
  const el = document.createElement("div");
  el.className = "kchat"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "kcT");
  el.innerHTML = `<div class="kchat-dim" data-kclose></div>
    <section class="kchat-sheet">
      <header class="kchat-h"><span class="ai-mark" aria-hidden="true">${icon("spark", "ic sm")}</span><b id="kcT">Koti</b>
        <button type="button" class="kchat-new" id="kcPast">Earlier</button>
        <button type="button" class="kchat-new" id="kcNew">New chat</button>
        <button type="button" class="kchat-x" data-kclose aria-label="Close">${icon("x")}</button></header>
      <div class="kchat-log" id="kcLog" aria-live="polite"></div>
      <div class="kchat-ups" id="kcUps"></div>
      <div class="kconv" id="kcConv" hidden>
        <button type="button" class="kconv-orb" id="kcOrb" aria-label="Koti is listening">${icon("mic")}</button>
        <p class="kconv-s" id="kcConvS" aria-live="polite">Listening</p>
        <button type="button" class="pill ghost" id="kcEnd">End</button>
      </div>
      <form class="kchat-in" id="kcForm" autocomplete="off">
        <label class="sr" for="kcIn">Ask Koti</label>
        <input id="kcIn" type="text" enterkeyhint="send" placeholder="Ask Koti anything" maxlength="1000">
        <label class="dk" for="kcPic" id="kcPicL" aria-label="Give Koti a screenshot or a photo" title="Screenshot or photo">${icon("cam")}</label><input type="file" id="kcPic" accept="image/*,application/pdf" class="sr">
        <button type="button" class="dk" id="kcMic" aria-label="Hold to talk" hidden>${icon("mic")}</button>
        <button type="button" class="dk kc-talk" id="kcTalk" aria-label="Talk with Koti, hands free" hidden>${icon("wave")}</button>
        <button type="submit" class="dk go send" id="kcGo" aria-label="Send">${icon("send")}</button>
      </form>
    </section>`;
  document.body.appendChild(el);
  ui = { el, log: $("#kcLog", el), ups: $("#kcUps", el), form: $("#kcForm", el), input: $("#kcIn", el), mic: $("#kcMic", el), go: $("#kcGo", el), talk: $("#kcTalk", el),
    conv: $("#kcConv", el), orb: $("#kcOrb", el), convS: $("#kcConvS", el) };
  el.addEventListener("click", e => {
    if (e.target.closest("[data-kclose]")) { closeKoti(); return; }
    if (e.target.closest("#kcNew")) { if (msgs.length) persist(); newConversation(); msgs = []; past = false; paint(); ui.input.focus(); return; }
    if (e.target.closest("#kcPast")) { past = !past; paint(); return; }
    const op = e.target.closest("[data-open-chat]"); if (op) { msgs = openConversation(op.dataset.openChat); past = false; paint(); return; }
    const del = e.target.closest("[data-del-chat]"); if (del) { deleteConversation(del.dataset.delChat); paint(); toast("Conversation deleted"); return; }
    const up = e.target.closest("[data-up]"); if (up) { send({ message: up.dataset.up }); return; }
    const act = e.target.closest("[data-act]"); if (act) { runCard(act); return; }
    const und = e.target.closest("[data-unremember]"); if (und) { const [i, j] = und.dataset.unremember.split(":").map(Number); const a = msgs[i] && msgs[i].remembered && msgs[i].remembered[j]; if (a && a.undo) { a.undo(); a.undone = true; delete a.undo; persist(); paint(); toast("Undone"); } }
  });
  el.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); closeKoti(); } });
  ui.form.addEventListener("submit", e => { e.preventDefault(); const t = ui.input.value.trim(); if (t) send({ message: t }); });
  // A screenshot or a photo: a payment, a receipt or a bill is read and checked the usual way, over the conversation.
  $("#kcPic", el).addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) import("./scan.js").then(m => m.openScan({ file: f })); });
  if (aiVoice() || speechSupported()) {
    ui.mic.hidden = false;
    initTalk(ui.mic, { send: async ({ audio, text }) => { if (audio) await send({ audio }); else if (text) await send({ message: text, spoken: true }); } });
    // The tap that starts talking also lets Koti's spoken answer play later (phones block sound a page starts itself).
    ["touchstart", "pointerdown", "keydown"].forEach(ev => ui.mic.addEventListener(ev, unlockAudio, { passive: true }));
  }
  if (aiVoice()) {
    ui.talk.hidden = false;
    ui.talk.onclick = () => { unlockAudio(); startConversation(); };
    $("#kcEnd", el).onclick = () => conv && conv.end("stopped");
    ui.orb.onclick = () => conv && conv.interrupt();
  }
  return ui;
}

const persist = () => saveConversation(msgs.map(m => ({ ...m, remembered: (m.remembered || []).map(({ undo, ...r }) => r) })));

/* Earlier chats, on this device for 30 days. */
function paintPast(u) {
  const list = pastConversations();
  $("#kcPast", u.el).textContent = "Back";
  u.ups.innerHTML = "";
  u.log.innerHTML = `<div class="kpast"><p class="kpast-h">Earlier chats</p>
    ${list.length ? list.map(c => `<div class="kpast-row"><button type="button" class="kpast-o" data-open-chat="${esc(c.id)}"><span>${esc(c.title)}</span><small>${esc(new Date(c.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }))}</small></button>
      <button type="button" class="kpast-x" data-del-chat="${esc(c.id)}" aria-label="Delete ${esc(c.title)}">${icon("trash", "ic sm")}</button></div>`).join("")
      : `<p class="kchat-sub">No earlier chats on this device yet.</p>`}
    <p class="note">Kept on this phone for 30 days.</p></div>`;
}
function paint() {
  const u = ui; if (!u) return;
  if (past) { paintPast(u); return; }
  $("#kcPast", u.el).textContent = "Earlier";
  const name = String(store.model.settings.name || "").split(" ")[0];
  if (!msgs.length) {
    u.log.innerHTML = `<div class="kchat-hello"><p class="kchat-hi">${esc(fi() ? `Hei${name ? " " + name : ""}! Mitä haluat tietää?` : `Hi${name ? " " + name : ""}. What would you like to know?`)}</p>
      <p class="kchat-sub">${esc(fi() ? "Kysy rahoistasi tai kerro, mitä lisätään." : "Ask about your money, or tell me what to add.")}</p></div>`;
    u.ups.innerHTML = (fi() ? STARTERS_FI : STARTERS).map(s => `<button type="button" class="fchip" data-up="${esc(s)}">${esc(s)}</button>`).join("");
    return;
  }
  u.log.innerHTML = msgs.map((m, i) => m.role === "user"
    ? `<div class="kmsg mine"><p>${esc(m.content)}</p></div>`
    : m.role === "error" ? `<div class="kmsg err"><p>${esc(m.content)}</p></div>`
    : `<div class="kmsg koti">${m.content ? `<div class="ai-says"><span class="ai-mark" aria-hidden="true">${icon("spark", "ic sm")}</span><p>${esc(m.content)}</p></div>` : ""}
        ${(m.actions || []).map((a, j) => cardHTML(a, `${i}:${j}`)).join("")}
        ${(m.remembered || []).filter(r => r.done).map((r, j) => `<p class="kmem">${icon("spark", "ic xs")} ${esc(r.type === "forget" ? "Forgot" : "Remembered")}: ${esc(r.fact)}${r.undone ? " (undone)" : ` <button type="button" class="tlink" data-unremember="${i}:${j}">Undo</button>`}</p>`).join("")}
      </div>`).join("") + (busy ? `<div class="kmsg koti"><div class="ai-says"><span class="ai-mark" aria-hidden="true">${icon("spark", "ic sm")}</span><p class="kdots" aria-label="Koti is thinking"><i></i><i></i><i></i></p></div></div>` : "");
  const last = [...msgs].reverse().find(m => m.role === "assistant");
  u.ups.innerHTML = busy || !last ? "" : (last.followUps || []).map(s => `<button type="button" class="fchip" data-up="${esc(s)}">${esc(s)}</button>`).join("");
  u.go.disabled = busy; u.input.readOnly = busy;
  requestAnimationFrame(() => { u.log.scrollTop = u.log.scrollHeight; });
}

/* An action as a card: what it is and a button, or what happened to it. */
function cardHTML(a, key) {
  const d = describeAction(a);
  const state = a.status === "done" ? `<span class="kcard-done">${icon("check", "ic xs")} Done</span>` : a.status === "opened" ? `<span class="kcard-done">Opened</span>` : a.status === "undone" ? `<span class="kcard-done">Undone</span>`
    : d.button ? `<button type="button" class="pill kcard-go" data-act="${key}">${esc(d.button)}</button>` : "";
  return `<div class="kcard"><span class="ico g">${icon(d.icon)}</span><span class="rt">${esc(d.title)}${d.sub ? `<small>${esc(d.sub)}</small>` : ""}</span>${state}</div>`;
}

async function runCard(btn) {
  const [i, j] = btn.dataset.act.split(":"), brief = i === "b";
  const a = brief ? (cachedBrief() || { actions: [] }).actions.find(x => x.id === j) : msgs[+i] && msgs[+i].actions[+j];
  if (!a || a.status) return;
  btn.disabled = true;
  const r = await doAction(a);
  if (brief) { dismissBriefAction(a.id); if (r.done) toast(r.message, r.undo ? { label: "Undo", run: r.undo } : undefined); return; }
  if (r.opened) a.status = "opened";
  else if (r.done) { a.status = "done"; toast(r.message, r.undo ? { label: "Undo", run: () => { r.undo(); a.status = "undone"; persist(); paint(); } } : undefined); }
  else { btn.disabled = false; if (r.message) toast(r.message); }
  persist(); paint();
}

/* ---------- Talking with Koti, hands free ---------- */
let conv = null;
const CONV_WORDS = { starting: "Starting…", listening: "Listening", thinking: "Thinking…", speaking: "Koti is speaking · tap to talk" };
function startConversation() {
  if (conv || busy) return;
  if (!canAsk()) { toast(aiOffReason("Koti")); return; }
  ui.conv.hidden = false; ui.form.hidden = true; ui.ups.hidden = true;
  conv = createConversation({
    onTurn: async blob => { const r = await send({ audio: blob, quiet: true }); return r ? { speech: r.speech, text: r.reply } : null; },
    play: reply => playReply(reply), stop: stopVoice,
    onState: (s, why) => {
      ui.conv.dataset.state = s;
      if (s === "ended") {
        conv = null; ui.conv.hidden = true; ui.form.hidden = false; ui.ups.hidden = false;
        if (why === "mic") toast("Koti can't use the microphone. Allow it in your browser's settings.");
        else if (why === "quiet") toast("Conversation ended");
        return;
      }
      ui.convS.textContent = CONV_WORDS[s] || "";
      ui.orb.setAttribute("aria-label", s === "speaking" ? "Stop Koti and talk" : CONV_WORDS[s] || "Koti");
      ui.orb.innerHTML = icon(s === "speaking" ? "wave" : "mic");
    },
  });
  conv.start();
}

/* One turn. Koti speaks only when spoken to: a recording or words the phone heard, never typing.
   quiet: the hands-free conversation plays the answer itself. Returns the answer. */
async function send({ message = "", audio = null, spoken = false, quiet = false }) {
  if (busy) return null;
  if (!canAsk()) { toast(aiOffReason("Koti")); return; }
  const history = msgs.filter(m => m.role !== "error");
  if (message) msgs.push({ role: "user", content: message });
  ui.input.value = ""; busy = true; paint();
  try {
    const r = await ask({ message, audio, history, spoken: spoken && !audio && speaks() });
    if (audio) msgs.push({ role: "user", content: r.heard || "(recording)" });
    msgs.push({ role: "assistant", content: r.reply, actions: r.actions, followUps: r.followUps, remembered: r.remembered });
    if ((audio || spoken) && !quiet) playReply({ speech: r.speech, text: r.reply });
    return r;
  } catch (e) {
    msgs.push({ role: "error", content: String(e.message || e) });
    if (message && e.code !== "limit") ui.input.value = message;
    if (quiet) throw e;
    return null;
  } finally { busy = false; persist(); paint(); }
}

export function openKoti({ message = "" } = {}) {
  if (!canAsk() && !message) { toast(aiOffReason("Koti")); return; }
  const u = sheet();
  msgs = conversation(); past = false;
  u.el.hidden = false; requestAnimationFrame(() => u.el.classList.add("on"));
  document.body.classList.add("kchat-open");
  paint();
  if (message) send({ message }); else setTimeout(() => u.input.focus(), 50);
}
export function closeKoti() {
  if (!ui) return;
  if (conv) conv.end("stopped");
  stopVoice();
  ui.el.classList.remove("on"); ui.el.hidden = true;
  document.body.classList.remove("kchat-open");
}

/* ---------- Koti noticed (Today) ---------- */
let lastTry = 0;
/* The card, from what's kept for today. Asks for today's note in the background when there is none, then calls
   rerender once it arrives. */
export function briefHTML(rerender) {
  const b = cachedBrief();
  if (!b && canAsk() && Date.now() - lastTry > 10 * 60e3) { lastTry = Date.now(); brief().then(x => { if (x && x.notes && x.notes.length && rerender) rerender(); }); }
  if (!b || !b.notes || !b.notes.length) return "";
  return `<section class="kbrief" aria-label="Koti noticed">
    <div class="kbrief-h"><span class="ai-mark" aria-hidden="true">${icon("spark", "ic sm")}</span><b>Koti noticed</b></div>
    <ul>${b.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>
    ${(b.actions || []).map(a => cardHTML(a, `b:${a.id}`)).join("")}
    <div class="kbrief-ups">${(b.followUps || []).slice(0, 2).map(s => `<button type="button" class="fchip" data-kask="${esc(s)}">${esc(s)}</button>`).join("")}<button type="button" class="fchip ask" data-kask="">${icon("spark", "ic xs")} Ask Koti</button></div>
  </section>`;
}
/* Clicks inside the card (Today calls this from its own click handler). True when it was the card's. */
export function briefClick(e) {
  const k = e.target.closest("[data-kask]"); if (k) { openKoti({ message: k.dataset.kask }); return true; }
  const act = e.target.closest(".kbrief [data-act]"); if (act) { runCard(act).then(() => document.dispatchEvent(new CustomEvent("koti:brief"))); return true; }
  return false;
}

/* ---------- You: what Koti remembers ---------- */
export const memoryCount = () => memory().length;
/* Everything Koti remembers about you, to read, remove or add to. It goes with every question you ask Koti. */
export function openMemory() {
  openSheet({ title: "What Koti remembers", left: "Done", body: B => {
    const paintM = () => {
      const m = memory();
      B.innerHTML = `<p class="note" style="margin-top:0">Koti uses these to make answers yours.</p>
        <div class="grp">${m.length ? m.map(x => `<div class="row"><span class="rt">${esc(x.text)}${x.at ? `<small>${esc(x.at)}</small>` : ""}</span><button type="button" class="pill ghost" data-forget="${esc(x.id)}" aria-label="Forget ${esc(x.text)}">Forget</button></div>`).join("") : `<div class="row"><span class="rt">Nothing yet<small>Try “I'm saving for a sofa”.</small></span></div>`}</div>
        ${learnedHTML()}
        <form class="field" id="memAdd" style="margin-top:14px"><label for="memIn">Tell Koti something about you</label><input class="inp" id="memIn" maxlength="200" placeholder="e.g. My partner pays the rent" autocomplete="off"></form>`;
      $("#memAdd", B).onsubmit = e => { e.preventDefault(); const t = $("#memIn", B).value.trim(); if (t && remember(t)) { toast("Koti will remember that"); paintM(); } };
    };
    B.addEventListener("click", e => { const l = e.target.closest("[data-unlearn]"); if (l) { forgetLearned(l.dataset.unlearn); paintM(); toast("Koti forgot that fix"); return; } });
    B.addEventListener("click", e => { const f = e.target.closest("[data-forget]"); if (!f) return; const gone = forget(f.dataset.forget); paintM(); if (gone) toast("Forgotten", { label: "Undo", run: () => { remember(gone.text); paintM(); } }); });
    paintM();
  } });
}

/* Fixes Koti learned from your corrections: shop names and categories it now uses. Dates and totals it misread are
   kept as notes for improving the reader, counted here, not listed. */
function learnedHTML() {
  const all = learned(), used = all.filter(x => x.kind === "shop" || x.kind === "category").reverse(), noted = all.length - used.length;
  if (!all.length) return "";
  return `<h3 class="pv-h">Learned from your fixes</h3>
    <div class="grp">${used.map(x => `<div class="row"><span class="rt">${esc(x.kind === "shop" ? `“${x.from}” is ${x.to}` : `${x.from} goes to ${x.to}`)}<small>${esc(x.at || "")}</small></span><button type="button" class="pill ghost" data-unlearn="${esc(x.id)}" aria-label="Forget this fix">Forget</button></div>`).join("")}</div>
    ${noted ? `<p class="note">Also ${noted} misread date${noted === 1 ? "" : "s"} or total${noted === 1 ? "" : "s"}, noted to improve reading.</p>` : ""}`;
}
