// Koti: push reminders.
//   Hourly (pg_cron → this function, with a token kept in Vault): bills due tomorrow, overdue bills,
//   "did your pay arrive?", a budget running low, and an optional weekly summary.
//   From the app (signed-in user): {action:"key"} returns the public key; {action:"test"} sends a test.
// Notification keys are created here on first use and kept in Supabase Vault; nothing is pasted anywhere.
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-koti-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TZ = "Europe/Helsinki";
const URL_ = Deno.env.get("SUPABASE_URL") || "";
function serverKey(): string {   // new secret keys first, the legacy service role key otherwise
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); if (k.default) return k.default; } catch { /* legacy */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const SERVICE = serverKey();
const asServer = (): Record<string, string> => SERVICE.startsWith("eyJ") ? { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } : { apikey: SERVICE };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

type Row = Record<string, any>;
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...asServer(), "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const rpc = (fn: string, args: Row = {}) => rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

/* Keys: read from Vault, or create them once. */
async function keys() {
  let s = (await rpc("koti_push_secrets")) || {};
  if (!s.koti_vapid_private) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
    const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d as string;
    await rpc("koti_push_save_keys", { pub, priv });
    s = (await rpc("koti_push_secrets")) || {};
  }
  return s as { koti_vapid_public: string; koti_vapid_private: string; koti_cron_token?: string };
}

/* ---------- Dates in Helsinki ---------- */
function local(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday as string };
}
const addDays = (s: string, n: number) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ymd = (y: number, m: number, day: number) => { const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10); };
const eur = (n: number) => "€" + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
const fmt = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/* A bill's due date in a month (same rules as the app). */
function billDue(b: Row, y: number, m: number): string | null {
  const mm = ((m % 12) + 12) % 12, yy = y + Math.floor(m / 12);
  if (b.frequency === "once") return b.due_date && b.due_date.slice(0, 7) === `${yy}-${String(mm + 1).padStart(2, "0")}` ? b.due_date : null;
  if (b.frequency === "yearly" && mm !== b.anchor_month - 1) return null;
  if (b.frequency === "quarterly" && ((mm - (b.anchor_month - 1)) % 3 + 3) % 3 !== 0) return null;
  const s = ymd(yy, mm, b.due_day);
  if (b.start_date && s < b.start_date.slice(0, 8) + "01") return null;
  if (b.end_date && s > b.end_date) return null;
  return s;
}
function billDuesAround(b: Row, today: string, back: number, ahead: number) {
  const [y, m] = today.split("-").map(Number), out: string[] = [];
  for (let k = -back; k <= ahead; k++) { const d = billDue(b, y, m - 1 + k); if (d) out.push(d); }
  return out;
}
function payDue(src: Row, y: number, m: number) {
  if (src.frequency === "once") return null;
  const mm = ((m % 12) + 12) % 12, yy = y + Math.floor(m / 12), last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const s = ymd(yy, mm, src.pay_day === -1 ? lastWorkingDay(yy, mm) : src.pay_day === 0 ? last : src.pay_day);
  return src.end_date && s > src.end_date ? null : s;
}
/* Last weekday of the month that isn't a Finnish public holiday (the same rule as js/paydays.js). */
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
}
function lastWorkingDay(y: number, m: number) {
  const fixed = new Set(["1-1", "1-6", "5-1", "12-6", "12-24", "12-25", "12-26"]), es = easter(y);
  for (const n of [-2, 1, 39]) { const x = new Date(es.getTime() + n * 864e5); fixed.add(`${x.getUTCMonth() + 1}-${x.getUTCDate()}`); }
  for (let d = 19; d <= 25; d++) if (new Date(Date.UTC(y, 5, d)).getUTCDay() === 5) fixed.add(`6-${d}`);
  let day = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (;;) { const x = new Date(Date.UTC(y, m, day)), w = x.getUTCDay(); if (w !== 0 && w !== 6 && !fixed.has(`${m + 1}-${day}`)) return day; day--; }
}

