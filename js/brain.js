// Koti's brain, on the phone: talking to Koti (the "koti" Edge Function, supabase/functions/koti), what Koti
// remembers about you, the actions it proposes, and today's note on the Today screen.
//   ask()        sends what you said or typed, with the conversation so far, and gets an answer, follow-up questions
//                and actions. The server reads your own records itself (so the figures are the engine's, not the
//                phone's guess); anything waiting to upload is sent first so it sees what you just entered.
//   doAction()   carries out an action after you tap it: straight away with Undo for small things (a list, a reminder,
//                a goal, a budget, a memory), or through the sheet you'd use anyway for a purchase or a bill.
//   brief()      today's note: fetched once a day, kept on the phone, worked out again after midnight.
// The screens are in koti.js.
import { store, todayISO, newId, topLists, listOf } from "./data.js";
import { sync, flush } from "./sync.js";
import { aiPossible } from "./receipts.js";
import { shopFor, categoryFor } from "./learn.js";

export const MEMORY_MAX = 40;
const CHAT_KEY = "koti.chat", BRIEF_KEY = "koti.brief", FRESH_HOURS = 6;
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const lower = s => String(s || "").toLowerCase().trim();
const owner = () => (sync.user && sync.user.id) || "local";

/* ---------- What Koti remembers about you (settings.memory, synced like any setting) ---------- */
export const memory = () => (Array.isArray(store.model.settings.memory) ? store.model.settings.memory : []).filter(m => m && m.text);
export function remember(text) {
  const t = String(text || "").trim().slice(0, 200); if (!t) return null;
  const now = memory(); if (now.some(m => lower(m.text) === lower(t))) return null;
  const m = { id: newId("mem"), text: t, at: todayISO() };
  store.updateSettings({ memory: [...now, m].slice(-MEMORY_MAX) });
  return m;
}
export function forget(id) {
  const now = memory(), m = now.find(x => x.id === id); if (!m) return null;
  store.updateSettings({ memory: now.filter(x => x.id !== id) });
  return m;
}
const restoreMemory = list => store.updateSettings({ memory: list });

/* ---------- Conversations, kept on this phone for 30 days ---------- */
// The one you're in carries on while you keep talking; after six hours away a new one starts and the old one moves to
// Earlier chats. Up to 30 are kept, each for 30 days after it was last used, then deleted. They stay on this device
// (they aren't synced): Koti's memory of you (settings.memory) is what carries between conversations and devices.
// Before 9 November 2026 there was only one, and it was dropped silently after six hours.
const CHATS_KEY = "koti.chats", KEEP_DAYS = 30, KEEP_MAX = 30;
const titleOf = messages => { const m = messages.find(x => x.role === "user" && x.content); return m ? m.content.slice(0, 80) : "Conversation"; };
function chats() {
  let c = read(CHATS_KEY, null);
  if (!c || !Array.isArray(c.list)) c = { list: [], current: null };
  const old = read(CHAT_KEY, null);   // the single conversation kept before
  if (old && Array.isArray(old.messages) && old.messages.length) {
    c.list.push({ id: newId("chat"), owner: old.owner || "local", at: old.at || Date.now(), title: titleOf(old.messages), messages: old.messages });
    try { localStorage.removeItem(CHAT_KEY); } catch {}
    write(CHATS_KEY, c);
  }
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  c.list = c.list.filter(x => x && x.at >= cutoff && Array.isArray(x.messages) && x.messages.length).sort((a, b) => b.at - a.at).slice(0, KEEP_MAX);
  return c;
}
const saveChats = c => write(CHATS_KEY, c);
const mineOnly = c => c.list.filter(x => x.owner === owner());
/* The conversation you're in: the current one if used in the last six hours, otherwise a new one. */
export function conversation() {
  const c = chats(), cur = c.list.find(x => x.id === c.current && x.owner === owner());
  if (cur && Date.now() - cur.at <= FRESH_HOURS * 3600e3) return cur.messages;
  c.current = null; saveChats(c); return [];
}
export function saveConversation(messages) {
  const c = chats(), msgs = messages.slice(-40);
  if (!msgs.length) return;
  let cur = c.list.find(x => x.id === c.current && x.owner === owner());
  if (!cur) { cur = { id: newId("chat"), owner: owner() }; c.list.unshift(cur); c.current = cur.id; }
  Object.assign(cur, { at: Date.now(), title: titleOf(msgs), messages: msgs });
  saveChats(c);
}
export const newConversation = () => { const c = chats(); c.current = null; saveChats(c); };
/* Earlier chats: yours on this device, newest first, not the one you're in. */
export const pastConversations = () => { const c = chats(); return mineOnly(c).filter(x => x.id !== c.current).map(({ id, at, title, messages }) => ({ id, at, title, count: messages.length })); };
/* Opens an earlier chat to carry on with it. Returns its messages. */
export function openConversation(id) {
  const c = chats(), x = mineOnly(c).find(y => y.id === id); if (!x) return [];
  c.current = x.id; x.at = Date.now(); saveChats(c); return x.messages;
}
export const deleteConversation = id => { const c = chats(); c.list = c.list.filter(x => !(x.id === id && x.owner === owner())); if (c.current === id) c.current = null; saveChats(c); };
export const deleteAllConversations = () => { const c = chats(); c.list = c.list.filter(x => x.owner !== owner()); c.current = null; saveChats(c); };
/* What the server is sent of it: the words only, the last twelve turns. */
export const historyOf = messages => messages.filter(m => (m.role === "user" || m.role === "assistant") && m.content).slice(-12).map(m => ({ role: m.role, content: m.content }));

