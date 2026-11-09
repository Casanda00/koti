// Privacy and what Koti keeps on this device, for the EU's rules (ePrivacy and the GDPR). Added 9 November 2026.
//
// Koti sets no cookies, and has no ads, analytics or tracking. What it keeps in the browser (local storage,
// IndexedDB and the offline cache) is what it needs to work: your sign-in, your records and settings, receipts
// waiting to upload, the app itself for offline use, and this choice. That storage is "strictly necessary" and needs
// no consent, but people are told about it (STORED below, shown in full in You → Privacy).
//
// One thing is a choice: Koti's AI. Reading receipts and screenshots, the microphone with AI, talking to Koti and
// today's note send what you scan, say or ask (and, to answer, your own records) to OpenAI. Nothing is sent until you
// allow it, "Only necessary" is as easy as "Allow", and you can change your mind any time in You → Privacy.
// Without it, Koti still works: the phone reads receipts (total only) and hears you itself.
// The font is served by Koti itself, so opening the app sends nothing to Google.
import { $, esc, openSheet, toast } from "./ui.js";

export const CONSENT_KEY = "koti.consent", CONSENT_VERSION = 1;
const read = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || "null"); return c && c.v === CONSENT_VERSION ? c : null; } catch { return null; } };

/* The choice made on this device, or null when none has been made yet. */
export const consent = () => read();
export const aiAllowed = () => { const c = read(); return !!(c && c.ai); };
export function setConsent({ ai }) {
  const c = { v: CONSENT_VERSION, ai: !!ai, at: new Date().toISOString() };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch {}
  try { document.dispatchEvent(new CustomEvent("koti:consent", { detail: c })); } catch { /* no page (the tests) */ }
  return c;
}

/* Everything Koti keeps on this device, in plain words. */
export const STORED = [
  ["Your sign-in", "Keeps you signed in on this device (local storage, koti.auth). Removed when you sign out."],
  ["Your records and settings", "Your money, lists and settings, so Koti works offline and syncs when it can (local storage, koti.model and koti.meta)."],
  ["Receipts and bills waiting", "Photos you chose to keep, until they're uploaded to your private storage (IndexedDB, koti-files)."],
  ["The app itself", "Koti's own files, so it opens without a connection (the offline cache)."],
  ["Small preferences", "What you've dismissed, today's note, your conversations with Koti for 30 days, and this choice (local storage, koti.*)."],
];
export const SENT = [
  ["Supabase", "Stores your account and records, so your phone and computer stay in step. Only you can read them."],
  ["OpenAI", "Only with Koti's AI on: reads what you scan, say or ask, and to answer, your own records. OpenAI says it doesn't train its models on this, and keeps it at most 30 days to check for abuse."],
];

/* The first time Koti opens on a device: what it keeps, and the one choice. */
export function showConsentBanner() {
  if (read() || document.getElementById("consent")) return;
  const el = document.createElement("div");
  el.id = "consent"; el.className = "consent"; el.setAttribute("role", "dialog"); el.setAttribute("aria-labelledby", "csT"); el.setAttribute("aria-describedby", "csP");
  el.innerHTML = `<div class="consent-in">
      <h2 id="csT">Your privacy</h2>
      <p id="csP">No cookies or tracking. Koti's AI sends what you share to OpenAI.</p>
      <div class="consent-btns"><button type="button" class="btn" data-cs="no">Only necessary</button><button type="button" class="btn" data-cs="yes">Allow AI</button></div>
      <button type="button" class="tlink" data-cs="more">What Koti keeps and sends</button>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-cs]"); if (!b) return;
    if (b.dataset.cs === "more") { openPrivacy(); return; }
    setConsent({ ai: b.dataset.cs === "yes" }); el.remove();
    toast(b.dataset.cs === "yes" ? "Koti's AI is on. You can change this in You → Privacy." : "Only what Koti needs. You can switch the AI on in You → Privacy.");
  });
  // The two answers look the same and neither is chosen for you (the EU's guidance on consent): focus starts on the question.
  const h = el.querySelector("#csT"); h.tabIndex = -1; setTimeout(() => h.focus({ preventScroll: true }), 50);
}

/* You → Privacy: the choice, and everything kept and sent. */
export function openPrivacy() {
  openSheet({ title: "Privacy", left: "Done", body: B => {
    const paint = () => {
      const c = read();
      B.innerHTML = `<div class="grp"><label class="row"><span class="rt">Koti's AI<small>Sends what you scan, say or ask to OpenAI.</small></span><input type="checkbox" class="switch" id="pvAi" ${c && c.ai ? "checked" : ""}></label></div>
        <p class="note" style="margin:0">${c ? `Chosen ${esc(new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}.` : "Off until you allow it."} Koti still works without it.</p>
        <h3 class="pv-h">Kept on this device</h3>
        <div class="grp">${STORED.map(([t, d]) => `<div class="row"><span class="rt">${esc(t)}<small>${esc(d)}</small></span></div>`).join("")}</div>
        <p class="note" style="margin:0">All needed for Koti to work. No cookies, ads or tracking.</p>
        <h3 class="pv-h">Sent to</h3>
        <div class="grp">${SENT.map(([t, d]) => `<div class="row"><span class="rt">${esc(t)}<small>${esc(d)}</small></span></div>`).join("")}</div>
        <button type="button" class="btn" id="pvChats">Delete my conversations with Koti</button>`;
      $("#pvAi", B).onchange = e => { setConsent({ ai: e.target.checked }); const bn = document.getElementById("consent"); if (bn) bn.remove(); paint(); toast(e.target.checked ? "Koti's AI is on" : "Koti's AI is off. Nothing more is sent to OpenAI."); };
      $("#pvChats", B).onclick = () => import("./brain.js").then(m => { m.deleteAllConversations(); toast("Conversations deleted from this device"); });
    };
    paint();
  } });
}
