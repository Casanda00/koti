// Talking to Koti (design B, chosen 6 November 2026). Hold the microphone in the add box and a sheet rises over the
// screen: what you say appears in large type as you talk, and under it are Cancel, the microphone and Keep talking.
//   let go               sends it: the recording to the AI (or, without it, the words the phone heard)
//   slide left           Cancel lights up; let go there and nothing is sent
//   slide right or up    Keep talking lights up; let go there and it keeps listening hands free, with Cancel and
//                        Send to tap
//   a tap too short      nothing is sent, and it says to hold
// Keyboard and screen readers: Enter (or a click with no finger before it) opens it hands free; holding Space works
// like a finger; Escape cancels.
// The live words come from the phone's own speech recognition, run beside the recording where the phone has it.
// They are only for seeing: the AI reads the recording itself. Where the phone can't do both, the sheet says so.
import { $, toast } from "./ui.js";
import { store } from "./data.js";
import { record, aiVoice } from "./hear.js";
import { speechSupported, listen } from "./voice.js";

export const HOLD = { minMs: 350, cancelPx: 70, lockPx: 60, maxMs: 60000 };
/* Where the finger is, from where it pressed: toward Cancel (left), toward Keep talking (right or up), or neither. */
export function zoneOf(dx, dy) {
  if (dx <= -HOLD.cancelPx) return "cancel";
  if (dx >= HOLD.lockPx || dy <= -HOLD.cancelPx) return "lock";
  return null;
}
/* What letting go means. */
export function releaseAction({ heldMs, zone }) {
  return zone === "cancel" ? "cancel" : zone === "lock" ? "lock" : heldMs < HOLD.minMs ? "short" : "send";
}
/* The words, with the last one fading the way the design draws it (still being said). */
export function wordsParts(text, max = 90) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length > max) t = "…" + t.slice(t.length - max).replace(/^\S*\s/, "");
  const i = t.lastIndexOf(" ");
  return i < 0 ? { said: "", last: t } : { said: t.slice(0, i + 1), last: t.slice(i + 1) };
}
const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const ic = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;

let ui = null;
function sheet() {
  if (ui) return ui;
  const el = document.createElement("div");
  el.className = "talk"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "talkT");
  el.innerHTML = `<div class="talk-dim"></div>
    <section class="talk-sheet">
      <div class="talk-grab" aria-hidden="true"></div>
      <div class="talk-head"><span class="ai-mark" aria-hidden="true">${ic("spark")}</span><b id="talkT" aria-live="polite">Listening</b><span class="talk-time num" id="talkTime">0:00</span></div>
      <p class="talk-words" id="talkWords"><span id="talkSaid"></span><span class="talk-last" id="talkLast"></span></p>
      <p class="talk-hint" id="talkHint"></p>
      <div class="talk-row">
        <div class="talk-opt"><button type="button" class="talk-t talk-cancel" id="talkCancel" aria-label="Cancel">${ic("x")}</button><span>Cancel</span></div>
        <div class="talk-opt"><button type="button" class="talk-mic" id="talkMic" aria-label="Send">${ic("mic")}</button><span id="talkUnder">Let go to send</span></div>
        <div class="talk-opt"><button type="button" class="talk-t talk-lock" id="talkLock" aria-label="Keep talking, hands free">${ic("lock")}</button><span id="talkLockL">Keep talking</span></div>
      </div>
    </section>`;
  document.body.appendChild(el);
  ui = { el, title: $("#talkT", el), time: $("#talkTime", el), said: $("#talkSaid", el), last: $("#talkLast", el), hint: $("#talkHint", el),
    cancel: $("#talkCancel", el), mic: $("#talkMic", el), lock: $("#talkLock", el), under: $("#talkUnder", el), lockL: $("#talkLockL", el) };
  return ui;
}

