// Getting Koti onto the Home Screen, asked for rather than hidden in You.
//   Android, desktop Chrome and Edge: the browser's own install dialog, one tap from our button.
//   iPhone and iPad: a website can't open that dialog, so a short guide (Share, Add to Home Screen, Add).
//   Inside Instagram, WhatsApp or Facebook: those windows can't install, so open Koti in a real browser first.
// First visit: a sheet, once. After "Not now": a strip on Now, hidden for a week by its ×. Installed: never again,
// and the first open from the Home Screen says thanks once. Remembered per device (localStorage), as it should be.
import { $, esc, openSheet, closeSheet, toast } from "./ui.js";

const KEY = "koti.install", WEEK = 7 * 864e5, APP_URL = "https://casanda00.github.io/koti/";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const write = patch => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch })); } catch {} };
const ua = navigator.userAgent || "";
export const isInstalled = () => matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isIPad = () => /ipad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const inAppBrowser = () => /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|WhatsApp|Snapchat|TikTok|musical_ly|Line\/|LinkedInApp|Twitter|GSA\//i.test(ua);
const appName = () => /Instagram/i.test(ua) ? "Instagram" : /FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua) ? "Facebook" : /WhatsApp/i.test(ua) ? "WhatsApp" : /TikTok|musical_ly/i.test(ua) ? "TikTok" : "this app";

const changed = () => document.dispatchEvent(new Event("koti-install-ready"));   // Now redraws: the strip may show or go
let deferred = null;   // the browser's install dialog, waiting for our button
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; document.dispatchEvent(new Event("koti-install-ready")); });
window.addEventListener("appinstalled", () => { deferred = null; write({ installed: true }); closeSheet(); toast("Koti is on your Home Screen"); document.dispatchEvent(new Event("koti-install-ready")); });

/* Show the strip on Now? Only after the sheet was seen, never once installed, and not during a week's snooze. */
export function wantsStrip() {
  if (isInstalled()) return false;
  const s = read(); return !!s.seen && !s.installed && !(s.snoozeUntil && Date.now() < s.snoozeUntil);
}
export function snoozeStrip() { write({ snoozeUntil: Date.now() + WEEK }); }
export const stripHTML = () => `<div class="inst-strip" role="region" aria-label="Home Screen"><span class="inst-ico" aria-hidden="true"><svg class="ic"><use href="#i-home"/></svg></span><span class="inst-t">Koti works best from your Home Screen</span><button type="button" class="inst-go" data-install>Add it</button><button type="button" class="inst-x" data-install-later aria-label="Hide for a week"><svg class="ic sm"><use href="#i-plus"/></svg></button></div>`;

/* On every start: thank once after installing, or ask once on a first visit. */
export function startInstall({ firstVisitDelay = 4000, ready = () => true } = {}) {
  const s = read();
  if (isInstalled()) { if (!s.thanked) { write({ thanked: true, installed: true, seen: true }); setTimeout(() => toast("Koti is on your Home Screen. Welcome."), 800); } return; }
  if (new URLSearchParams(location.search).get("install") === "1") { setTimeout(() => openInstall(), 600); return; }
  if (s.seen) return;
  const tryShow = () => { if (!ready() || document.getElementById("layer").hidden === false) { setTimeout(tryShow, 3000); return; } openInstall({ first: true }); };
  setTimeout(tryShow, firstVisitDelay);
}

/* The sheet: whichever kind this device can use. */
export function openInstall({ first = false, reason = null } = {}) {
  write({ seen: true });
  if (isInstalled()) { openSheet({ onClose: changed, title: "Home Screen", left: "Close", body: `<p class="msg">Koti is already on this device's Home Screen.</p>` }); return; }
  if (inAppBrowser()) return openInApp();
  if (isIOS()) return openIOS(reason);
  openSheet({ onClose: changed, title: "Home Screen", left: "Not now", body: B => {
    B.innerHTML = `${head("Put Koti on your Home Screen")}
      <ul class="inst-why"><li>Opens in one tap, like any app</li><li>Works without a connection</li><li>Reminders reach you on time</li></ul>
      ${deferred ? `<button type="button" class="btn primary inst-big" id="inGo">Add to Home Screen</button><p class="note inst-note">Your phone asks once more to confirm. Free, and no app store.</p>`
        : `<ol class="inst-steps"><li><b>1</b><span>Open your browser's menu, <b>⋮</b> at the top right</span></li><li><b>2</b><span>Choose <b>Install app</b> or <b>Add to Home screen</b></span></li></ol>`}`;
    const go = $("#inGo", B); if (go) go.onclick = async () => { const e = deferred; if (!e) return; e.prompt(); const r = await e.userChoice.catch(() => null); deferred = null; closeSheet(); if (r && r.outcome === "accepted") write({ installed: true }); };
  } });
}
const head = t => `<div class="inst-head"><span class="inst-icon" aria-hidden="true"><svg class="ic"><use href="#i-home"/></svg></span><h2 class="inst-h">${esc(t)}</h2></div>`;

function openIOS(reason) {
  const ipad = isIPad(), chrome = /CriOS/i.test(ua);
  openSheet({ onClose: changed, title: "Home Screen", left: "Not now", body: B => {
    B.innerHTML = `${head(reason === "reminders" ? "Reminders need Koti on your Home Screen" : "Put Koti on your Home Screen")}
      <p class="inst-p">${reason === "reminders" ? "iPhone only sends reminders to apps on the Home Screen. Add Koti there, open it from its icon, then switch reminders on." : "On iPhone it takes three taps, and it's how reminders reach you."}</p>
      <ol class="inst-steps">
        <li><b>1</b><span>Tap <b>Share</b> ${chrome ? "in the address bar" : ipad ? "at the top of the screen" : "at the bottom of the screen"}${chrome ? "" : " (or <b>•••</b>, then Share)"}</span><span class="inst-k" aria-hidden="true"><svg class="ic sm"><use href="#i-share"/></svg></span></li>
        <li><b>2</b><span>Choose <b>Add to Home Screen</b></span><span class="inst-k" aria-hidden="true"><svg class="ic sm"><use href="#i-plus"/></svg></span></li>
        <li><b>3</b><span>Tap <b>Add</b>, top right</span></li>
      </ol>
      <p class="note inst-note">Don't see it? Scroll down in the Share menu. Then open Koti from its new icon and sign in once there: it keeps its own sign-in, separate from Safari.</p>`;
  } });
}
function openInApp() {
  const name = appName(), url = APP_URL;
  openSheet({ onClose: changed, title: "Home Screen", left: "Use Koti here", body: B => {
    B.innerHTML = `${head("Open Koti in your browser first")}
      <p class="inst-p">${esc(name)} opens links in its own window, and that window can't put Koti on your Home Screen.</p>
      <ol class="inst-steps"><li><b>1</b><span>Tap <b>•••</b> at the top right</span></li><li><b>2</b><span>Choose <b>Open in browser</b> (or Open in Safari, Open in Chrome)</span></li></ol>
      <p class="inst-p">No such option? Copy the link and paste it into ${isIOS() ? "Safari" : "Chrome"}.</p>
      <div class="inst-copy"><span id="inUrl">${esc(url.replace(/^https:\/\//, "").replace(/\/$/, ""))}</span><button type="button" class="pill" id="inCopy">Copy the link</button></div>`;
    $("#inCopy", B).onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast("Link copied"); }
      catch { const r = document.createRange(); r.selectNodeContents($("#inUrl", B)); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Link selected. Copy it from the menu."); }
    };
  } });
}
