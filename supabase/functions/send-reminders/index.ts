// Koti: push reminders.
//   Hourly (pg_cron → this function, with a token kept in Vault): bills due tomorrow, late bills (day 1, day 4,
//   then weekly), "did your pay land?", a budget running low, money tight, today's payments and your own reminders.
//   What to say is worked out in reminders.js, on engine.js (a copy of the app's js/engine.js), from each person's
//   own records and in their phone's time zone; this file fetches the rows, signs the buttons and sends.
//   From the app (signed-in user): {action:"key"} returns the public key; {action:"test"} sends a test.
//   From a notification button (no sign-in): {action:"answer", token, choice}. The token is signed here when the
//   reminder is sent, names one bill or payday of one person, and expires after 14 days.
//   Several reminders in one hour arrive as one notification, and nobody gets more than 3 a day.
// Notification keys are created here on first use and kept in Supabase Vault; nothing is pasted anywhere.
import webpush from "npm:web-push@3.6.7";
// @ts-ignore: plain JavaScript modules
import { local, remindersFor, bundle, langOf, modelOf, W, DAILY_LIMIT, HELSINKI } from "./reminders.js";
// @ts-ignore: plain JavaScript modules
import * as E from "./engine.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-koti-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
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
    return x.exp > Date.now() && (x.k === "bill" || x.k === "pay" || x.k === "cr") ? x : null;
  } catch { return null; }
}

/* What a button does. Rows are written the way the app writes them, so every device syncs the change. */
async function answer(a: Answer & { u: string }, choice: string) {
  const uid = a.u, stamp = new Date().toISOString();
  const tz = (((await rest(`settings?select=data&user_id=eq.${uid}`)) || [])[0] || { data: {} }).data.tz || HELSINKI, today = local(new Date(), tz).day;
  if (a.k === "cr") {   // your own reminder: Done, or again tomorrow at the same hour
    if (choice === "later") await fetch(`${URL_}/rest/v1/push_log?on_conflict=user_id,key`, { method: "POST", headers: { ...asServer(), "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ user_id: uid, key: `again:cr:${a.id}:${E.addDays(today, 1)}` }) });
    return { ok: true };
  }
  if (choice === "later") {
    if (a.k === "pay") await fetch(`${URL_}/rest/v1/push_log?on_conflict=user_id,key`, { method: "POST", headers: { ...asServer(), "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ user_id: uid, key: `again:pay:${a.id}:${a.due}:${E.addDays(today, 1)}` }) });
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

type Answer = { k: "bill" | "pay" | "cr"; id: string; due: string };
type Note = { key: string; title: string; body: string; url: string; actions?: { action: string; title: string }[]; answer?: Answer };

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

async function runAll(secret: string) {
  const subs: Row[] = await rest("push_subscriptions?select=*");
  if (!subs.length) return { users: 0, sent: 0 };
  const users = [...new Set(subs.map((s) => s.user_id))], inList = `in.(${users.join(",")})`, hel = local().day;
  const days = [E.addDays(hel, -1), hel, E.addDays(hel, 1)];   // every time zone's "today" is one of these
  const [settings, bills, tx, income, cats, goals, log, mineAll, lists, items, events] = await Promise.all([
    rest(`settings?select=user_id,data&user_id=${inList}`),
    rest(`bills?select=*&deleted=eq.false&user_id=${inList}`),
    rest(`transactions?select=user_id,id,date,amount,kind,category_id,payee,bill_id,bill_due,income_id,income_due,lines,updated_at&deleted=eq.false&user_id=${inList}`),
    rest(`income_sources?select=*&deleted=eq.false&user_id=${inList}`),
    rest(`categories?select=user_id,id,name,budget&deleted=eq.false&user_id=${inList}`),
    rest(`goals?select=user_id,id,name,target,saved,monthly&deleted=eq.false&user_id=${inList}`),
    rest(`push_log?select=user_id,key&user_id=${inList}&or=(key.like."again:*",${days.map((d) => `key.like."n:${d}:*"`).join(",")})`),
    rest(`reminders?select=*&deleted=eq.false&active=eq.true&user_id=${inList}`),
    rest(`lists?select=user_id,id,name,kind,parent_id&deleted=eq.false&user_id=${inList}`),
    rest(`items?select=user_id,id,list_id,name,done,price,bought_at&deleted=eq.false&done=eq.true&price=gt.0&user_id=${inList}`),
    rest(`share_events?select=user_id,id,list_id,item_name&sent=eq.false&user_id=${inList}&order=id`),
  ]);
  let sent = 0;
  for (const uid of users) {
    const by = (rows: Row[]) => rows.filter((r) => r.user_id === uid);
    const st = (by(settings)[0] || {}).data || {}, mine: Row[] = by(log), now = local(new Date(), st.tz || HELSINKI);
    const sentToday = mine.filter((r) => r.key.startsWith(`n:${now.day}:`)).length;
    if (sentToday >= DAILY_LIMIT) continue;   // the rest waits; anything still true is checked again tomorrow
    const model = modelOf({ settings: st, bills: by(bills), tx: by(tx), income: by(income), cats: by(cats), goals: by(goals), lists: by(lists), items: by(items) });
    const notes: Note[] = remindersFor(model, { reminders: by(mineAll), events: by(events), again: new Set(mine.map((r) => r.key)) }, now);
    const told = by(events).map((e) => Number(e.id));   // shared-list changes are told once, sent or switched off
    const fresh: Note[] = [];
    for (const n of notes) if (await firstTime(uid, n.key)) fresh.push(n);
    if (!fresh.length) continue;
    const note: Note = bundle(fresh, langOf(st));
    const token = note.answer ? await signAnswer(secret, uid, note.answer) : undefined;
    const ok = await sendTo(by(subs), note, token); sent += ok;
    if (ok && told.length) await rest(`share_events?user_id=eq.${uid}&id=lte.${Math.max(...told)}`, { method: "PATCH", body: JSON.stringify({ sent: true }) }).catch(() => {});
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
      const st = ((await rest(`settings?select=data&user_id=eq.${user.id}`))[0] || {}).data || {}, w = (W as Row)[langOf(st)];
      const n = await sendTo(subs, { key: `test:${Date.now()}`, title: w.testT, body: w.testB, url: "./#settings" });
      return json(200, { sent: n });
    }
    return json(400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Reminders aren't working right now: " + (e as Error).message });
  }
});
