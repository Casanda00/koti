// Pull down to refresh on every tab (touch screens).
// Syncs with Supabase, checks for a new app version, and redraws the current view.
import { sync, refresh } from "./sync.js";
import { toast, reduceMotion } from "./ui.js";

const TRIGGER = 72, MAX = 120;

export function initPullToRefresh({ onRefreshed } = {}) {
  const ind = document.createElement("div");
  ind.className = "ptr"; ind.setAttribute("aria-hidden", "true");
  ind.innerHTML = `<svg class="ic" viewBox="0 0 24 24"><use href="#i-sync"/></svg>`;
  document.body.appendChild(ind);
  const views = document.getElementById("main");
  let y0 = null, x0 = 0, pull = 0, active = false, busy = false, decided = false;

  const set = (d, animate) => {
    const t = animate && !reduceMotion() ? "transform .25s cubic-bezier(.2,.8,.2,1)" : "none";
    ind.style.transition = t; views.style.transition = t;
    ind.style.transform = `translate(-50%, ${d - 48}px) rotate(${d * 3}deg)`;
    ind.style.opacity = Math.min(1, d / 40);
    views.style.transform = d ? `translateY(${d * .5}px)` : "";
    ind.classList.toggle("ready", d >= TRIGGER);
  };
  const blocked = t => !document.getElementById("layer").hidden || t.closest("input, textarea, select");

  window.addEventListener("touchstart", e => {
    if (busy || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; pull = 0; active = false; decided = false;
  }, { passive: true });

  window.addEventListener("touchmove", e => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!decided) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; decided = true; if (Math.abs(dx) > Math.abs(dy) || dy < 0) { y0 = null; return; } }
    if (window.scrollY > 0) { y0 = null; set(0, true); return; }
    active = true; e.preventDefault();
    pull = Math.min(MAX, dy * .55); set(pull, false);
  }, { passive: false });

  const end = async () => {
    if (y0 == null || !active) { y0 = null; return; }
    y0 = null; active = false;
    if (pull < TRIGGER) { set(0, true); return; }
    busy = true; set(56, true); ind.classList.add("spin");
    if (navigator.vibrate) navigator.vibrate(10);
    const started = Date.now();
    try {
      const reg = "serviceWorker" in navigator && await navigator.serviceWorker.getRegistration();
      if (reg) reg.update().catch(() => {});
      if (sync.user) await refresh();
    } finally {
      await new Promise(r => setTimeout(r, Math.max(0, 600 - (Date.now() - started))));
      ind.classList.remove("spin"); set(0, true); busy = false;
      if (onRefreshed) onRefreshed();
      if (!sync.configured) toast("Saved on this device");
      else if (!sync.user) toast("Sign in to sync your devices", { label: "Sign in", run: () => { location.hash = "#more"; setTimeout(() => document.querySelector('#view-more [data-open="auth"]')?.click(), 150); } });
      else if (sync.status === "ok") toast("Up to date");
      else toast(sync.detail || sync.text);
    }
  };
  window.addEventListener("touchend", end, { passive: true });
  window.addEventListener("touchcancel", () => { if (y0 != null) { y0 = null; active = false; set(0, true); } }, { passive: true });
}
