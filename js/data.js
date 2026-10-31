// Koti data model, migrations from earlier versions, and the local store.
// The model mirrors the Supabase tables. Lists have a kind: "shopping" (a plain list you can send),
// "project" (has a budget and holds room/sub-lists, like Home setup) or "room" (a sub-list of a project).

export const PRIOS = ["Essential", "Soon", "Later"];

export const ZONES = {
  K:       { label: "Kitchen",     name: "Kitchen",       poly: [[80,530],[240,530],[240,840],[80,840]], lab: [144,566] },
  OH:      { label: "Living room", name: "Living room",   poly: [[80,248],[425,248],[425,640],[240,640],[240,530],[80,530]], lab: [104,292] },
  MH:      { label: "Bedroom",     name: "Bedroom",       poly: [[438,248],[660,248],[660,575],[438,575]], lab: [462,292] },
  KPH:     { label: "Bathroom",    name: "Bathroom",      poly: [[438,648],[660,648],[660,840],[438,840]], lab: [458,684] },
  ET:      { label: "Entrance",    name: "Entrance hall", poly: [[240,640],[425,640],[425,780],[240,780]], lab: [256,672] },
  PARVEKE: { label: "Balcony",     name: "Balcony",       poly: [[85,30],[645,30],[645,205],[85,205]], lab: [110,72] },
};
export const ZONE_ORDER = ["K", "OH", "MH", "KPH", "ET", "PARVEKE"];

const SEED = [
  ["Kitchen & cooking", "K", "Dish soap|Essential;Dishes and plates|Essential;Bowls|Essential;Cups and mugs|Essential;Spoons, forks and knives|Essential;Cooking spoon|Essential;Frying pan|Essential;Cooking pot|Essential;Kitchen knife|Essential;Chopping board|Essential;Spatula|Soon;Food storage containers|Soon;Dish drying rack|Soon;Colander / strainer|Soon;Baking items|Later;Oven tray|Later;Electric kettle|Soon"],
  ["Groceries & pantry", "K", "Cooking oil|Essential;Eggs|Essential;Sugar|Soon;Milk|Essential;Juice|Later;Salt|Essential;Seasoning|Essential;Sauces|Soon;Rice|Essential;Pasta|Soon;Bread|Essential;Butter|Soon;Tea or coffee|Soon;Fruits (bananas and others)|Essential;Yogurt|Soon;Pizza bites|Later;Onions, garlic and potatoes|Soon;Frozen vegetables|Soon"],
  ["Bathroom & personal care", "KPH", "Shower soap|Essential;Toothpaste|Essential;Shampoo and conditioner|Essential;Bath towels|Essential;Hand towels|Soon;Bath mat|Soon;Toilet paper|Essential;Toilet brush|Essential;Toilet cleaner|Soon;Hand soap|Essential;Bathroom bin|Soon;Napkins and paper towels|Soon"],
  ["Laundry & cleaning", "ET", "Laundry soap / detergent|Essential;Laundry basket|Soon;Drying rack|Essential;Clothes pegs|Later;Mop|Essential;Vacuum cleaner|Essential;Broom and dustpan|Soon;Cleaning cloths|Essential;Cleaning brush and sponge|Essential;Rubber gloves|Later;Floor cleaner|Soon;Window cleaner|Later;Trash bags|Essential;Waste bin|Essential"],
  ["Living room", "OH", "Blanket|Soon;Curtains|Soon;Storage boxes|Later;Sofa|Soon;Rug|Later;Floor lamp|Later"],
  ["Bedroom", "MH", "Bed and mattress|Essential;Bedsheets|Essential;Duvet|Essential;Duvet cover|Essential;Pillows|Essential;Pillowcases|Essential;Hangers|Essential;Bedside lamp|Later"],
  ["Tools & household", "ET", "Extension cord / power strip|Soon;Light bulbs|Soon;Scissors|Soon;Tape|Later;Screwdriver set|Soon;Measuring tape|Later;Batteries|Later;First aid kit|Soon;Small household bin|Soon;Doormat|Soon"],
];
const DEFAULT_ROOMS = { "Kitchen & cooking": "K", "Groceries & pantry": "K", "Living room": "OH", "Bedroom": "MH", "Bedroom & living": "MH", "Bathroom & personal care": "KPH", "Laundry & cleaning": "ET", "Tools & household": "ET" };
const DEFAULT_SETTINGS = { budget: 500, extraSpend: 0, carriedSpend: false, notes: "", movedIn: "", monthStart: 1, payday: "last", income: null, voiceLang: "en-GB", keepReceipts: false };
export const DEFAULT_CATEGORIES = [["Groceries", 400], ["Eating out", 120], ["Transport", 70], ["Shopping", 150], ["Health", 50], ["Fun", 100], ["Other", 60]];
export const HOME_SETUP_CAT = "home-setup";   // derived from checklist purchases, not stored
export const KINDS = ["lists", "items", "categories", "transactions", "bills", "goals", "income"];
export const LIST_KINDS = ["shopping", "project", "room"];
export const HOME_PROJECT = "proj-home-setup", HOME_PLAN = "koti-apartment";
export const INCOME_FREQS = ["monthly", "varies", "once"];
export const BILLS_CAT = "cat-bills";   // payments of bills, created from Plan
const EPOCH = new Date(0).toISOString();

