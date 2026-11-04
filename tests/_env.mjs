// Runs Koti's own modules in Node: a stand-in browser (localStorage, window, document) and a fixed "today".
// Each test file runs in its own process (node --test), so the store starts fresh in every file.
const ls = {};
globalThis.localStorage = { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } };
globalThis.window = { KOTI_CONFIG: {}, addEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.document = { addEventListener() {}, visibilityState: "hidden", getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} } };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true, userAgent: "node" }, configurable: true });
globalThis.matchMedia = () => ({ matches: false });

const RealDate = Date;
let fixed = null;
/* Every new Date() and Date.now() reads this day, at noon local time. */
export function setToday(iso) {
  fixed = new RealDate(iso + "T12:00:00").getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
}
export const app = async () => ({
  ...(await import("../js/data.js")), ...(await import("../js/ledger.js")), plan: await import("../js/plan.js"),
  money: await import("../js/money.js"), income: await import("../js/income.js"), sync: await import("../js/sync.js"),
});

/* A pretend Supabase: tables of rows, upserts that run the same rules as the database triggers, ordered pulls. */
export function fakeServer({ rules = true } = {}) {
  const T = {}; let clock = 1;
  const stamp = () => new RealDate(Date.UTC(2026, 0, 1) + clock++ * 1000).toISOString();
  const table = name => (T[name] = T[name] || []);
  const from = name => {
    const st = { f: [], lim: 1000, ord: [] };
    const api = {
      select() { return api; }, order(c) { st.ord.push(c); return api; }, limit(n) { st.lim = n; return api; },
      gt(c, v) { st.f.push(r => r[c] > v); return api; }, gte(c, v) { st.f.push(r => r[c] >= v); return api; }, eq(c, v) { st.f.push(r => r[c] === v); return api; },
      or(expr) { st.f.push(orFilter(expr)); return api; },
      async maybeSingle() { const r = table(name).filter(x => st.f.every(f => f(x)))[0]; return { data: r ? JSON.parse(JSON.stringify(r)) : null, error: null }; },
      async upsert(rows) {
        for (const r of [].concat(rows)) {
          const bad = server.refuse && server.refuse(name, r); if (bad) return { error: { message: bad, code: "22008" } };
        }
        for (const r of [].concat(rows)) {
          const key = name === "settings" ? x => x.user_id === r.user_id : x => x.user_id === r.user_id && x.id === r.id;
          const i = table(name).findIndex(key), old = i >= 0 ? table(name)[i] : null;
          let row = { ...r };
          if (rules && old) row = server.onUpdate(name, old, row);
          row.synced_at = stamp();
          if (i >= 0) table(name)[i] = row; else table(name).push(row);
        }
        return { error: null };
      },
      then(res) { const rows = table(name).filter(x => st.f.every(f => f(x))).sort((a, b) => (a.synced_at < b.synced_at ? -1 : a.synced_at > b.synced_at ? 1 : String(a.id) < String(b.id) ? -1 : 1)).slice(0, st.lim); res({ data: JSON.parse(JSON.stringify(rows)), error: null }); },
    };
    return api;
  };
  const server = { T, table, client: { from: n => from(n === "income_sources" ? "income_sources" : n) }, refuse: null,
    // the same rules as supabase/migrations/*_conflicts.sql: an older row never replaces a newer one
    onUpdate(name, old, row) {
      if (name === "settings") return mergeSettings(old, row);
      return Date.parse(row.updated_at) < Date.parse(old.updated_at) ? { ...old } : row;
    } };
  return server;
}
function mergeSettings(old, row) {
  const ot = (old.data && old.data._t) || {}, nt = (row.data && row.data._t) || {}, data = { ...(old.data || {}) }, out = { ...ot };
  for (const k of Object.keys(row.data || {})) { if (k === "_t") continue; if (Date.parse(nt[k] || 0) >= Date.parse(ot[k] || 0)) { data[k] = row.data[k]; if (nt[k]) out[k] = nt[k]; } }
  data._t = out; return { ...row, data, updated_at: old.updated_at > row.updated_at ? old.updated_at : row.updated_at };
}
// PostgREST or=(synced_at.gt.X,and(synced_at.eq.X,id.gt.Y))
function orFilter(expr) {
  const m = /^\(synced_at\.gt\.(.+?),and\(synced_at\.eq\.(.+?),id\.gt\.(.+)\)\)$/.exec(expr);
  if (!m) throw new Error("fake server: unsupported or() " + expr);
  const unq = s => s.replace(/^"|"$/g, "");
  return r => r.synced_at > unq(m[1]) || (r.synced_at === unq(m[2]) && String(r.id) > unq(m[3]));
}
/* Two devices on one account: the store's state is swapped in and out. */
export function devices(store) {
  const snap = () => JSON.parse(JSON.stringify({ model: store.model, meta: store.meta }));
  const load = s => { store.model = JSON.parse(JSON.stringify(s.model)); store.meta = JSON.parse(JSON.stringify(s.meta)); };
  return { snap, load };
}
