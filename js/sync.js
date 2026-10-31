// Sync between this device and Supabase.
// Local-first: every change is saved on the device and queued; the queue is uploaded when online and signed in.
// Pulls fetch rows changed since the last pull (by the server's synced_at); realtime pushes changes from other devices.
// Conflicts: the newer updated_at wins, row by row.
import { store, now, seedModel } from "./data.js";

const CFG = window.KOTI_CONFIG || {};
const listeners = new Set();
export const sync = { status: "local", text: "Saved on this device", detail: "", lastSync: null, user: null, configured: !!(CFG.url && CFG.key), client: null };
export function onSync(fn) { listeners.add(fn); fn(sync); return () => listeners.delete(fn); }
function setStatus(status, text, detail = "") { Object.assign(sync, { status, text, detail }); listeners.forEach(f => f(sync)); }

const TABLES = ["lists", "items", "categories", "transactions", "bills", "goals", "income", "settings"];
const ROWS = ["lists", "items", "categories", "transactions", "bills", "goals", "income"];
const TABLE = k => ({ income: "income_sources" }[k] || k);   // model key → database table
const t = s => (s ? Date.parse(s) : 0);
const rowOfList = (l, uid) => ({ user_id: uid, id: l.id, name: l.name, room: l.room, kind: l.kind || "room", parent_id: l.parentId || null, budget: l.budget ?? null, extra_spend: l.extraSpend || 0, plan: l.plan || null, category_id: l.categoryId || null, position: l.position, deleted: !!l.deleted, updated_at: l.updatedAt });
const rowOfItem = (i, uid) => ({ user_id: uid, id: i.id, list_id: i.listId, name: i.name, priority: i.priority, done: !!i.done, price: i.price, bought_at: i.boughtAt, qty: i.qty ?? null, note: i.note || null, position: i.position, deleted: !!i.deleted, updated_at: i.updatedAt });
const listFromRow = r => ({ id: r.id, name: r.name, room: r.room, kind: r.kind || "room", parentId: r.parent_id || null, budget: r.budget == null ? null : Number(r.budget), extraSpend: Number(r.extra_spend) || 0, plan: r.plan || null, categoryId: r.category_id || null, position: r.position, updatedAt: r.updated_at });
const incOfRow = r => ({ id: r.id, name: r.name, amount: r.amount == null ? null : Number(r.amount), frequency: r.frequency, payDay: r.pay_day, expectedDate: r.expected_date, payer: r.payer, active: r.active !== false, position: r.position, endDate: r.end_date || null, missed: Array.isArray(r.missed) ? r.missed : [], updatedAt: r.updated_at });
const rowOfInc = (x, uid) => ({ user_id: uid, id: x.id, name: x.name, amount: x.amount, frequency: x.frequency, pay_day: x.payDay, expected_date: x.expectedDate, payer: x.payer, active: x.active !== false, position: x.position, end_date: x.endDate || null, missed: x.missed || [], deleted: !!x.deleted, updated_at: x.updatedAt });
const catOfRow = r => ({ id: r.id, name: r.name, budget: r.budget == null ? null : Number(r.budget), position: r.position, updatedAt: r.updated_at });
const rowOfCat = (c, uid) => ({ user_id: uid, id: c.id, name: c.name, budget: c.budget, position: c.position, deleted: !!c.deleted, updated_at: c.updatedAt });
const txOfRow = r => ({ id: r.id, date: r.date, amount: Number(r.amount), kind: r.kind, categoryId: r.category_id, payee: r.payee, note: r.note, source: r.source, receiptPath: r.receipt_path, bankRef: r.bank_ref, billId: r.bill_id || null, billDue: r.bill_due || null, incomeId: r.income_id || null, incomeDue: r.income_due || null, lines: Array.isArray(r.lines) ? r.lines : null, updatedAt: r.updated_at });
const rowOfTx = (t, uid) => ({ user_id: uid, id: t.id, date: t.date, amount: t.amount, kind: t.kind, category_id: t.categoryId, payee: t.payee, note: t.note, source: t.source, receipt_path: t.receiptPath, bank_ref: t.bankRef, bill_id: t.billId || null, bill_due: t.billDue || null, income_id: t.incomeId || null, income_due: t.incomeDue || null, lines: t.lines && t.lines.length ? t.lines : null, deleted: !!t.deleted, updated_at: t.updatedAt });
const billOfRow = r => ({ id: r.id, name: r.name, amount: Number(r.amount), frequency: r.frequency, dueDay: r.due_day, anchorMonth: r.anchor_month, autopay: !!r.autopay, autoThrough: r.auto_through, active: r.active !== false, payee: r.payee, note: r.note, position: r.position, dueDate: r.due_date || null, startDate: r.start_date || null, endDate: r.end_date || null, reference: r.reference || null, iban: r.iban || null, dues: r.dues || {}, updatedAt: r.updated_at });
const rowOfBill = (b, uid) => ({ user_id: uid, id: b.id, name: b.name, amount: b.amount, frequency: b.frequency, due_day: b.dueDay, anchor_month: b.anchorMonth, autopay: !!b.autopay, auto_through: b.autoThrough, active: b.active !== false, payee: b.payee, note: b.note, position: b.position, due_date: b.dueDate || null, start_date: b.startDate || null, end_date: b.endDate || null, reference: b.reference || null, iban: b.iban || null, dues: b.dues || {}, deleted: !!b.deleted, updated_at: b.updatedAt });
const goalOfRow = r => ({ id: r.id, name: r.name, target: Number(r.target), saved: Number(r.saved), targetDate: r.target_date, monthly: r.monthly == null ? null : Number(r.monthly), position: r.position, updatedAt: r.updated_at });
const rowOfGoal = (g, uid) => ({ user_id: uid, id: g.id, name: g.name, target: g.target, saved: g.saved, target_date: g.targetDate, monthly: g.monthly, position: g.position, deleted: !!g.deleted, updated_at: g.updatedAt });
const TO_ROW = { lists: rowOfList, items: rowOfItem, categories: rowOfCat, transactions: rowOfTx, bills: rowOfBill, goals: rowOfGoal, income: rowOfInc };
const FROM_ROW = { lists: r => listFromRow(r), items: r => itemFromRow(r), categories: catOfRow, transactions: txOfRow, bills: billOfRow, goals: goalOfRow, income: incOfRow };
const itemFromRow = r => ({ id: r.id, listId: r.list_id, name: r.name, priority: r.priority, done: !!r.done, price: r.price == null ? null : Number(r.price), boughtAt: r.bought_at, qty: r.qty == null ? null : Number(r.qty), note: r.note || null, position: r.position, updatedAt: r.updated_at });