export const slug = s => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
export const newId = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const now = () => new Date().toISOString();
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function cleanItem(i, listId, pos) {
  const price = i.price === null || i.price === undefined || i.price === "" || isNaN(Number(i.price)) ? null : Math.max(0, Number(i.price));
  return {
    id: String(i.id || newId("item")).slice(0, 120), listId: String(listId), name: String(i.name).slice(0, 200),
    priority: PRIOS.includes(i.priority) ? i.priority : "Soon", done: !!i.done, price,
    boughtAt: i.boughtAt ? String(i.boughtAt).slice(0, 10) : null, position: Number.isFinite(i.position) ? i.position : pos,
    qty: i.qty === null || i.qty === undefined || i.qty === "" || !(Number(i.qty) > 0) ? null : Math.round(Number(i.qty) * 100) / 100,
    note: i.note ? String(i.note).slice(0, 300) : null,
    updatedAt: i.updatedAt || EPOCH,
  };
}
function cleanList(l, pos) {
  const kind = LIST_KINDS.includes(l.kind) ? l.kind : "room";
  const budget = l.budget === null || l.budget === undefined || l.budget === "" || isNaN(Number(l.budget)) ? null : Math.max(0, Number(l.budget));
  return { id: String(l.id).slice(0, 80), name: String(l.name).slice(0, 120), room: ZONES[l.room] ? l.room : "OH", kind, parentId: kind === "room" && l.parentId ? String(l.parentId) : null,
    budget, extraSpend: Math.max(0, Number(l.extraSpend) || 0), plan: l.plan || null, position: Number.isFinite(l.position) ? l.position : pos, updatedAt: l.updatedAt || EPOCH };
}
function cleanIncome(x, pos) {
  const amount = x.amount === null || x.amount === undefined || x.amount === "" || isNaN(Number(x.amount)) ? null : Math.max(0, Number(x.amount));
  return { id: String(x.id || newId("inc")).slice(0, 80), name: String(x.name).slice(0, 80), amount, frequency: INCOME_FREQS.includes(x.frequency) ? x.frequency : "monthly",
    payDay: Math.min(31, Math.max(0, Math.round(Number(x.payDay) || 0))), expectedDate: x.expectedDate ? String(x.expectedDate).slice(0, 10) : null,
    payer: x.payer ? String(x.payer).slice(0, 120) : null, active: x.active !== false, position: Number.isFinite(x.position) ? x.position : pos, updatedAt: x.updatedAt || EPOCH };
}

