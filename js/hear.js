// The microphone, with AI: record what you say, send it to the "hear" function (OpenAI writes it down, in Finnish
// or English, and works out what you meant), and get back a purchase (with its lines), a question, a reminder or
// things for a list. Typed phrases the on-device rules can't read go the same way. Nothing is saved here: the add
// box shows what was heard first. Without a connection, or signed out, the phone's own listening is used instead.
import { store, todayISO } from "./data.js";
import { sync } from "./sync.js";
import { aiPossible, places } from "./receipts.js";

export const canRecord = () => !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
export const aiVoice = () => aiPossible() && canRecord();
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

/* Starts recording. stop() resolves with the recording; it also stops by itself after maxMs. */
export async function record({ maxMs = 20000, onStop } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = TYPES.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined), parts = [];
  let done, timer;
  const finished = new Promise(res => { done = res; });
  rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
  rec.onstop = () => { clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); const blob = new Blob(parts, { type: rec.mimeType || type || "audio/webm" }); done(blob); if (onStop) onStop(blob); };
  rec.start();
  timer = setTimeout(() => { if (rec.state === "recording") rec.stop(); }, maxMs);
  return { stop: () => { if (rec.state === "recording") rec.stop(); return finished; }, cancel: () => { parts.length = 0; if (rec.state === "recording") rec.stop(); } };
}

/* What was meant, from a recording or from text. */
export async function understand({ audio = null, text = "" } = {}) {
  const body = { lang: store.model.settings.voiceLang || "en-GB", today: todayISO(), categories: store.model.categories.map(c => c.name), places: places().map(p => p.name) };
  if (audio) { if (audio.size < 1200) throw Object.assign(new Error("Didn't hear anything. Hold the button a moment longer."), { code: "short" }); body.audio = await blobToDataURL(audio); }
  else body.text = text;
  const { data, error } = await sync.client.functions.invoke("hear", { body });
  if (error) {
    let info = {}; try { info = error.context && error.context.json ? await error.context.json() : {}; } catch {}
    throw Object.assign(new Error(info.error || (/Failed to fetch|network/i.test(error.message) ? "Couldn't reach Koti's AI." : error.message)), { code: info.code || "network" });
  }
  if (data && data.limit) { try { localStorage.setItem("koti.aiLimit", String(data.limit)); } catch {} }
  return data;
}

/* The answer, with names turned into this person's ids. */
export function toParsed(spend) {
  const cats = store.model.categories, P = places();
  const catId = n => (cats.find(c => c.name.toLowerCase() === String(n || "").toLowerCase()) || {}).id || null;
  const placeId = n => (P.find(p => p.name.toLowerCase() === String(n || "").toLowerCase()) || {}).id || null;
  const lines = (spend.lines || []).map(l => ({ name: l.name, nameFi: null, qty: null, price: l.price, categoryId: catId(l.category), placeId: placeId(l.place), itemId: null }));
  return { amount: spend.total, payee: spend.payee, date: spend.date || todayISO(), note: spend.note, categoryId: lines.length ? lines.slice().sort((a, b) => b.price - a.price)[0].categoryId : null, lines };
}