/* ---------- Apply rows from the server ---------- */
export function applyRows(kind, rows) {
  let changed = false;
  const m = store.model, meta = store.meta;
  for (const r of rows) {
    if (!r) continue;
    if (kind === "settings") {
      if (meta.pending.settings && t(m.settings.updatedAt) >= t(r.updated_at)) continue;
      m.settings = { ...m.settings, ...(r.data || {}), updatedAt: r.updated_at };
      meta.pending.settings = false; changed = true; continue;
    }
    const arr = m[kind];
    const idx = arr.findIndex(x => x.id === r.id);
    const local = idx >= 0 ? arr[idx] : meta.tomb && meta.tomb[kind] && meta.tomb[kind][r.id];
    if (meta.pending[kind][r.id] && local && t(local.updatedAt) >= t(r.updated_at)) continue; // ours is newer; it will upload
    if (!meta.pending[kind][r.id] && local && idx >= 0 && t(local.updatedAt) === t(r.updated_at) && !r.deleted) continue; // already have it
    delete meta.pending[kind][r.id];
    if (meta.tomb && meta.tomb[kind]) delete meta.tomb[kind][r.id];
    if (r.deleted) { if (idx >= 0) { arr.splice(idx, 1); changed = true; } continue; }
    const obj = FROM_ROW[kind](r);
    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
    changed = true;
  }
  if (changed) { store.persist(); store.emit("remote"); }
  return changed;
}