function cleanCategory(c, pos) {
  const budget = c.budget === null || c.budget === undefined || c.budget === "" || isNaN(Number(c.budget)) ? null : Math.max(0, Number(c.budget));
  return { id: String(c.id).slice(0, 80), name: String(c.name).slice(0, 60), budget, position: Number.isFinite(c.position) ? c.position : pos, updatedAt: c.updatedAt || EPOCH };
}
export const TX_KINDS = ["expense", "income", "refund"];
function cleanTx(t) {
  return {
    id: String(t.id || newId("tx")).slice(0, 120), date: String(t.date).slice(0, 10), amount: Math.round(Math.abs(Number(t.amount)) * 100) / 100,
    kind: TX_KINDS.includes(t.kind) ? t.kind : "expense", categoryId: t.categoryId || null,
    payee: t.payee ? String(t.payee).slice(0, 120) : null, note: t.note ? String(t.note).slice(0, 500) : null,
    source: ["manual", "voice", "bank", "receipt"].includes(t.source) ? t.source : "manual",
    receiptPath: t.receiptPath || null, bankRef: t.bankRef || null, billId: t.billId || null, billDue: t.billDue ? String(t.billDue).slice(0, 10) : null,
    incomeId: t.incomeId || null, incomeDue: t.incomeDue ? String(t.incomeDue).slice(0, 10) : null,
    lines: Array.isArray(t.lines) && t.lines.length ? t.lines.slice(0, 150).map(l => ({ name: String(l.name || "Item").slice(0, 120), qty: Number(l.qty) > 0 ? Math.round(Number(l.qty) * 1000) / 1000 : null,
      price: Math.round((Number(l.price) || 0) * 100) / 100, categoryId: l.categoryId || null, itemId: l.itemId || null })) : null,
    updatedAt: t.updatedAt || EPOCH,
  };
}
export const FREQS = ["monthly", "quarterly", "yearly", "once"];
const num = (v, d = null) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
function cleanBill(b, pos) {
  if (b.frequency === "once" && !b.dueDate) b = { ...b, frequency: "monthly" };
  return { id: String(b.id || newId("bill")).slice(0, 80), name: String(b.name).slice(0, 80), amount: Math.round(Math.abs(num(b.amount, 0)) * 100) / 100,
    frequency: FREQS.includes(b.frequency) ? b.frequency : "monthly", dueDay: Math.min(31, Math.max(1, Math.round(num(b.dueDay, 1)))), anchorMonth: Math.min(12, Math.max(1, Math.round(num(b.anchorMonth, 1)))),
    autopay: !!b.autopay, autoThrough: b.autoThrough ? String(b.autoThrough).slice(0, 10) : null, active: b.active !== false,
    payee: b.payee ? String(b.payee).slice(0, 120) : null, note: b.note ? String(b.note).slice(0, 500) : null, position: Number.isFinite(b.position) ? b.position : pos,
    dueDate: b.dueDate ? String(b.dueDate).slice(0, 10) : null, reference: b.reference ? String(b.reference).slice(0, 60) : null, iban: b.iban ? String(b.iban).replace(/\s+/g, " ").trim().slice(0, 40) : null,
    dues: cleanDues(b.dues), updatedAt: b.updatedAt || EPOCH };
}
/* Per due date (YYYY-MM-DD): the amount on that month's bill, its reference and the saved document. */
function cleanDues(d) {
  const out = {}; if (!d || typeof d !== "object") return out;
  Object.keys(d).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-36).forEach(k => { const x = d[k] || {};
    const amount = Number(x.amount) > 0 ? Math.round(Number(x.amount) * 100) / 100 : null;
    out[k] = { amount, reference: x.reference ? String(x.reference).slice(0, 60) : null, docPath: x.docPath ? String(x.docPath).slice(0, 300) : null }; });
  return out;
}
function cleanGoal(g, pos) {
  return { id: String(g.id || newId("goal")).slice(0, 80), name: String(g.name).slice(0, 80), target: Math.max(0.01, num(g.target, 1)), saved: Math.max(0, num(g.saved, 0)),
    targetDate: g.targetDate ? String(g.targetDate).slice(0, 10) : null, monthly: num(g.monthly) == null ? null : Math.max(0, num(g.monthly)), position: Number.isFinite(g.position) ? g.position : pos, updatedAt: g.updatedAt || EPOCH };
}
export function seedCategories() { return DEFAULT_CATEGORIES.map(([name, budget], k) => cleanCategory({ id: "cat-" + slug(name), name, budget }, k)); }

const homeProject = (budget = 500, extraSpend = 0, t = EPOCH) => cleanList({ id: HOME_PROJECT, name: "Home setup", kind: "project", budget, extraSpend, plan: HOME_PLAN, room: "OH", position: 1, updatedAt: t }, 1);
export function seedModel() {
  const lists = [homeProject(), cleanList({ id: "list-groceries", name: "Groceries", kind: "shopping", position: 0, updatedAt: EPOCH }, 0)], items = [];
  SEED.forEach(([name, room, raw], li) => {
    const id = "list-" + slug(name);
    lists.push(cleanList({ id, name, room, kind: "room", parentId: HOME_PROJECT, position: li, updatedAt: EPOCH }, li));
    raw.split(";").forEach((x, k) => { const [n, p] = x.split("|"); items.push(cleanItem({ id: slug(name) + "--" + slug(n), name: n, priority: p }, id, k)); });
  });
  return { version: 3, lists, items, categories: seedCategories(), transactions: [], bills: [], goals: [], income: [], settings: { ...DEFAULT_SETTINGS, updatedAt: EPOCH } };
}

