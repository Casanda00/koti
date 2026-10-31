// Receipts: shrink the photo, read it on the device (Tesseract, English + Finnish), keep it on the device
// until it's uploaded to the private "receipts" bucket, and show it again later.
import { store, topLists, roomsOf, itemsOf } from "./data.js";
import { sync, onSync } from "./sync.js";
import { KNOWN_PLACES, parseExpense } from "./voice.js";

const BUCKET = "receipts", TESS = "js/vendor/tesseract-7.0.0/";

/* ---------- Files kept on this device (IndexedDB) ---------- */
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open("koti-files", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction("files", mode), s = t.objectStore("files"); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
const putFile = (path, rec) => tx("readwrite", s => s.put(rec, path));
const getFile = path => tx("readonly", s => s.get(path));
const delFile = path => tx("readwrite", s => s.delete(path));
const allKeys = () => tx("readonly", s => s.getAllKeys());

/* ---------- Prepare: shrink photos, keep PDFs as they are ---------- */
export async function prepareFile(file) {
  if (file.type === "application/pdf") { if (file.size > 10 * 1024 * 1024) throw new Error("That PDF is over 10 MB."); return { blob: file, type: "application/pdf", ext: "pdf" }; }
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "")) throw new Error("Choose a photo or a PDF.");
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("This photo format can't be opened here. Take the photo with the Take photo button, or save it as JPEG.")); i.src = URL.createObjectURL(file); }); }
  const max = 1800, w0 = bmp.width, h0 = bmp.height, k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
  return { blob, type: "image/jpeg", ext: "jpg", canvas: c };
}

