// What Koti learns from your corrections (9 November 2026). When you fix what Koti read or suggested, the fix is kept
// with your settings (settings.learned, synced, private to you) and used from then on:
//   shop       a shop name Koti read ("K-MARKET KAMPPI HKI 0123") and what you call it ("K-Market Kamppi")
//   category   the category you put a shop's purchases in, when it wasn't the one Koti suggested
//   date, amount   a date or total Koti read wrong. Kept as information for improving the reader; they change nothing.
// The fixes are applied on the phone after the AI answers, so they always win over the AI, and work offline too.
// What a receipt's lines go to is already learned from what you filed before (receipts.js, filedBefore).
import { store, newId, todayISO } from "./data.js";

export const LEARN_MAX = 150;
const norm = s => String(s || "").toLowerCase().replace(/\s+\d[\d\s]*$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export const learned = () => (Array.isArray(store.model.settings.learned) ? store.model.settings.learned : []).filter(x => x && x.kind);
const save = list => store.updateSettings({ learned: list.slice(-LEARN_MAX) });

/* One correction. The newest about the same thing replaces the older one. Returns it, or null when nothing changed. */
export function learn(kind, from, to, extra = {}) {
  const f = String(from ?? "").trim(), t = String(to ?? "").trim();
  if (!f || !t || (kind === "shop" ? f.toLowerCase() === t.toLowerCase() : kind === "category" ? false : f === t)) return null;
  const key = kind === "category" || kind === "shop" ? norm(f) : null;
  const rest = learned().filter(x => !(key && x.kind === kind && x.key === key));
  const item = { id: newId("lrn"), kind, from: f.slice(0, 120), to: t.slice(0, 120), key, at: todayISO(), ...extra };
  save([...rest, item]);
  return item;
}
export const forgetLearned = id => save(learned().filter(x => x.id !== id));

/* What you call a shop Koti read, or null. */
export function shopFor(read) {
  const k = norm(read); if (!k) return null;
  const hit = learned().filter(x => x.kind === "shop").reverse().find(x => x.key === k);
  return hit ? hit.to : null;
}
/* The category you put a shop in when you corrected Koti, as a category id (still one of yours), or null. */
export function categoryFor(payee) {
  const k = norm(payee); if (!k) return null;
  const hit = learned().filter(x => x.kind === "category").reverse().find(x => x.key === k);
  if (!hit) return null;
  const c = store.model.categories.find(x => x.id === hit.categoryId) || store.model.categories.find(x => x.name.toLowerCase() === hit.to.toLowerCase());
  return c ? c.id : null;
}

/* What Koti read against what you saved, for one purchase. Learns what was corrected. */
export function learnFromSave({ read = {}, saved = {} }) {
  const out = [];
  if (read.payee && saved.payee) out.push(learn("shop", read.payee, saved.payee));
  const shop = saved.payee || read.payee;
  if (shop && read.categoryId && saved.categoryId && read.categoryId !== saved.categoryId) {
    const c = store.model.categories.find(x => x.id === saved.categoryId);
    if (c) out.push(learn("category", shop, c.name, { categoryId: c.id }));
  }
  if (read.date && saved.date && read.date !== saved.date) out.push(learn("date", read.date, saved.date, { shop: shop || null }));
  if (read.amount != null && saved.amount != null && Math.abs(Number(read.amount) - Number(saved.amount)) >= 0.005) out.push(learn("amount", String(read.amount), String(saved.amount), { shop: shop || null }));
  return out.filter(Boolean);
}

/* Koti's reading, put right with what it learned: the shop's name and, when nothing more specific was read, its category. */
export function applyLearned(parsed) {
  if (!parsed) return parsed;
  const p = { ...parsed }, name = shopFor(p.payee);
  if (name) p.payee = name;
  const cat = categoryFor(p.payee);
  if (cat) { if (!p.lines || !p.lines.length || p.lines.length === 1) p.categoryId = cat; if (p.lines && p.lines.length === 1) p.lines = [{ ...p.lines[0], categoryId: cat }]; }
  return p;
}