/* Version 2 (single-file dashboard / Google Sheets): categories with items + roomMap. */
export function fromV2(s) {
  const lists = [], items = [], used = new Set();
  (s.categories || []).forEach((c, li) => {
    if (!c || !c.name) return;
    let id = "list-" + slug(c.name); while (used.has(id)) id += "-2"; used.add(id);
    const room = (s.roomMap && ZONES[s.roomMap[c.name]]) ? s.roomMap[c.name] : (DEFAULT_ROOMS[c.name] || "OH");
    lists.push({ id, name: String(c.name), room, kind: "room", parentId: HOME_PROJECT, position: li, updatedAt: now() });
    (c.items || []).filter(i => i && i.name).forEach((i, k) => items.push({ ...cleanItem(i, id, k), updatedAt: now() }));
  });
  const settings = { ...DEFAULT_SETTINGS, budget: Number(s.budget) || 0, extraSpend: Number(s.extraSpend) || 0, carriedSpend: !!s.carriedSpend,
    notes: s.notes || "", movedIn: s.movedIn ? String(s.movedIn).slice(0, 10) : "", updatedAt: now() };
  lists.unshift(homeProject(settings.budget, settings.extraSpend, now()));
  return { version: 3, lists, items, settings };   // no categories/transactions: imports keep the current ones
}

/* Version 1 (first tracker): split "Bedroom & living", move old total into other spending. */
export function v1ToV2(old) {
  const cats = []; let doormat = null; const livingNames = ["blanket", "curtains", "storage boxes"];
  old.categories.forEach(c => {
    if (c.name !== "Bedroom & living") { cats.push({ name: c.name, items: c.items.map(i => ({ ...i })) }); return; }
    const liv = { name: "Living room", items: [] }, bed = { name: "Bedroom", items: [] };
    c.items.forEach(i => { const n = i.name.toLowerCase(); if (n === "doormat") doormat = { ...i }; else (livingNames.includes(n) ? liv : bed).items.push({ ...i }); });
    [["Sofa", "Soon"], ["Rug", "Later"], ["Floor lamp", "Later"]].forEach(([n, p]) => { if (!liv.items.some(i => i.name.toLowerCase() === n.toLowerCase())) liv.items.push({ id: "living-room--" + slug(n), name: n, priority: p, done: false }); });
    cats.push(liv, bed);
  });
  if (doormat) { const t = cats.find(c => c.name === "Tools & household") || cats.find(c => c.name === "Bedroom"); if (t) t.items.push(doormat); }
  const prior = Number(old.spent) || 0;
  return { version: 2, categories: cats, budget: old.budget ?? 500, extraSpend: prior, carriedSpend: prior > 0, notes: old.notes || "", roomMap: { ...DEFAULT_ROOMS } };
}

/* Accepts any earlier format (v1, v2, v3 backup) and returns a v3 model. */
export function toModel(data) {
  if (!data || typeof data !== "object") throw new Error("Not a Koti file.");
  if (data.version === 3 && Array.isArray(data.lists) && Array.isArray(data.items)) return normalizeModel(data);
  if (Array.isArray(data.categories)) return fromV2(data.version === 2 ? data : v1ToV2(data));
  throw new Error("Not a Koti file.");
}

export function normalizeModel(m) {
  const lists = (m.lists || []).filter(l => l && l.id && l.name).map((l, k) => cleanList(l, k));
  const ids = new Set(lists.map(l => l.id));
  const items = (m.items || []).filter(i => i && i.id && i.name && ids.has(String(i.listId))).map((i, k) => cleanItem(i, i.listId, k));
  const categories = (m.categories || []).filter(c => c && c.id && c.name).map((c, k) => cleanCategory(c, k));
  const transactions = (m.transactions || []).filter(t => t && t.id && t.date && Number(t.amount) > 0).map(cleanTx);
  const bills = (m.bills || []).filter(b => b && b.id && b.name && Number(b.amount) > 0).map((b, k) => cleanBill(b, k));
  const goals = (m.goals || []).filter(g => g && g.id && g.name && Number(g.target) > 0).map((g, k) => cleanGoal(g, k));
  const income = (m.income || []).filter(x => x && x.id && x.name).map((x, k) => cleanIncome(x, k));
  return { version: 3, lists, items, categories, transactions, bills, goals, income, settings: { ...DEFAULT_SETTINGS, ...(m.settings || {}), updatedAt: (m.settings && m.settings.updatedAt) || EPOCH } };
}