export const canAsk = () => aiPossible();
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

async function invoke(body) {
  try { await flush(); } catch {}   // what you just entered, so Koti sees it
  const { data, error } = await sync.client.functions.invoke("koti", { body: { lang: store.model.settings.voiceLang || "en-GB", today: todayISO(), ...body } });
  if (error) {
    let info = {}; try { info = error.context && error.context.json ? await error.context.json() : {}; } catch {}
    throw Object.assign(new Error(info.error || (/Failed to fetch|network/i.test(error.message) ? "Couldn't reach Koti. Check your connection." : error.message)), { code: info.code || "network" });
  }
  if (data && data.limit) { try { localStorage.setItem("koti.aiLimit", String(data.limit)); } catch {} }
  return data || {};
}

/* One turn: what you said (text or a recording) and the conversation before it. */
export async function ask({ message = "", audio = null, history = [], spoken = false }) {
  // spoken: the phone heard these words. With a recording it's spoken too. Only then does the answer come with a voice.
  const body = { mode: "chat", history: historyOf(history), ...(spoken && !audio ? { spoken: true } : {}) };
  if (audio) { if (audio.size < 1200) throw Object.assign(new Error("Didn't hear anything. Hold the button a moment longer."), { code: "short" }); body.audio = await blobToDataURL(audio); }
  else body.message = String(message).trim();
  const d = await invoke(body);
  autoApply(d.actions || []);
  return { heard: d.heard || null, reply: d.reply || "", speech: d.speech || null, followUps: d.followUps || [], actions: (d.actions || []).filter(a => !AUTO.has(a.type)), remembered: (d.actions || []).filter(a => AUTO.has(a.type)) };
}

/* Remembering and forgetting happen as soon as Koti says so: the chat shows it, with Undo. */
const AUTO = new Set(["remember", "forget"]);
function autoApply(actions) {
  actions.filter(a => AUTO.has(a.type)).forEach(a => {
    const before = memory().slice();
    if (a.type === "remember") { const m = remember(a.fact); a.done = !!m; }
    else { const m = memory().find(x => x.id === a.id) || memory().find(x => lower(x.text) === lower(a.fact)); a.done = !!(m && forget(m.id)); }
    a.undo = () => restoreMemory(before);
  });
}