/* ---------- Errors ---------- */
function explain(e) {
  const msg = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return ["offline", "Offline", "Changes are saved on this device and will upload when you're back online."];
  if (/JWT|token|not authenticated|401|refresh/i.test(msg)) return ["error", "Sign in again", "Your session ended. Sign in again in More to keep syncing."];
  if ((e && (e.code === "42P01" || e.code === "PGRST205")) || /relation .* does not exist|Could not find the table/i.test(msg))
    return ["error", "Database not set up", "The database tables aren't there yet. On GitHub, open Actions → Update database and run it."];
  return ["error", "Sync problem", msg];
}
function fail(e) { const [s, txt, d] = explain(e); setStatus(s, txt, d); }

/* ---------- Pull ---------- */
export async function pull() {
  const c = sync.client, uid = sync.user && sync.user.id; if (!c || !uid) return;
  for (const kind of TABLES) {
    let since = store.meta.lastSync[kind];
    for (;;) {
      let q = c.from(TABLE(kind)).select("*").order("synced_at", { ascending: true }).limit(1000);
      if (since) q = q.gt("synced_at", since);
      const { data, error } = await q;
      if (error) throw error;
      if (!data.length) break;
      applyRows(kind, data);
      since = data[data.length - 1].synced_at;
      store.meta.lastSync[kind] = since; store.persist();
      if (data.length < 1000) break;
    }
  }
}

/* ---------- Upload ---------- */
let flushing = false, again = false, timer = null;
export function queueFlush(delay = 600) { clearTimeout(timer); if (canSync()) { setStatus("busy", "Saving…"); timer = setTimeout(flush, delay); } else idleStatus(); }
const canSync = () => !!(sync.client && sync.user && store.meta.owner === sync.user.id);

export async function flush() {
  if (!canSync()) { idleStatus(); return; }
  if (flushing) { again = true; return; }
  flushing = true;
  const c = sync.client, uid = sync.user.id, meta = store.meta, m = store.model;
  const pick = kind => Object.keys(meta.pending[kind]).map(id => {
    const obj = m[kind].find(x => x.id === id) || (meta.tomb && meta.tomb[kind] && meta.tomb[kind][id]);
    if (!obj) { delete meta.pending[kind][id]; return null; }
    return { id, version: obj.updatedAt, row: TO_ROW[kind](obj, uid) };
  }).filter(Boolean);
  const batches = Object.fromEntries(ROWS.map(k => [k, pick(k)]));
  const settings = meta.pending.settings ? { version: m.settings.updatedAt, row: { user_id: uid, data: (({ updatedAt, ...rest }) => rest)(m.settings), updated_at: m.settings.updatedAt } } : null;
  if (ROWS.every(k => !batches[k].length) && !settings) { flushing = false; okStatus(); return; }
  setStatus("busy", "Saving…");
  try {
    const send = async (table, batch) => { for (let k = 0; k < batch.length; k += 500) { const { error } = await c.from(table).upsert(batch.slice(k, k + 500).map(b => b.row), { onConflict: "user_id,id" }); if (error) throw error; } };
    for (const k of ROWS) if (batches[k].length) await send(TABLE(k), batches[k]);
    if (settings) { const { error } = await c.from("settings").upsert(settings.row, { onConflict: "user_id" }); if (error) throw error; }
    const settle = (kind, sent) => sent.forEach(s => {
      const cur = store.model[kind].find(x => x.id === s.id) || (store.meta.tomb && store.meta.tomb[kind] && store.meta.tomb[kind][s.id]);
      if (!cur || cur.updatedAt === s.version) { delete store.meta.pending[kind][s.id]; if (store.meta.tomb && store.meta.tomb[kind]) delete store.meta.tomb[kind][s.id]; }
    });
    ROWS.forEach(k => settle(k, batches[k]));
    if (settings && store.model.settings.updatedAt === settings.version) store.meta.pending.settings = false;
    store.persist(); sync.lastSync = new Date(); okStatus();
  } catch (e) { fail(e); }
  finally { flushing = false; if (again) { again = false; flush(); } }
}