/* Brings older data into the Budgets/Income/Expenses shape. Same ids as the database migration, so devices agree.
   Returns the rows it changed, so they can be uploaded. */
export function upgradeModel(m) {
  const changed = { lists: [], income: [] }, t = now();
  const orphans = m.lists.filter(l => l.kind === "room" && !l.parentId);
  if (orphans.length && !m.lists.some(l => l.id === HOME_PROJECT)) {
    const p = homeProject(Number(m.settings.budget) || null, Number(m.settings.extraSpend) || 0, t); m.lists.unshift(p); changed.lists.push(p.id);
  }
  orphans.forEach(l => { if (l.id !== HOME_PROJECT) { l.parentId = HOME_PROJECT; l.updatedAt = t; changed.lists.push(l.id); } });
  if (m.settings.income != null && m.settings.income !== "" && !m.income.some(x => x.id === "inc-salary") && !m.income.length) {
    m.income.push(cleanIncome({ id: "inc-salary", name: "Salary", amount: Number(m.settings.income), frequency: "monthly", payDay: m.settings.payday === "last" || !m.settings.payday ? 0 : Number(m.settings.payday), updatedAt: t }, 0));
    changed.income.push("inc-salary");
  }
  return changed;
}

/* ---------- Store ---------- */
const MODEL_KEY = "koti.model", META_KEY = "koti.meta";
const emptyMeta = () => ({ owner: null, pending: { lists: {}, items: {}, categories: {}, transactions: {}, bills: {}, goals: {}, income: {}, settings: false }, lastSync: { lists: null, items: null, categories: null, transactions: null, bills: null, goals: null, income: null, settings: null }, tomb: { lists: {}, items: {}, categories: {}, transactions: {}, bills: {}, goals: {}, income: {} } });
function fixMeta(m) { const e = emptyMeta(); m = Object.assign(e, m || {}); ["pending", "lastSync", "tomb"].forEach(k => { m[k] = Object.assign(emptyMeta()[k], m[k] || {}); }); return m; }
const listeners = new Set();

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

function loadInitial() {
  const m = readJSON(MODEL_KEY);
  if (m && m.version === 3) {
    const model = normalizeModel(m);
    if (!Array.isArray(m.categories)) { model.categories = seedCategories().map(c => ({ ...c, updatedAt: now() })); return { model, migrated: false, newCategories: true }; }
    return { model, migrated: false };
  }
  // Earlier versions on this same site
  const v2 = readJSON("kotiTracker_v2");
  const withMoney = m => ({ ...m, categories: seedCategories().map(c => ({ ...c, updatedAt: now() })), transactions: [], bills: [], goals: [], income: [] });
  if (v2 && Array.isArray(v2.categories)) return { model: normalizeModel(withMoney(fromV2(v2))), migrated: true };
  const v1 = readJSON("newHomeTracker_v1");
  if (v1 && Array.isArray(v1.categories)) return { model: normalizeModel(withMoney(fromV2(v1ToV2(v1)))), migrated: true };
  return { model: seedModel(), migrated: false };
}