/* ---------- Actions ---------- */
const catId = n => (store.model.categories.find(c => lower(c.name) === lower(n)) || {}).id || null;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const euro = v => "€" + (Number.isInteger(v) ? v : Number(v).toFixed(2));
const dayWords = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/* What a card says, and the word on its button. */
export function describeAction(a) {
  switch (a.type) {
    case "expense": return { title: `${euro(a.amount)}${a.payee ? ` at ${a.payee}` : ""}`, sub: [a.category, a.note, a.date !== todayISO() ? dayWords(a.date) : null, a.fromNextPay ? "from your next pay" : a.fromSavings ? `from ${a.goal || "savings"}` : null].filter(Boolean).join(" · "), button: "Save it", icon: "wallet" };
    case "list": return { title: a.items.map(i => (i.qty ? `${i.qty} × ${i.name}` : i.name)).join(", "), sub: `On ${a.list || "your shopping list"}`, button: "Add", icon: "list" };
    case "reminder": return { title: a.title, sub: a.when === "once" ? `${dayWords(a.date)} at ${a.hour}:00` : a.when === "monthly" ? `Every month on the ${ord(a.monthDay)} at ${a.hour}:00` : `Every ${DAYS[a.weekday]} at ${a.hour}:00`, button: "Remind me", icon: "bell" };
    case "bill": return { title: `${a.name}, ${euro(a.amount)}`, sub: `${a.frequency === "once" ? `Once, due ${dayWords(a.dueDate)}` : `${{ monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" }[a.frequency]}, due on the ${ord(a.dueDay)}`}${a.autopay ? " · direct debit" : ""}`, button: "Add bill", icon: "bill" };
    case "goal": return { title: `${a.name}: ${euro(a.target)}`, sub: [a.monthly ? `${euro(a.monthly)} a month` : null, a.targetDate ? `by ${dayWords(a.targetDate)}` : null].filter(Boolean).join(" · ") || "A savings goal", button: "Start saving", icon: "plan" };
    case "budget": return { title: `${a.category}: ${euro(a.amount)} a month`, sub: a.was != null ? `Was ${euro(a.was)}` : "No budget yet", button: "Set budget", icon: "budgets" };
    case "remember": return { title: a.fact, sub: "Koti will remember", button: null, icon: "spark" };
    case "forget": return { title: a.fact, sub: "Koti forgot this", button: null, icon: "spark" };
    default: return { title: "", sub: "", button: null, icon: "spark" };
  }
}

/* Carries out an action. Returns { done, message, undo } for the small ones; a purchase or a bill opens its sheet
   (filled in) and returns { opened: true }. */
export async function doAction(a) {
  if (a.type === "list") {
    let l = (a.list && store.model.lists.find(x => lower(x.name) === lower(a.list))) || topLists().find(x => x.kind === "shopping") || null;
    if (!l) { const id = newId("list"); store.put("lists", { id, name: "Groceries", kind: "shopping", position: store.model.lists.length }); l = listOf(id); }
    const added = a.items.map(x => store.addItem(l.id, x.name, "Soon", { qty: x.qty || null })).filter(Boolean);
    return { done: true, message: `Added to ${l.name}`, undo: () => added.forEach(it => store.deleteItem(it.id)) };
  }
  if (a.type === "reminder") {
    const r = store.put("reminders", { title: a.title, note: a.note || null, when: a.when, date: a.date, monthDay: a.monthDay, weekday: a.weekday, hour: a.hour, active: true, position: store.model.reminders.length });
    return { done: true, message: "Reminder set", undo: () => store.remove("reminders", r.id) };
  }
  if (a.type === "goal") {
    const g = store.put("goals", { name: a.name, target: a.target, saved: 0, monthly: a.monthly, targetDate: a.targetDate, position: store.model.goals.length });
    return { done: true, message: `${g.name} added to your goals`, undo: () => store.remove("goals", g.id) };
  }
  if (a.type === "budget") {
    const c = store.model.categories.find(x => lower(x.name) === lower(a.category)); if (!c) return { done: false, message: `There's no ${a.category} category any more.` };
    const before = { ...c }; store.put("categories", { ...c, budget: a.amount });
    return { done: true, message: `${c.name}: ${euro(a.amount)} a month`, undo: () => store.put("categories", before) };
  }
  if (a.type === "expense") {
    const m = await import("./composer.js");
    const payee = shopFor(a.payee) || a.payee;
    m.confirmSpend({ amount: a.amount, payee, date: a.date || todayISO(), note: a.note, categoryId: categoryFor(payee) || catId(a.category), fromNextPay: a.fromNextPay, fromSavings: a.fromSavings, goal: a.goal });
    return { opened: true };
  }
  if (a.type === "bill") {
    const m = await import("./plan.js");
    m.openBill(null, { name: a.name, amount: a.amount, frequency: a.frequency, dueDay: a.dueDay, dueDate: a.dueDate, autopay: a.autopay, anchorMonth: a.anchorMonth });
    return { opened: true };
  }
  return { done: false, message: "" };
}

/* ---------- Today's note ---------- */
/* The note kept for today, or null. */
export function cachedBrief() {
  const b = read(BRIEF_KEY, null);
  return b && b.day === todayISO() && b.owner === owner() ? b : null;
}
let briefing = null;
/* Today's note: from the phone if it was fetched today, otherwise asked for once (one AI use a day). */
export async function brief({ force = false } = {}) {
  const have = cachedBrief();
  if (have && !force) return have;
  if (!canAsk()) return have;
  if (briefing) return briefing;
  briefing = (async () => {
    try {
      const d = await invoke({ mode: "brief" });
      const b = { day: todayISO(), owner: owner(), at: Date.now(), notes: d.notes || [], followUps: d.followUps || [], actions: (d.actions || []).filter(a => !AUTO.has(a.type)) };
      write(BRIEF_KEY, b);
      return b;
    } catch (e) {
      // Out of AI uses or offline: don't ask again until tomorrow, quietly.
      if (e.code === "limit" || e.code === "no_key") write(BRIEF_KEY, { day: todayISO(), owner: owner(), at: Date.now(), notes: [], followUps: [], actions: [], off: e.code });
      return null;
    } finally { briefing = null; }
  })();
  return briefing;
}
export const dismissBriefAction = id => { const b = cachedBrief(); if (b) { b.actions = b.actions.filter(a => a.id !== id); write(BRIEF_KEY, b); } };

/* A question for Koti rather than something spent: ends with a question mark, or starts like one. */
export const looksLikeQuestion = t => /\?\s*$/.test(String(t)) || /^(how|what|why|when|where|which|who|can|could|should|shall|am|is|are|do|does|did|will|would|tell|show|explain|help|paljonko|kuinka|mitä|mikä|miksi|milloin|missä|voinko|pitäisikö|onko|olenko|kerro|näytä|auta)\b/i.test(String(t).trim());
