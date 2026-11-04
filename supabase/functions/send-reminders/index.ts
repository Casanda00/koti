// Koti: push reminders.
//   Hourly (pg_cron → this function, with a token kept in Vault): bills due tomorrow, late bills (day 1, day 4,
//   then weekly), "did your pay land?", a budget running low, and an optional "your week".
//   Words follow the voice language setting: Finnish when it starts with "fi", English otherwise.
//   From the app (signed-in user): {action:"key"} returns the public key; {action:"test"} sends a test.
//   From a notification button (no sign-in): {action:"answer", token, choice}. The token is signed here when the
//   reminder is sent, names one bill or payday of one person, and expires after 14 days.
//   Several reminders in one hour arrive as one notification, and nobody gets more than 3 a day.
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

/* ---------- Answer tokens: what a notification button may change, signed so no sign-in is needed ---------- */
const enc = new TextEncoder();
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
async function hmac(secret: string) { return await crypto.subtle.importKey("raw", enc.encode("koti-answer:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
export async function signAnswer(secret: string, user: string, a: Answer, days = 14) {
  const body = b64u(enc.encode(JSON.stringify({ u: user, ...a, exp: Date.now() + days * 864e5 })).buffer as ArrayBuffer);
  return body + "." + b64u(await crypto.subtle.sign("HMAC", await hmac(secret), enc.encode(body)));
}
export async function readAnswer(secret: string, token: string): Promise<(Answer & { u: string }) | null> {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify("HMAC", await hmac(secret), fromB64u(sig), enc.encode(body)))) return null;
    const x = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    return x.exp > Date.now() && (x.k === "bill" || x.k === "pay") ? x : null;
  } catch { return null; }
}