const init = loadInitial();
export const store = {
  model: init.model,
  meta: fixMeta(readJSON(META_KEY)),
  migrated: init.migrated,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(kind = "local") { listeners.forEach(fn => fn(kind)); },
  persist() { writeJSON(MODEL_KEY, this.model); writeJSON(META_KEY, this.meta); },
  hasUserData() { return this.model.items.some(i => i.done || i.price != null) || this.model.settings.notes || this.model.items.some(i => i.id.startsWith("item-")); },

  /* ---- local mutations: stamp, mark pending, save, notify ---- */
  touch(kind, id) { if (kind === "settings") this.meta.pending.settings = true; else this.meta.pending[kind][id] = true; },
  commit() { this.persist(); this.emit("local"); },

  addItem(listId, name, priority = "Soon", extra = {}) {
    const pos = Math.max(-1, ...this.model.items.filter(i => i.listId === listId).map(i => i.position)) + 1;
    const it = cleanItem({ id: newId("item"), name, priority, ...extra }, listId, pos); it.updatedAt = now();
    this.model.items.push(it); this.touch("items", it.id); this.commit(); return it;
  },
  updateItem(id, patch) {
    const it = this.model.items.find(i => i.id === id); if (!it) return;
    Object.assign(it, patch);
    if ("done" in patch) it.boughtAt = patch.done ? (patch.boughtAt || it.boughtAt || todayISO()) : null;
    it.updatedAt = now(); this.touch("items", id); this.commit();
  },
  deleteItem(id) {
    const it = this.model.items.find(i => i.id === id); if (!it) return null;
    this.model.items = this.model.items.filter(i => i.id !== id);
    
    this.meta.tomb.items[id] = { ...it, deleted: true, updatedAt: now() };
    this.touch("items", id); this.commit(); return it;
  },
  restoreItem(it) { it.updatedAt = now(); this.model.items.push(it); delete this.meta.tomb.items[it.id]; this.touch("items", it.id); this.commit(); },
  addList(name, room, extra = {}) {
    let id = "list-" + slug(name); if (this.model.lists.some(l => l.id === id) || this.meta.tomb.lists[id]) id = newId("list");
    const l = cleanList({ kind: "room", parentId: HOME_PROJECT, ...extra, id, name, room, position: this.model.lists.length, updatedAt: now() }, this.model.lists.length);
    this.model.lists.push(l); this.touch("lists", id); this.commit(); return l;
  },
  updateList(id, patch) { const i = this.model.lists.findIndex(x => x.id === id); if (i < 0) return; this.model.lists[i] = cleanList({ ...this.model.lists[i], ...patch, updatedAt: now() }, i); this.touch("lists", id); this.commit(); },
  deleteList(id) {
    const l = this.model.lists.find(x => x.id === id); if (!l) return;
    this.model.lists.filter(x => x.parentId === id).forEach(r => this.deleteList(r.id));   // a project takes its rooms with it
    
    this.model.items.filter(i => i.listId === id).forEach(i => { this.meta.tomb.items[i.id] = { ...i, deleted: true, updatedAt: now() }; this.touch("items", i.id); });
    this.model.items = this.model.items.filter(i => i.listId !== id);
    this.model.lists = this.model.lists.filter(x => x.id !== id);
    this.meta.tomb.lists[id] = { ...l, deleted: true, updatedAt: now() }; this.touch("lists", id); this.commit();
  },
  updateSettings(patch) { Object.assign(this.model.settings, patch, { updatedAt: now() }); this.touch("settings"); this.commit(); },

  /* Generic rows (categories, transactions) */
  put(kind, obj) {
    const arr = this.model[kind], i = arr.findIndex(x => x.id === obj.id);
    const clean = ({ transactions: o => cleanTx(o), categories: o => cleanCategory(o, arr.length), bills: o => cleanBill(o, arr.length), goals: o => cleanGoal(o, arr.length), income: o => cleanIncome(o, arr.length), lists: o => cleanList(o, arr.length) })[kind]({ ...obj, updatedAt: now() });
    if (i >= 0) arr[i] = clean; else arr.push(clean);
    delete this.meta.tomb[kind][clean.id]; this.touch(kind, clean.id); this.commit(); return clean;
  },
  remove(kind, id) {
    const arr = this.model[kind], obj = arr.find(x => x.id === id); if (!obj) return null;
    this.model[kind] = arr.filter(x => x.id !== id);
    this.meta.tomb[kind][id] = { ...obj, deleted: true, updatedAt: now() }; this.touch(kind, id); this.commit(); return obj;
  },
  /* Replace everything (restore, import, start over). Marks all rows for upload and deletes rows that disappear. */
  replaceAll(model) {
    const old = this.model; const m = normalizeModel(model); const t = now();
    
    if (!Array.isArray(model.categories)) m.categories = old.categories.map(c => ({ ...c }));       // older backups: keep current categories
    ["transactions", "bills", "goals", "income"].forEach(k => { if (!Array.isArray(model[k])) m[k] = old[k].map(x => ({ ...x })); });
    KINDS.forEach(kind => {
      const keep = new Set(m[kind].map(x => x.id));
      old[kind].forEach(x => { if (!keep.has(x.id)) { this.meta.tomb[kind][x.id] = { ...x, deleted: true, updatedAt: t }; this.touch(kind, x.id); } });
      m[kind].forEach(x => { x.updatedAt = t; this.touch(kind, x.id); });
    });
    m.settings.updatedAt = t; this.touch("settings");
    this.model = m; this.commit();
  },
  /* Forget local data entirely (used when a different account signs in on this device). */
  resetLocal(model) { this.model = normalizeModel(model); this.meta = emptyMeta(); this.persist(); this.emit("remote"); },
  markAllPending() { KINDS.forEach(kind => this.model[kind].forEach(x => this.touch(kind, x.id))); this.touch("settings"); this.persist(); },
  upgrade() { const c = upgradeModel(this.model); c.lists.forEach(id => this.touch("lists", id)); c.income.forEach(id => this.touch("income", id)); if (c.lists.length || c.income.length) this.commit(); return c; },
  seedCategoriesIfEmpty() { if (this.model.categories.length) return false; this.model.categories = seedCategories().map(c => ({ ...c, updatedAt: now() })); this.model.categories.forEach(c => this.touch("categories", c.id)); this.commit(); return true; },
};
if (store.migrated) { store.markAllPending(); store.persist(); }
if (init.newCategories) { store.model.categories.forEach(c => store.touch("categories", c.id)); store.persist(); }
{ const c = upgradeModel(store.model); c.lists.forEach(id => store.touch("lists", id)); c.income.forEach(id => store.touch("income", id)); store.persist(); }