/* The microphone button in the add box. send({ audio }) or send({ text }) does what was said. */
export function initTalk(mic, { send }) {
  let S = null, lastPointerUp = 0;

  function paint() {
    if (!S) return;
    const u = ui, z = S.locked ? null : S.zone, starting = !S.live;
    u.el.dataset.zone = z || ""; u.el.dataset.locked = S.locked ? "1" : "";
    u.title.textContent = starting ? "Starting the microphone…" : z === "cancel" ? "Let go to cancel" : z === "lock" ? "Let go to keep talking" : "Listening";
    u.time.textContent = clock(S.live ? Date.now() - S.t0 : 0);
    const w = wordsParts(S.words);
    if (S.words) { u.said.textContent = w.said; u.last.textContent = w.last; u.el.classList.remove("talk-empty"); }
    else { u.said.textContent = ""; u.last.textContent = "Say what you spent and where, like “lunch at Picnic, eleven euros”."; u.el.classList.add("talk-empty"); }
    u.hint.textContent = z === "cancel" ? "Nothing will be saved." : S.locked ? "Hands free. Tap Send when you're done."
      : S.wordsOff ? "Koti reads it when you let go." : "Koti writes it down as you talk. Let go and it fills in the rest.";
    u.under.textContent = S.locked ? "Send" : z === "cancel" ? "Slide back to keep it" : "Let go to send";
    u.lockL.textContent = S.locked ? "Hands free" : "Keep talking";
    u.mic.innerHTML = ic(S.locked ? "send" : "mic");
    u.mic.setAttribute("aria-label", S.locked ? "Send" : "Recording. Let go to send");
  }
  function open() {
    const u = sheet();
    u.el.hidden = false; requestAnimationFrame(() => u.el.classList.add("on"));
    u.cancel.onclick = () => S && S.locked && finish("cancel");
    u.mic.onclick = () => S && S.locked && finish("send");
    u.lock.onclick = () => { if (S && !S.locked && S.live) { S.locked = true; paint(); u.mic.focus(); } };
    u.el.onkeydown = e => { if (e.key === "Escape" && S) { e.preventDefault(); finish("cancel"); } };
  }
  function close() {
    if (!ui) return;
    ui.el.classList.remove("on"); ui.el.hidden = true;
    mic.classList.remove("listening");
  }
  function stopWords() { if (S && S.stopWords) { const f = S.stopWords; S.stopWords = null; try { f(); } catch {} } }

  async function press(mode) {   // mode: "hold" (finger, mouse, Space) or "free" (Enter, a screen reader's tap)
    if (S) return;
    if (!aiVoice() && !speechSupported()) { toast("Sign in and go online to use the microphone."); return; }
    const me = S = { mode, t0: Date.now(), zone: null, locked: mode === "free", live: false, released: false, outcome: null, words: "", wordsOff: !speechSupported() };
    mic.classList.add("listening"); open(); paint();
    const lang = store.model.settings.voiceLang || "en-GB";
    const words = onEnd => listen({ lang, continuous: true, onText: t => { if (S === me) { me.words = t; paint(); } },
      onEnd: () => { me.wordsEnded = true; if (onEnd) onEnd(); }, onError: () => { me.wordsOff = !me.words; if (S === me) paint(); } });
    if (aiVoice()) {
      try {
        me.rec = await record({ maxMs: HOLD.maxMs, onStop: blob => done(me, blob) });
      } catch (e) {
        if (S === me) { S = null; close(); }
        toast(/denied|NotAllowed/i.test(String(e && (e.name || e.message))) ? "Koti can't use the microphone. Allow it in your browser's settings." : "Couldn't start the microphone.");
        return;
      }
      if (S !== me) { me.rec.cancel(); return; }
      // Let go while the phone was still asking for the microphone (the first time): nothing was said yet.
      if (me.released && !me.locked) { me.outcome = "cancel"; me.rec.cancel(); S = null; close(); toast("The microphone is ready. Hold it while you talk."); return; }
      if (!me.wordsOff) { try { me.stopWords = words(null); } catch { me.wordsOff = true; } }
    } else {
      try { me.stopWords = words(() => { if (me.outcome === "send") doneText(me); }); }
      catch { S = null; close(); toast("Couldn't start listening. Try typing it."); return; }
    }
    me.live = true; me.t0 = Date.now(); paint();
    me.tick = setInterval(() => { if (S === me) paint(); }, 250);
    if (me.locked) ui.mic.focus();
  }
  function release() {
    if (!S) return;
    S.released = true;
    if (!S.live || S.locked) return;
    const a = releaseAction({ heldMs: Date.now() - S.t0, zone: S.zone });
    if (a === "lock") { S.locked = true; S.zone = null; paint(); ui.mic.focus(); return; }
    finish(a);
  }
  /* The end of it: send, cancel, or too short. */
  function finish(outcome) {
    const me = S; if (!me) return;
    me.outcome = outcome; clearInterval(me.tick); stopWords();
    if (me.rec) { if (outcome === "send") me.rec.stop(); else me.rec.cancel(); }
    else if (outcome === "send") { if (me.wordsEnded) doneText(me); }   // otherwise when the phone stops listening
    if (outcome !== "send") { S = null; close(); if (outcome === "short") toast("Hold the microphone while you talk, then let go."); }
  }
  /* The recording is in: to the AI. The time limit ends it as a send. */
  async function done(me, blob) {
    if (me.outcome && me.outcome !== "send") return;
    clearInterval(me.tick); stopWords();
    if (S === me) S = null;
    close();
    mic.disabled = true;
    try { await send({ audio: blob }); } finally { mic.disabled = false; }
  }
  function doneText(me) {
    if (me.sent) return; me.sent = true;
    if (S === me) S = null;
    close();
    const t = me.words.trim();
    if (t) send({ text: t }); else toast("Couldn't hear that. Try again, or type it.");
  }

  mic.setAttribute("aria-label", "Hold to talk");
  mic.setAttribute("aria-haspopup", "dialog");
  mic.addEventListener("contextmenu", e => e.preventDefault());   // a long press is talking, not a menu
  mic.addEventListener("pointerdown", e => {
    if (e.button > 0 || S) return;
    e.preventDefault(); try { mic.setPointerCapture(e.pointerId); } catch {}
    press("hold").then(() => {}); if (S) { S.x0 = e.clientX; S.y0 = e.clientY; }
  });
  mic.addEventListener("pointermove", e => {
    if (!S || S.mode !== "hold" || S.locked || S.x0 == null) return;
    const z = zoneOf(e.clientX - S.x0, e.clientY - S.y0);
    if (z !== S.zone) { S.zone = z; paint(); }
  });
  const up = e => { lastPointerUp = Date.now(); if (S && S.mode === "hold") { if (e.type === "pointercancel" && !S.locked) S.zone = "cancel"; release(); } };
  mic.addEventListener("pointerup", up); mic.addEventListener("pointercancel", up);
  mic.addEventListener("keydown", e => {
    if (e.repeat) return;
    if (e.key === " ") { e.preventDefault(); press("hold"); }
    else if (e.key === "Enter") { e.preventDefault(); press("free"); }
  });
  mic.addEventListener("keyup", e => { if (e.key === " " && S && S.mode === "hold") { e.preventDefault(); release(); } });
  // A click with no finger before it (a screen reader's double tap) opens it hands free.
  mic.addEventListener("click", e => { e.preventDefault(); if (Date.now() - lastPointerUp < 700 || S) return; press("free"); });
}