/* What a button does. Rows are written the way the app writes them, so every device syncs the change. */
async function answer(a: Answer & { u: string }, choice: string) {
  const today = local().day, stamp = new Date().toISOString(), uid = a.u;
  if (choice === "later") {
    if (a.k === "pay") await fetch(`${URL_}/rest/v1/push_log?on_conflict=user_id,key`, { method: "POST", headers: { ...asServer(), "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ user_id: uid, key: `again:pay:${a.id}:${a.due}:${addDays(today, 1)}` }) });
    return { ok: true };
  }
  const upsertTx = (row: Row) => rest("transactions?on_conflict=user_id,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: uid, note: null, source: "manual", deleted: false, updated_at: stamp, ...row }) });
  if (a.k === "bill") {
    const b: Row = ((await rest(`bills?select=*&user_id=eq.${uid}&id=eq.${encodeURIComponent(a.id)}&deleted=eq.false`)) || [])[0];
    if (!b) return { ok: false, error: "That bill isn't in Koti any more." };
    const d = (b.dues || {})[a.due] || {};
    if (choice === "paid") {
      await upsertTx({ id: `bill:${b.id}:${a.due}`, date: today, amount: d.amount || Number(b.amount), kind: "expense", category_id: "cat-bills", payee: b.name, receipt_path: d.docPath || null, bill_id: b.id, bill_due: a.due });
      return { ok: true };
    }
    if (choice === "skip") {
      const dues = { ...(b.dues || {}), [a.due]: { amount: null, reference: null, docPath: null, ...d, skipped: true } };
      await rest(`bills?user_id=eq.${uid}&id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", body: JSON.stringify({ dues, updated_at: stamp }) });
      return { ok: true };
    }
  }
  if (a.k === "pay" && choice === "landed") {
    const src: Row = ((await rest(`income_sources?select=*&user_id=eq.${uid}&id=eq.${encodeURIComponent(a.id)}&deleted=eq.false`)) || [])[0];
    if (!src || !src.amount) return { ok: false, error: "That income isn't in Koti any more." };
    await upsertTx({ id: `inc:${src.id}:${a.due}`, date: a.due <= today ? a.due : today, amount: Number(src.amount), kind: "income", category_id: null, payee: src.name, income_id: src.id, income_due: a.due });
    return { ok: true };
  }
  return { ok: false, error: "Unknown answer." };
}

/* ---------- Dates in Helsinki ---------- */
function local(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday as string };
}
const addDays = (s: string, n: number) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ymd = (y: number, m: number, day: number) => { const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10); };
type Lang = "en" | "fi";
const money = (lang: Lang, n: number) => new Intl.NumberFormat(lang === "fi" ? "fi-FI" : "en-FI", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
const longDay = (lang: Lang, s: string) => new Date(s + "T12:00:00Z").toLocaleDateString(lang === "fi" ? "fi-FI" : "en-GB", lang === "fi" ? { weekday: "long", day: "numeric", month: "numeric", timeZone: "UTC" } : { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const stop = (x: string) => x.endsWith(".") ? x : x + ".";   // a Finnish date already ends with a full stop
const list = (lang: Lang, xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${lang === "fi" ? "ja" : "and"} ${xs[xs.length - 1]}`;
/* Late bills are mentioned on day 1, day 4, then once a week, for up to 60 days. */
export const lateDays = (late: number) => late === 1 || late === 4 || (late > 4 && late <= 60 && (late - 4) % 7 === 0);

/* The words, in Koti 2.0's voice. */
const W = {
  en: {
    due: (n: string, a: string) => `${n}, ${a}, is due tomorrow.`,
    dueRef: (r: string) => `Reference ${r} is ready to copy in Koti.`,
    dueBody: "Mark it paid in Koti when it's done.",
    late: (n: string, a: string, d: string) => `${n}, ${a}, was due ${d}.`,
    lateBody: "Mark it paid, or not owed this time.",
    pay: (n: string, a: string) => `Did ${n}, ${a}, land?`,
    payName: (n: string) => String(n).toLowerCase() === "salary" ? "your salary" : `the ${n} money`,
    payBody: (d: string) => `It was due ${d}. Tell Koti when it's in.`,
    over: (c: string, a: string) => `${c} is ${a} over this month.`,
    low: (c: string, a: string) => `${c} is nearly used up. ${a} to go.`,
    budBody: (p: number, b: string) => `You've used ${p}% of this month's ${b}.`,
    week: "Your week",
    weekBody: (a: string, next: string) => `${a} spent this week. ${next ? `Next week: ${next}.` : "No bills next week."}`,
    testT: "Koti reminders are on", testB: "Bills, paydays and budgets will reach you like this.",
    paid: "Paid", notYet: "Not yet", iPaid: "I paid it", notOwed: "Not owed", landed: "It landed",
    bundle: (n: number) => `${n} things today`,
  },
  fi: {
    due: (n: string, a: string) => `${n}, ${a}, erääntyy huomenna.`,
    dueRef: (r: string) => `Viite ${r} on valmiina kopioitavaksi Kotissa.`,
    dueBody: "Merkitse se maksetuksi Kotissa, kun olet maksanut.",
    late: (n: string, a: string, d: string) => `${n}, ${a}, erääntyi ${stop(d)}`,
    lateBody: "Merkitse se maksetuksi, tai ettei sitä tarvitse maksaa tällä kertaa.",
    pay: (n: string, a: string) => `Tuliko ${n}, ${a}?`,
    payName: (n: string) => String(n).toLowerCase() === "salary" ? "palkkasi" : n,
    payBody: (d: string) => `Sen piti tulla ${stop(d)} Kerro Kotille, kun se on tilillä.`,
    over: (c: string, a: string) => `${c}: ${a} yli tämän kuun budjetin.`,
    low: (c: string, a: string) => `${c} on melkein käytetty. ${a} jäljellä.`,
    budBody: (p: number, b: string) => `Tämän kuun ${b}:n budjetista on käytetty ${p} %.`,
    week: "Viikkosi",
    weekBody: (a: string, next: string) => `${a} kulutettu tällä viikolla. ${next ? `Ensi viikolla: ${next}.` : "Ensi viikolla ei laskuja."}`,
    testT: "Kotin muistutukset ovat päällä", testB: "Laskut, palkkapäivät ja budjetit tulevat näin.",
    paid: "Maksettu", notYet: "Ei vielä", iPaid: "Maksoin", notOwed: "Ei tarvitse", landed: "Tuli",
    bundle: (n: number) => `${n} asiaa tänään`,
  },
};
const langOf = (settings: Row): Lang => String(settings.voiceLang || "").toLowerCase().startsWith("fi") ? "fi" : "en";

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
type Answer = { k: "bill" | "pay"; id: string; due: string };
type Note = { key: string; title: string; body: string; url: string; actions?: { action: string; title: string }[]; answer?: Answer };
export const DAILY_LIMIT = 3;
function remindersFor(u: { settings: Row; bills: Row[]; tx: Row[]; income: Row[]; cats: Row[]; again?: Set<string> }, now: { day: string; hour: number; weekday: string }): Note[] {
  const R = { bills: true, overdue: true, payday: true, budget: true, weekly: false, quietFrom: 21, quietTo: 8, billHour: 9, ...(u.settings.reminders || {}) };
  const quiet = R.quietFrom > R.quietTo ? (now.hour >= R.quietFrom || now.hour < R.quietTo) : (now.hour >= R.quietFrom && now.hour < R.quietTo);
  if (quiet) return [];
  const out: Note[] = [], today = now.day, tomorrow = addDays(today, 1), morning = now.hour === Number(R.billHour);
  const start = u.settings.startDate || null, lang = langOf(u.settings), w = W[lang], eur = (n: number) => money(lang, n);
  const paid = new Set(u.tx.filter((t) => t.bill_id).map((t) => `${t.bill_id}|${t.bill_due}`));
  const got = new Set(u.tx.filter((t) => t.income_id).map((t) => `${t.income_id}|${t.income_due}`));
  for (const b of u.bills) {
    if (!b.active) continue;
    for (const due of billDuesAround(b, today, 2, 1)) {
      const d = (b.dues || {})[due] || {}, amount = d.amount || Number(b.amount);
      if (paid.has(`${b.id}|${due}`) || d.skipped) continue;
      if (R.bills && morning && due === tomorrow && !b.autopay) out.push({ key: `due:${b.id}:${due}`, title: w.due(b.name, eur(amount)), body: (d.reference || b.reference) ? w.dueRef(d.reference || b.reference) : w.dueBody, url: "./#bills",
        actions: [{ action: "paid", title: w.paid }, { action: "later", title: w.notYet }], answer: { k: "bill", id: b.id, due } });
      if (R.overdue && morning && due < today && !b.autopay && (!start || due >= start) && (b.start_date ? due >= b.start_date : true)) {
        const late = Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
        if (lateDays(late)) out.push({ key: `od:${b.id}:${due}:${today}`, title: w.late(b.name, eur(amount), longDay(lang, due)), body: w.lateBody, url: "./#now",
          actions: [{ action: "paid", title: w.iPaid }, { action: "skip", title: w.notOwed }], answer: { k: "bill", id: b.id, due } });
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
        if (lateBy < 1 || lateBy > 14 || got.has(`${s.id}|${due}`) || (s.missed || []).includes(due) || (start && due < start)) continue;
        // The morning after payday; again on a later morning only when "Not yet" was tapped the day before.
        const again = u.again && u.again.has(`again:pay:${s.id}:${due}:${today}`);
        if (lateBy !== 1 && !again) continue;
        out.push({ key: lateBy === 1 ? `pay:${s.id}:${due}` : `pay:${s.id}:${due}:${today}`, title: w.pay(w.payName(s.name), eur(Number(s.amount))), body: w.payBody(longDay(lang, due)), url: "./#now",
          actions: [{ action: "landed", title: w.landed }, { action: "later", title: w.notYet }], answer: { k: "pay", id: s.id, due } });
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
      out.push({ key: `bud:${c.id}:${from}`, title: s > b ? w.over(c.name, eur(s - b)) : w.low(c.name, eur(b - s)), body: w.budBody(Math.round(s / b * 100), eur(b)), url: "./#month" });
    }
  }
  if (R.weekly && now.weekday === "Sun" && now.hour === 19) {
    const from = addDays(today, -6); let s = 0, n = 0;
    for (const t of u.tx) if (t.date >= from && t.date <= today && t.kind === "expense" && !t.bill_id && t.category_id !== "adjust") { s += Number(t.amount); n++; }
    const next: string[] = [], end = addDays(today, 7);
    for (const b of u.bills) {
      if (!b.active) continue;
      for (const due of billDuesAround(b, today, 0, 1)) if (due > today && due <= end && !paid.has(`${b.id}|${due}`) && !((b.dues || {})[due] || {}).skipped) next.push(`${b.name} ${eur(((b.dues || {})[due] || {}).amount || Number(b.amount))}`);
    }
    out.push({ key: `wk:${today}`, title: w.week, body: w.weekBody(eur(s), list(lang, next.length > 3 ? [...next.slice(0, 2), lang === "fi" ? `${next.length - 2} muuta` : `${next.length - 2} more`] : next)), url: "./#month" });
  }
  return out;
}

/* ---------- Sending ---------- */
async function sendTo(subs: Row[], note: Note, token?: string) {
  let ok = 0;
  const payload = JSON.stringify({ title: note.title, body: note.body, url: note.url, tag: note.key.split(":").slice(0, 3).join(":"),
    ...(token && note.actions ? { actions: note.actions, token, answer: `${URL_}/functions/v1/send-reminders` } : {}) });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "normal" });
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

/* Several reminders at once become one notification; a single one keeps its buttons. */
export function bundle(notes: Note[], lang: Lang): Note {
  if (notes.length === 1) return notes[0];
  return { key: `bundle:${Date.now()}`, title: W[lang].bundle(notes.length), body: notes.map((n) => n.title).join("\n"), url: "./#now" };
}

async function runAll(secret: string) {
  const subs: Row[] = await rest("push_subscriptions?select=*");
  if (!subs.length) return { users: 0, sent: 0 };
  const now = local(), users = [...new Set(subs.map((s) => s.user_id))], inList = `in.(${users.join(",")})`, since = addDays(now.day, -100);
  const [settings, bills, tx, income, cats, log] = await Promise.all([
    rest(`settings?select=user_id,data&user_id=${inList}`),
    rest(`bills?select=*&deleted=eq.false&user_id=${inList}`),
    rest(`transactions?select=user_id,date,amount,kind,category_id,bill_id,bill_due,income_id,income_due,lines&deleted=eq.false&date=gte.${since}&user_id=${inList}`),
    rest(`income_sources?select=*&deleted=eq.false&user_id=${inList}`),
    rest(`categories?select=user_id,id,name,budget&deleted=eq.false&user_id=${inList}`),
    rest(`push_log?select=user_id,key&user_id=${inList}&or=(key.like."again:*",key.like."n:${now.day}:*")`),
  ]);
  let sent = 0;
  for (const uid of users) {
    const by = (rows: Row[]) => rows.filter((r) => r.user_id === uid);
    const st = (by(settings)[0] || {}).data || {}, mine: Row[] = by(log);
    const sentToday = mine.filter((r) => r.key.startsWith(`n:${now.day}:`)).length;
    if (sentToday >= DAILY_LIMIT) continue;   // the rest waits; anything still true is checked again tomorrow
    const notes = remindersFor({ settings: st, bills: by(bills), tx: by(tx), income: by(income), cats: by(cats), again: new Set(mine.map((r) => r.key)) }, now);
    const fresh: Note[] = [];
    for (const n of notes) if (await firstTime(uid, n.key)) fresh.push(n);
    if (!fresh.length) continue;
    const note = bundle(fresh, langOf(st));
    const token = note.answer ? await signAnswer(secret, uid, note.answer) : undefined;
    const ok = await sendTo(by(subs), note, token); sent += ok;
    if (ok) await firstTime(uid, `n:${now.day}:${Date.now()}`);
    else for (const n of fresh) await rest(`push_log?user_id=eq.${uid}&key=eq.${encodeURIComponent(n.key)}`, { method: "DELETE" }).catch(() => {});   // try again next hour
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
      return json(200, await runAll(k.koti_vapid_private));
    }
    const body = await req.json().catch(() => ({}));
    // A button on a notification: the signed token is the permission, no sign-in needed.
    if (body.action === "answer") {
      const a = await readAnswer(k.koti_vapid_private, body.token);
      if (!a) return json(401, { error: "This reminder has expired. Open Koti to answer it." });
      const r = await answer(a, String(body.choice || ""));
      return json(r.ok ? 200 : 400, r);
    }
    // From the app: who is calling?
    const auth = req.headers.get("Authorization") || "";
    const who = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: auth, apikey: SERVICE } });
    if (!who.ok) return json(401, { error: "Sign in first.", code: "auth" });
    const user = await who.json();
    if (body.action === "key") return json(200, { publicKey: k.koti_vapid_public });
    if (body.action === "test") {
      const subs: Row[] = await rest(`push_subscriptions?select=*&user_id=eq.${user.id}`);
      if (!subs.length) return json(400, { error: "Turn on reminders on this phone first.", code: "no_sub" });
      const st = ((await rest(`settings?select=data&user_id=eq.${user.id}`))[0] || {}).data || {}, w = W[langOf(st)];
      const n = await sendTo(subs, { key: `test:${Date.now()}`, title: w.testT, body: w.testB, url: "./#settings" });
      return json(200, { sent: n });
    }
    return json(400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Reminders aren't working right now: " + (e as Error).message });
  }
});