/* ---------- What to remind one user about ---------- */
type Note = { key: string; title: string; body: string; url: string };
function remindersFor(u: { settings: Row; bills: Row[]; tx: Row[]; income: Row[]; cats: Row[] }, now: { day: string; hour: number; weekday: string }): Note[] {
  const R = { bills: true, overdue: true, payday: true, budget: true, weekly: false, quietFrom: 21, quietTo: 8, billHour: 9, ...(u.settings.reminders || {}) };
  const quiet = R.quietFrom > R.quietTo ? (now.hour >= R.quietFrom || now.hour < R.quietTo) : (now.hour >= R.quietFrom && now.hour < R.quietTo);
  if (quiet) return [];
  const out: Note[] = [], today = now.day, tomorrow = addDays(today, 1), morning = now.hour === Number(R.billHour);
  const start = u.settings.startDate || null;
  const paid = new Set(u.tx.filter((t) => t.bill_id).map((t) => `${t.bill_id}|${t.bill_due}`));
  const got = new Set(u.tx.filter((t) => t.income_id).map((t) => `${t.income_id}|${t.income_due}`));
  for (const b of u.bills) {
    if (!b.active) continue;
    for (const due of billDuesAround(b, today, 2, 1)) {
      const d = (b.dues || {})[due] || {}, amount = d.amount || Number(b.amount);
      if (paid.has(`${b.id}|${due}`) || d.skipped) continue;
      if (R.bills && morning && due === tomorrow && !b.autopay) out.push({ key: `due:${b.id}:${due}`, title: `${b.name} ${eur(amount)} is due tomorrow`, body: (d.reference || b.reference) ? `Reference ${d.reference || b.reference} · open to copy` : "Open Koti to mark it paid", url: "./#bills" });
      if (R.overdue && morning && due < today && !b.autopay && (!start || due >= start) && (b.start_date ? due >= b.start_date : true)) {
        const late = Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
        if (late <= 60 && late % 3 === 1) out.push({ key: `od:${b.id}:${due}:${today}`, title: `${b.name} is ${late} day${late === 1 ? "" : "s"} overdue`, body: `${eur(amount)} · mark it paid or not owed`, url: "./#bills" });
      }
    }
  }
  if (R.payday && morning) {
    const [y, m] = today.split("-").map(Number);
    for (const s of u.income) {
      if (!s.active || !s.amount) continue;
      for (const k of [-1, 0]) {
        const due = payDue(s, y, m - 1 + k); if (!due) continue;
        const lateBy = Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
        if (lateBy < 1 || lateBy > 3 || got.has(`${s.id}|${due}`) || (s.missed || []).includes(due) || (start && due < start)) continue;
        out.push({ key: `pay:${s.id}:${due}`, title: `Did your ${String(s.name).toLowerCase() === "salary" ? "salary" : s.name} land?`, body: `${eur(Number(s.amount))} was expected ${fmt(due)}. Open Koti to mark it received.`, url: "./#now" });
      }
    }
  }
  if (R.budget) {   // once a month per category, at 85 %
    const ms = Number(u.settings.monthStart) || 1, [y, m, d] = today.split("-").map(Number);
    const from = d >= ms ? ymd(y, m - 1, ms) : ymd(y, m - 2, ms), to = addDays(d >= ms ? ymd(y, m, ms) : ymd(y, m - 1, ms), -1);
    const spent: Record<string, number> = {};
    for (const t of u.tx) {
      if (t.date < from || t.date > to || t.kind === "income" || t.category_id === "adjust") continue;
      const sign = t.kind === "refund" ? -1 : 1;
      if (Array.isArray(t.lines) && t.lines.length) { let rest = Number(t.amount); for (const l of t.lines) { const c = l.categoryId || t.category_id; if (c) spent[c] = (spent[c] || 0) + sign * l.price; rest -= l.price; } if (Math.abs(rest) >= .005 && t.category_id) spent[t.category_id] = (spent[t.category_id] || 0) + sign * rest; }
      else if (t.category_id) spent[t.category_id] = (spent[t.category_id] || 0) + sign * Number(t.amount);
    }
    for (const c of u.cats) {
      const b = Number(c.budget) || 0, s = spent[c.id] || 0; if (!b || s < b * .85) continue;
      out.push({ key: `bud:${c.id}:${from}`, title: s > b ? `${c.name}: ${eur(s - b)} over budget` : `${c.name}: ${eur(b - s)} left`, body: `You've used ${Math.round(s / b * 100)}% of this month's ${eur(b)}.`, url: "./#budgets" });
    }
  }
  if (R.weekly && now.weekday === "Sun" && now.hour === 19) {
    const from = addDays(today, -6); let s = 0, n = 0;
    for (const t of u.tx) if (t.date >= from && t.date <= today && t.kind === "expense" && !t.bill_id && t.category_id !== "adjust") { s += Number(t.amount); n++; }
    out.push({ key: `wk:${today}`, title: "Your week in Koti", body: `${eur(s)} spent in ${n} expense${n === 1 ? "" : "s"} this week.`, url: "./#month" });
  }
  return out;
}

