// Koti's voice. Koti speaks only when it was spoken to, never to typing (the owner's rule, 9 November 2026).
// The answer arrives as speech from the server (OpenAI's natural voice, made in the same request); if it doesn't,
// the phone's own voice reads it. One audio element is used for everything, unlocked by the tap that starts talking,
// because phones block sound that a page starts by itself.
import { store } from "./data.js";

let el = null;
/* A tenth of a second of silence, as a WAV made here: played by the first tap, it lets later replies play. */
function silence() {
  const n = 800, b = new ArrayBuffer(44 + n), v = new DataView(b), w = (o, t) => [...t].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
  for (let k = 0; k < n; k++) v.setUint8(44 + k, 128);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}
let SILENT = null;

export const speaks = () => store.model.settings.kotiSpeaks !== false;

/* Call from the tap that starts talking, so a reply can be played later without another tap. */
export function unlockAudio() {
  try {
    if (!el) { el = new Audio(); el.preload = "auto"; el.setAttribute("playsinline", ""); }
    el.src = SILENT || (SILENT = silence()); const p = el.play(); if (p && p.catch) p.catch(() => {});
  } catch {}
  try { if (window.speechSynthesis) speechSynthesis.getVoices(); } catch {}
}

let stopNow = null;
/* Plays a reply and resolves when it has finished (or was stopped). speech: a data URL from the server, or null. */
export function playReply({ speech = null, text = "", lang = store.model.settings.voiceLang || "en-GB" } = {}) {
  stopVoice();
  if (!speaks() || (!speech && !text)) return Promise.resolve();
  return new Promise(resolve => {
    let done = false; const finish = () => { if (done) return; done = true; stopNow = null; resolve(); };
    const byPhone = () => {
      try {
        if (!window.speechSynthesis || !text) return finish();
        const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.rate = 1.03; u.onend = finish; u.onerror = finish;
        speechSynthesis.cancel(); speechSynthesis.speak(u);
        stopNow = () => { try { speechSynthesis.cancel(); } catch {} finish(); };
      } catch { finish(); }
    };
    if (!speech) { byPhone(); return; }
    try {
      if (!el) { el = new Audio(); el.setAttribute("playsinline", ""); }
      el.onended = finish; el.onerror = byPhone; el.src = speech;
      const p = el.play(); if (p && p.catch) p.catch(byPhone);
      stopNow = () => { try { el.pause(); } catch {} finish(); };
    } catch { byPhone(); }
  });
}
export function stopVoice() { if (stopNow) stopNow(); try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch {} }