/* ---------- Read the receipt ---------- */
let workerP = null;
function loadScript(src) { return new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the receipt reader. Check your connection and try again.")); document.head.appendChild(s); }); }
async function worker(onProgress) {
  if (!workerP) workerP = (async () => {
    await loadScript(TESS + "tesseract.min.js");
    const base = new URL(TESS, location.href).href;
    return window.Tesseract.createWorker(["fin", "eng"], 1, {
      workerPath: base + "worker.min.js", corePath: base + "core", langPath: base + "lang", gzip: true,
      logger: m => { if (workerP.progress) workerP.progress(m); },
    });
  })().catch(e => { workerP = null; throw e; });
  workerP.progress = m => onProgress && onProgress(m);
  return workerP;
}
/* ---------- Read with AI (Edge Function read-receipt), falling back to the on-device reader ---------- */
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
/* Items still to buy on any list, for matching receipt lines to them. */
function openItems() {
  const out = []; topLists().forEach(l => { (l.kind === "project" ? [l, ...roomsOf(l.id)] : [l]).forEach(x => itemsOf(x.id).filter(i => !i.done).forEach(i => out.push(i))); });
  return out;
}
export const aiPossible = () => !!(sync.client && sync.user && navigator.onLine && sync.client.functions);
async function readWithAI(prepared) {
  const image = await blobToDataURL(prepared.blob);
  const cats = store.model.categories, open = openItems();
  const { data, error } = await sync.client.functions.invoke("read-receipt", { body: { image, categories: cats.map(c => c.name), listItems: [...new Set(open.map(i => i.name))] } });
  if (error) {
    let info = {}; try { info = error.context && error.context.json ? await error.context.json() : {}; } catch {}
    const e = new Error(info.error || (/Failed to fetch|network/i.test(error.message) ? "Couldn't reach the receipt reader." : error.message)); e.code = info.code || "network"; throw e;
  }
  const R = data.receipt, catId = name => (cats.find(c => c.name.toLowerCase() === String(name || "").toLowerCase()) || {}).id || null;
  const used = new Set();
  const lines = (R.items || []).map(x => {
    let itemId = null;
    if (x.list_item) { const hit = open.find(i => !used.has(i.id) && i.name.toLowerCase() === x.list_item.toLowerCase()); if (hit) { itemId = hit.id; used.add(hit.id); } }
    return { name: x.name, qty: x.qty, price: x.price, categoryId: catId(x.category), itemId };
  });
  const sums = {}; lines.forEach(l => { if (l.categoryId) sums[l.categoryId] = (sums[l.categoryId] || 0) + l.price; });
  let main = Object.entries(sums).sort((a, b) => b[1] - a[1])[0];
  const fromShop = R.shop ? parseExpense(R.shop, { categories: cats, history: store.model.transactions }).categoryId : null;
  return { text: "", ai: true, used: data.used, limit: data.limit, parsed: { amount: R.total, date: R.date, payee: R.shop, categoryId: main ? main[0] : fromShop, lines } };
}

export async function readReceipt(prepared, onProgress) {
  if (prepared.type === "application/pdf") return { text: "", parsed: {} };
  let aiError = null;
  if (aiPossible()) {
    try { if (onProgress) onProgress(0.25, "Reading every line with AI…"); const r = await readWithAI(prepared); if (onProgress) onProgress(1, "Done"); return r; }
    catch (e) { aiError = e; if (e.code === "not_receipt") throw e; }
  }
  const local = await readOnDevice(prepared, onProgress);
  return { ...local, aiError };
}
async function readOnDevice(prepared, onProgress) {
  const w = await worker(m => { if (!onProgress) return;
    if (m.status === "recognizing text") onProgress(0.35 + m.progress * 0.65, "Reading the receipt…");
    else onProgress(Math.min(0.35, (m.progress || 0) * 0.35), m.status && /load|init/i.test(m.status) ? "Getting the reader ready (first time only)…" : "Reading the receipt…"); });
  const { data } = await w.recognize(prepared.canvas || prepared.blob);
  return { text: data.text || "", parsed: parseReceipt(data.text || "") };
}

/* Finds the total, the date and the shop in receipt text. */
const TOTAL_WORDS = /(yhteens[äa]|yht\.?|summa|loppusumma|maksettava|total|amount due|to pay|kortti|pankkikortti|visa|mastercard|debit)/i;
const NOT_TOTAL = /(alv|vat|veroton|verollinen|netto|brutto|vaihtoraha|takaisin|change|saatu|alennus|discount|s[äa]{2}st|bonus)/i;
const MONEY = /(-?\d{1,5})\s?[.,]\s?(\d{2})(?!\d)/g;
export function parseReceipt(text, { categories = store.model.categories, history = store.model.transactions } = {}) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = { amount: null, date: null, payee: null, categoryId: null };
  const amountsIn = l => [...l.matchAll(MONEY)].map(m => Number(`${m[1]}.${m[2]}`)).filter(v => v > 0 && v < 100000);
  // total: the first "total"-type line with an amount; else the biggest amount on the receipt
  for (const l of lines) { if (TOTAL_WORDS.test(l) && !NOT_TOTAL.test(l)) { const a = amountsIn(l); if (a.length) { out.amount = a[a.length - 1]; break; } } }
  if (out.amount == null) { const all = lines.filter(l => !NOT_TOTAL.test(l)).flatMap(amountsIn); if (all.length) out.amount = Math.max(...all); }
  // date: 14.10.2026, 14.10.26, 14/10/2026, 2026-10-14
  const now = new Date();
  for (const l of lines) {
    let m = l.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/), y, mo, d;
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if ((m = l.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    if (m && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= now.getFullYear() + 1) { out.date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; break; }
  }
  // shop: a known chain anywhere, else the first line that looks like a name
  const k = KNOWN_PLACES.find(([, , re]) => re.test(text));
  const head = lines.slice(0, 6).find(l => /\p{L}{3,}/u.test(l) && (l.match(/\d/g) || []).length < 4 && !/kuitti|receipt|y-tunnus|puh|tel|www|http/i.test(l));
  if (k) {
    const line = lines.find(l => k[2].test(l));
    out.payee = line && line.length <= 40 ? titleCase(line.replace(/[^\p{L}\p{N}&' -]/gu, " ").replace(/\s+/g, " ").trim()) : k[0];
  } else if (head) out.payee = titleCase(head.replace(/[^\p{L}\p{N}&' -]/gu, " ").replace(/\s+/g, " ").trim()).slice(0, 60);
  // category from the shop (earlier expenses first, then known chains and words)
  if (out.payee) { const p = parseExpense(out.payee + " " + lines.slice(0, 12).join(" "), { categories, history }); out.categoryId = p.categoryId; if (p.payee && history.some(t => t.payee === p.payee)) out.payee = p.payee; }
  return out;
}
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Oy|Ab|Oyj)\b/g, x => x.toUpperCase() === "OYJ" ? "Oyj" : x.toUpperCase()); }

/* ---------- Store, upload, show ---------- */
const localPath = (txId, ext) => `local/${txId}.${ext}`;
const remotePath = (uid, txId, ext) => `${uid}/${txId}.${ext}`;
export const isPdf = path => /\.pdf$/i.test(path || "");

/* Keeps the file on this device and returns the path to save on the transaction. Upload happens in the background. */
export async function attach(txId, prepared) {
  const uid = sync.user && sync.user.id, path = uid ? remotePath(uid, txId, prepared.ext) : localPath(txId, prepared.ext);
  await putFile(path, { blob: prepared.blob, type: prepared.type, txId, ext: prepared.ext });
  setTimeout(uploadPending, 300);
  return path;
}
let uploading = false;
export async function uploadPending() {
  if (uploading || !sync.client || !sync.user || !navigator.onLine) return;
  uploading = true;
  try {
    const uid = sync.user.id;
    for (const path of await allKeys()) {
      if (!path.startsWith(uid + "/") && !path.startsWith("local/")) continue;
      const rec = await getFile(path); if (!rec || rec.uploaded) continue;
      const target = path.startsWith("local/") ? remotePath(uid, rec.txId, rec.ext) : path;
      const { error } = await sync.client.storage.from(BUCKET).upload(target, rec.blob, { contentType: rec.type, upsert: true });
      if (error) { console.warn("Receipt upload failed", error.message); continue; }
      await putFile(target, { ...rec, uploaded: true });   // keep a copy for quick viewing on this device
      if (target !== path) {
        await delFile(path);
        const t = store.model.transactions.find(x => x.id === rec.txId);
        if (t && t.receiptPath === path) store.put("transactions", { ...t, receiptPath: target });
      }
    }
  } finally { uploading = false; }
}
export async function pendingUploads() { const uid = sync.user && sync.user.id; let n = 0; for (const k of await allKeys()) { const r = await getFile(k); if (r && !r.uploaded && (k.startsWith("local/") || (uid && k.startsWith(uid + "/")))) n++; } return n; }

const urlCache = new Map();
export async function receiptURL(path) {
  if (!path) return null;
  const rec = await getFile(path).catch(() => null);
  if (rec && rec.blob) { if (!urlCache.has(path)) urlCache.set(path, URL.createObjectURL(rec.blob)); return urlCache.get(path); }
  if (!sync.client || !sync.user) return null;
  const { data, error } = await sync.client.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw new Error(/not found/i.test(error.message) ? "This receipt hasn't finished uploading from the other device yet." : error.message);
  return data.signedUrl;
}
export async function removeReceipt(path) {
  if (!path) return;
  await delFile(path).catch(() => {});
  if (urlCache.has(path)) { URL.revokeObjectURL(urlCache.get(path)); urlCache.delete(path); }
  if (sync.client && sync.user && path.startsWith(sync.user.id + "/")) await sync.client.storage.from(BUCKET).remove([path]).catch(() => {});
}

export function initReceipts() {
  onSync(s => { if (s.user && (s.status === "ok" || s.status === "busy")) setTimeout(uploadPending, 500); });
  window.addEventListener("online", () => setTimeout(uploadPending, 1000));
}