/* ---------- Derived values ---------- */
export const listOf = id => store.model.lists.find(l => l.id === id);
const byPos = (a, b) => a.position - b.position || a.name.localeCompare(b.name);
export const sortedLists = () => [...store.model.lists].sort(byPos);
export const topLists = () => store.model.lists.filter(l => l.kind !== "room").sort(byPos);          // cards under Expenses
export const roomsOf = pid => store.model.lists.filter(l => l.parentId === pid).sort(byPos);
export const projectOf = listId => { const l = listOf(listId); if (!l) return null; return l.kind === "project" ? l : l.parentId ? listOf(l.parentId) : null; };
export const projectItems = pid => { const ids = new Set([pid, ...roomsOf(pid).map(r => r.id)]); return store.model.items.filter(i => ids.has(i.listId)); };
/* Items a receipt line paid for. Their cost is counted once, from the receipt, so the item's own price is skipped. */
export const paidByReceipt = () => { const s = new Set(); store.model.transactions.forEach(t => (t.lines || []).forEach(l => { if (l.itemId) s.add(l.itemId); })); return s; };
/* A project's spending: its bought items, its other spending, and receipt lines assigned to it. */
export const projectSpent = pid => { const paid = paidByReceipt(); return projectItems(pid).filter(i => i.done && i.price > 0 && !paid.has(i.id)).reduce((a, i) => a + i.price, 0) + (Number((listOf(pid) || {}).extraSpend) || 0)
  + store.model.transactions.reduce((a, t) => a + (t.lines || []).filter(l => l.categoryId === "proj:" + pid).reduce((b, l) => b + l.price, 0), 0); };
export const itemsOf = listId => store.model.items.filter(i => i.listId === listId).sort((a, b) => a.position - b.position);
export function zoneStats(pid = HOME_PROJECT) {
  const z = {}; ZONE_ORDER.forEach(k => z[k] = { code: k, lists: [], total: 0, done: 0, ess: 0, spent: 0, priced: 0 });
  const roomOf = {}; roomsOf(pid).forEach(l => { roomOf[l.id] = l.room; z[l.room].lists.push(l.name); });
  store.model.items.forEach(i => { const s = z[roomOf[i.listId]]; if (!s) return; s.total++; if (i.done) { s.done++; if (i.price > 0) { s.spent += i.price; s.priced++; } } else if (i.priority === "Essential") s.ess++; });
  return z;
}
export function backupJSON() { const { version, lists, items, categories, transactions, bills, goals, income, settings } = store.model; return JSON.stringify({ version, exportedAt: now(), lists, items, categories, transactions, bills, goals, income, settings }, null, 2); }
