// Reminders: push notifications for bills, paydays and budgets. Each phone turns them on for itself;
// which reminders you get is a setting that follows your account.
import { store } from "./data.js";
import { $, $$, esc, icon, toast } from "./ui.js";
import { sync } from "./sync.js";

const TYPES = [
  ["bills", "Bills due", "The morning before, with the reference to copy"],
  ["overdue", "Late bills", "The day after, 3 days later, then once a week"],
  ["payday", "Did your pay land?", "The morning after payday, if you haven't said yet"],
  ["budget", "Running low", "Once a month, when a category reaches 85%"],
  ["weekly", "Your week", "Sunday evening: what you spent and what's due next week"],
  ["tight", "Money's tight", "Once a month, when Now turns orange or red"],
  ["autopay", "Pays itself", "The morning before an automatic bill, if your account may not cover it"],
  ["plan", "Plan the month", "On the day your pay lands"],
  ["lists", "List changes", "When someone adds to a list through its shared link"],
];
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const standaloneIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(matchMedia("(display-mode: standalone)").matches || navigator.standalone);
const b64ToBytes = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const bytesTo64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function current() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(); if (!reg) return null;
  return reg.pushManager.getSubscription();
}
async function call(body) {
  const { data, error } = await sync.client.functions.invoke("send-reminders", { body });
  if (error) { let info = {}; try { info = error.context && error.context.json ? await error.context.json() : {}; } catch {} throw new Error(info.error || error.message); }
  return data;
}
export async function turnOn() {
  if (!sync.user) throw new Error("Sign in first, so reminders know whose bills to check.");
  if (standaloneIOS()) throw new Error("On iPhone, add Koti to your home screen first, then turn reminders on from there.");
  if (!supported()) throw new Error("This browser can't receive reminders.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for Koti. Allow them in your phone's settings, then try again." : "Reminders need your permission.");
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await call({ action: "key" });
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey && bytesTo64(sub.options.applicationServerKey) !== publicKey) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const j = sub.toJSON();
  const { error } = await sync.client.from("push_subscriptions").upsert({ user_id: sync.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 300) }, { onConflict: "user_id,endpoint" });
  if (error) throw new Error(error.message);
}
export async function turnOff() {
  const sub = await current(); if (!sub) return;
  const endpoint = sub.endpoint; await sub.unsubscribe().catch(() => {});
  if (sync.client && sync.user) await sync.client.from("push_subscriptions").delete().eq("user_id", sync.user.id).eq("endpoint", endpoint);
}

export async function renderReminders(el) {
  const R = { bills: true, overdue: true, payday: true, budget: true, weekly: false, tight: true, autopay: false, plan: false, lists: true, quietFrom: 21, quietTo: 8, billHour: 9, ...(store.model.settings.reminders || {}) };
  const sub = await current().catch(() => null), on = !!sub && Notification.permission === "granted";
  const why = !supported() ? (standaloneIOS() ? "On iPhone, add Koti to your home screen (iOS 16.4 or later), then turn this on there." : "This browser can't receive reminders.") : !sync.user ? "Sign in to use reminders." : Notification.permission === "denied" ? "Notifications are blocked. Allow them for Koti in your phone's settings." : "";
  const hours = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}"${Number(sel) === h ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("");
  el.innerHTML = `<div class="mhead"><h2>From Koti</h2></div>
    <div class="grp">
      <label class="row"><span class="ico g">${icon("bell")}</span><span class="rt">Reminders on this phone<small>${on ? "On" : why || "Off"}</small></span>${standaloneIOS() ? `<button type="button" class="pill" id="rmHow">Show me how</button>` : `<input type="checkbox" class="switch" id="rmOn" ${on ? "checked" : ""} ${why && !on ? "disabled" : ""}>`}</label>
      ${TYPES.map(([k, t, sub]) => `<label class="row"><span class="rt">${t}<small>${sub}${k === "bills" || k === "payday" || k === "overdue" ? ` · ${String(R.billHour).padStart(2, "0")}:00` : ""}</small></span><input type="checkbox" class="switch" data-rm="${k}" ${R[k] ? "checked" : ""}></label>`).join("")}
      <label class="row"><span class="rt">Morning reminders at</span><select class="inl" data-rmh="billHour">${hours(R.billHour)}</select></label>
      <div class="row"><span class="rt">Quiet hours<small>No reminders in between</small></span><select class="inl" data-rmh="quietFrom" aria-label="Quiet from">${hours(R.quietFrom)}</select><span class="muted">–</span><select class="inl" data-rmh="quietTo" aria-label="Quiet until">${hours(R.quietTo)}</select></div>
      ${on ? `<button type="button" class="row" id="rmTest"><span class="rt">Send a test reminder</span><span class="rv lnk">Send</span></button>` : ""}
      <label class="row"><span class="rt">Language<small>For reminders, and what the microphone listens for</small></span><select class="inl" id="rmLang"><option value="en-GB"${String(store.model.settings.voiceLang || "en-GB").startsWith("fi") ? "" : " selected"}>English</option><option value="fi-FI"${String(store.model.settings.voiceLang || "").startsWith("fi") ? " selected" : ""}>Suomi</option></select></label>
    </div>`;
  const save = patch => store.updateSettings({ reminders: { ...R, ...patch } });
  $$("[data-rm]", el).forEach(x => x.onchange = () => save({ [x.dataset.rm]: x.checked }));
  $$("[data-rmh]", el).forEach(x => x.onchange = () => save({ [x.dataset.rmh]: Number(x.value) }));
  $("#rmLang", el).onchange = e => { store.updateSettings({ voiceLang: e.target.value }); toast(e.target.value.startsWith("fi") ? "Muistutukset tulevat suomeksi" : "Reminders will come in English"); };
  const how = $("#rmHow", el); if (how) how.onclick = e => { e.preventDefault(); import("./install.js").then(m => m.openInstall({ reason: "reminders" })); };
  if ($("#rmOn", el)) $("#rmOn", el).onchange = async e => {
    const want = e.target.checked; e.target.disabled = true;
    try { if (want) { await turnOn(); toast("Reminders are on for this phone"); } else { await turnOff(); toast("Reminders are off for this phone"); } }
    catch (err) { toast(String(err.message || err)); }
    renderReminders(el);
  };
  const t = $("#rmTest", el); if (t) t.onclick = async () => { try { const r = await call({ action: "test" }); toast(r.sent ? "Test sent. It should arrive in a few seconds." : "Couldn't reach this phone. Turn reminders off and on again."); } catch (err) { toast(String(err.message || err)); } };
}
