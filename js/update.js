// Keeping Koti up to date: compares the published version with the one running and reloads into the new one.
import { isNative } from "./platform.js";
import { APP_VERSION } from "./version.js";
import { toast } from "./ui.js";

const sheetOpen = () => !document.getElementById("layer").hidden;

async function publishedVersion() {
  const r = await fetch("js/version.js?check=" + Date.now(), { cache: "no-store" });
  if (!r.ok) return null;
  const m = (await r.text()).match(/APP_VERSION = "([^"]+)"/);
  return m ? m[1] : null;
}

/* Reload once the new service worker is in charge (or after a short wait), so the fresh files are used. */
function reloadInto(version) {
  const key = "koti.reloadedFor";
  if (sessionStorage.getItem(key) === version) return false;   // already tried this version in this session: don't loop
  sessionStorage.setItem(key, version);
  toast("Updating Koti…");
  let done = false; const go = () => { if (!done) { done = true; location.reload(); } };
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("controllerchange", go, { once: true });
  setTimeout(go, 1500);
  return true;
}

/* Returns "updating", "latest", or "offline". manual: the person asked, so say what happened. */
export async function checkForUpdate({ manual = false, quiet = false } = {}) {
  if (isNative()) { if (manual) toastApp(); return; }   // the App Store updates the phone app
  if (!navigator.onLine) { if (manual) toast("You're offline. Koti checks for updates when you're back online."); return "offline"; }
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update().catch(() => {});
    const v = await publishedVersion();
    if (v && v !== APP_VERSION) {
      if (quiet && sheetOpen()) { toast("A new version of Koti is ready", { label: "Reload", run: () => reloadInto(v) || location.reload() }); return "updating"; }
      return reloadInto(v) ? "updating" : "latest";
    }
    if (manual) toast(`You have the latest version (${APP_VERSION})`);
    return "latest";
  } catch { if (manual) toast("Couldn't check for updates. Try again in a moment."); return "offline"; }
}

export function initUpdates() {
  if (isNative()) return;
  setTimeout(() => checkForUpdate({ quiet: true }), 3000);
  let last = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - last > 5 * 60 * 1000) { last = Date.now(); checkForUpdate({ quiet: true }); }
  });
}

function toastApp() { import("./ui.js").then(m => m.toast("Updates come from the App Store.")); }