/* ---------- Status helpers ---------- */
export const pendingCount = () => ROWS.reduce((n, k) => n + Object.keys(store.meta.pending[k]).length, 0) + (store.meta.pending.settings ? 1 : 0);
function okStatus() { if (!navigator.onLine) return setStatus("offline", "Offline", "Changes are saved on this device and will upload when you're back online."); setStatus("ok", "Synced", ""); }
function idleStatus() {
  if (!sync.configured) return setStatus("local", "Saved on this device", "Cloud sync isn't set up in this copy of Koti.");
  if (!sync.user) return setStatus("signedout", "Not signed in", "Sign in to keep your phone and computer in step.");
  if (!navigator.onLine) return setStatus("offline", "Offline", "Changes are saved on this device and will upload when you're back online.");
}

/* ---------- Session lifecycle ---------- */
let channel = null, starting = null;
async function begin() {
  const c = sync.client, uid = sync.user.id;
  setStatus("busy", "Syncing…");
  if (store.meta.owner && store.meta.owner !== uid) store.resetLocal(seedModel());
  if (store.meta.owner !== uid) {
    const { count, error } = await c.from("lists").select("id", { count: "exact", head: true });
    if (error) throw error;
    if (!count) {
      store.meta.owner = uid; store.markAllPending(); // first device: upload what's here
    } else {
      if (store.hasUserData()) { try { localStorage.setItem("koti.beforeSignIn", JSON.stringify(store.model)); } catch {} }
      store.resetLocal({ version: 3, lists: [], items: [], categories: [], transactions: [], bills: [], goals: [], income: [], settings: {} });
      store.meta.owner = uid; store.persist();
    }
  }
  await pull();
  store.seedCategoriesIfEmpty();   // first time Money runs for this account
  store.upgrade();                 // older data on the server that hasn't been moved over yet
  await flush();
  subscribe();
}
function subscribe() {
  const c = sync.client, uid = sync.user.id;
  if (channel) c.removeChannel(channel);
  channel = c.channel("koti-" + uid);
  TABLES.forEach(kind => channel.on("postgres_changes", { event: "*", schema: "public", table: TABLE(kind), filter: `user_id=eq.${uid}` }, p => { if (p.new) applyRows(kind, [p.new]); }));
  channel.subscribe();
}
async function start() {
  if (starting) return starting;
  starting = (async () => { try { await begin(); } catch (e) { fail(e); } finally { starting = null; } })();
  return starting;
}
export async function refresh() { if (!canSync()) return; try { await pull(); await flush(); } catch (e) { fail(e); } }

export function initSync() {
  store.on(kind => { if (kind === "local") queueFlush(); });
  window.addEventListener("online", () => { if (sync.user) start(); });
  window.addEventListener("offline", () => idleStatus());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 120000);
  if (!sync.configured || !window.supabase) { sync.configured = false; idleStatus(); return; }
  sync.client = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "koti.auth" } });
  sync.client.auth.onAuthStateChange((event, session) => {
    const before = sync.user && sync.user.id;
    sync.user = session ? session.user : null;
    if (event === "PASSWORD_RECOVERY") listeners.forEach(f => f(sync, "recovery"));
    if (sync.user && sync.user.id !== before) setTimeout(start, 0);
    if (!sync.user) { if (channel) { sync.client.removeChannel(channel); channel = null; } idleStatus(); }
  });
  idleStatus();
}

/* ---------- Account actions ---------- */
const redirect = () => location.origin + location.pathname;
export async function signIn(email, password) { const { error } = await sync.client.auth.signInWithPassword({ email, password }); if (error) throw error; }
export async function signUp(email, password) {
  const { data, error } = await sync.client.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
  if (error) throw error; return { needsConfirm: !data.session };
}
export async function sendReset(email) { const { error } = await sync.client.auth.resetPasswordForEmail(email, { redirectTo: redirect() + "#settings" }); if (error) throw error; }
export async function setPassword(password) { const { error } = await sync.client.auth.updateUser({ password }); if (error) throw error; }
export async function signOut() { await sync.client.auth.signOut(); }