/* ---------- Sending ---------- */
async function sendTo(subs: Row[], note: Note) {
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: note.title, body: note.body, url: note.url, tag: note.key.split(":").slice(0, 3).join(":") }), { TTL: 6 * 3600, urgency: "normal" });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await rest(`push_subscriptions?user_id=eq.${s.user_id}&endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }).catch(() => {});
      else console.error("push failed", code, (e as Error).message);
    }
  }
  return ok;
}
/* Records the reminder; false if it was already sent. */
async function firstTime(user: string, key: string) {
  const r = await fetch(`${URL_}/rest/v1/push_log?on_conflict=user_id,key`, { method: "POST", headers: { ...asServer(), "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ user_id: user, key }) });
  if (!r.ok) return false;
  const rows = await r.json(); return Array.isArray(rows) && rows.length > 0;
}

async function runAll() {
  const subs: Row[] = await rest("push_subscriptions?select=*");
  if (!subs.length) return { users: 0, sent: 0 };
  const users = [...new Set(subs.map((s) => s.user_id))], inList = `in.(${users.join(",")})`, since = addDays(local().day, -100);
  const [settings, bills, tx, income, cats] = await Promise.all([
    rest(`settings?select=user_id,data&user_id=${inList}`),
    rest(`bills?select=*&deleted=eq.false&user_id=${inList}`),
    rest(`transactions?select=user_id,date,amount,kind,category_id,bill_id,bill_due,income_id,income_due,lines&deleted=eq.false&date=gte.${since}&user_id=${inList}`),
    rest(`income_sources?select=*&deleted=eq.false&user_id=${inList}`),
    rest(`categories?select=user_id,id,name,budget&deleted=eq.false&user_id=${inList}`),
  ]);
  const now = local(); let sent = 0;
  for (const uid of users) {
    const by = (rows: Row[]) => rows.filter((r) => r.user_id === uid);
    const notes = remindersFor({ settings: (by(settings)[0] || {}).data || {}, bills: by(bills), tx: by(tx), income: by(income), cats: by(cats) }, now);
    for (const n of notes) {
      if (!(await firstTime(uid, n.key))) continue;
      const ok = await sendTo(by(subs), n); sent += ok;
      if (!ok) await rest(`push_log?user_id=eq.${uid}&key=eq.${encodeURIComponent(n.key)}`, { method: "DELETE" }).catch(() => {});   // try again next hour
    }
  }
  return { users: users.length, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  try {
    const k = await keys();
    webpush.setVapidDetails("mailto:koti@users.noreply.github.com", k.koti_vapid_public, k.koti_vapid_private);
    const cron = req.headers.get("x-koti-cron");
    if (cron) {
      if (!k.koti_cron_token || cron !== k.koti_cron_token) return json(401, { error: "Bad token." });
      return json(200, await runAll());
    }
    // From the app: who is calling?
    const auth = req.headers.get("Authorization") || "";
    const who = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: auth, apikey: SERVICE } });
    if (!who.ok) return json(401, { error: "Sign in first.", code: "auth" });
    const user = await who.json();
    const body = await req.json().catch(() => ({}));
    if (body.action === "key") return json(200, { publicKey: k.koti_vapid_public });
    if (body.action === "test") {
      const subs: Row[] = await rest(`push_subscriptions?select=*&user_id=eq.${user.id}`);
      if (!subs.length) return json(400, { error: "Turn on reminders on this phone first.", code: "no_sub" });
      const n = await sendTo(subs, { key: `test:${Date.now()}`, title: "Koti reminders are on", body: "This is how bills, paydays and budgets will reach you.", url: "./#settings" });
      return json(200, { sent: n });
    }
    return json(400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Reminders aren't working right now: " + (e as Error).message });
  }
});

