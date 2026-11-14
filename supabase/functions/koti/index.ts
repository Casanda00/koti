// Koti: talk to Koti about your money and home, and get today's note for the Today screen.
//   {mode:"chat", message | audio, spoken?, history, today, lang}   an answer, follow-up questions, actions to confirm,
//                                                        and, when it was spoken to, the answer as speech (MP3)
//   {mode:"brief", today, lang}                            one to three notes for Today, and actions to confirm
// The thinking is in agent.js. This file checks who is asking, counts the daily AI limit, reads that person's own
// records with their own sign-in (row level security: nobody else's rows can be read), and writes down a recording.
// Nothing is saved here: actions go back to the app, where the person confirms them.
// Secrets: OPENAI_API_KEY. Optional: OPENAI_MODEL, OPENAI_REASONING, OPENAI_TRANSCRIBE_MODEL, AI_DAILY_LIMIT (shared).

// @ts-ignore: plain JavaScript modules, shared with the tests
import { runAgent, modelFromRows } from "./agent.js";
// @ts-ignore: plain JavaScript modules, shared with the tests
import { transcribe, audioOf, speech, shouldSpeak, MODEL } from "../_shared/openai.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const LIMIT = Math.max(1, Number(Deno.env.get("AI_DAILY_LIMIT") || 30));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
type Row = Record<string, any>;
function projectKey(): string {
  try { const k = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"); if (k.default) return k.default; } catch { /* use the legacy key */ }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}
/* Gives one AI use back (the AI failed), with the server's own key so a user can't do it themselves. */
async function giveBack(url: string, userId: string) {
  const key = (() => { try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); if (k.default) return k.default; } catch { /* legacy */ } return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; })();
  if (!key) return;
  await fetch(`${url}/rest/v1/rpc/koti_ai_refund`, { method: "POST", headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ u: userId }) }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in to talk to Koti.", code: "auth" });
  const url = Deno.env.get("SUPABASE_URL") || "", key = projectKey();
  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } });
  if (!who.ok) return json(401, { error: "Your session ended. Sign in again.", code: "auth" });
  const me = await who.json().catch(() => ({})) as { id?: string };
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json(503, { error: "AI isn't set up yet. Add OPENAI_API_KEY in Supabase → Edge Functions → Secrets.", code: "no_key" });

  let body: Row;
  try { body = await req.json(); } catch { return json(400, { error: "Send a JSON body." }); }
  const mode = body.mode === "brief" ? "brief" : "chat";
  const lang = String(body.lang || "en").toLowerCase().startsWith("fi") ? "fi" : "en";
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  let message = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  const audio = mode === "chat" && !message ? audioOf(body.audio) : null;
  if (mode === "chat" && !message && !audio) return json(400, { error: "Say or type something.", code: "input" });
  if (typeof body.audio === "string" && body.audio.length > 4_000_000) return json(400, { error: "That recording is too long. Keep it under a minute.", code: "input" });

  const use = await fetch(`${url}/rest/v1/rpc/koti_ai_use`, { method: "POST", headers: { Authorization: auth, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ daily_limit: LIMIT }) });
  if (!use.ok) return json(429, { error: `That's today's ${LIMIT} AI uses. Koti can talk again tomorrow.`, code: "limit" });
  const used = await use.json().catch(() => null);

  // Their own records, read as them: row level security keeps everyone else's out.
  const asThem = { Authorization: auth, apikey: key };
  async function rows(path: string, order: string) {
    const out: Row[] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await fetch(`${url}/rest/v1/${path}&order=${order}&limit=1000&offset=${offset}`, { headers: asThem });
      if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`);
      const page: Row[] = await r.json();
      out.push(...page);
      if (page.length < 1000 || out.length >= 20000) return out;
    }
  }
  let M: Row;
  try {
    const [settings, bills, tx, income, cats, goals, lists, items, reminders] = await Promise.all([
      rows("settings?select=data", "user_id"),
      rows("bills?select=*&deleted=eq.false", "id"),
      rows("transactions?select=id,date,amount,kind,category_id,payee,note,source,bill_id,bill_due,income_id,income_due,from_pay,lines,updated_at&deleted=eq.false", "id"),
      rows("income_sources?select=*&deleted=eq.false", "id"),
      rows("categories?select=id,name,budget&deleted=eq.false", "id"),
      rows("goals?select=*&deleted=eq.false", "id"),
      rows("lists?select=id,name,kind,parent_id&deleted=eq.false", "id"),
      rows("items?select=id,list_id,name,done,price,bought_at,priority,qty&deleted=eq.false", "id"),
      rows("reminders?select=*&deleted=eq.false", "id"),
    ]);
    M = modelFromRows({ settings: (settings[0] || {}).data || {}, bills, tx, income, cats, goals, lists, items, reminders });
  } catch (e) {
    if (me.id) await giveBack(url, me.id);
    return json(502, { error: `Couldn't read your records: ${(e as Error).message}`, code: "read" });
  }

  try {
    if (audio) {
      const words = [...new Set([...M.transactions.slice(-300).map((t: Row) => t.payee).filter(Boolean), ...M.categories.map((c: Row) => c.name), ...M.goals.map((g: Row) => g.name)])].slice(0, 40) as string[];
      message = await transcribe({ key: openaiKey, bytes: audio.bytes, type: audio.type, lang, words });
      if (!message) { if (me.id) await giveBack(url, me.id); return json(200, { heard: "", reply: lang === "fi" ? "En kuullut mitään. Kokeile uudelleen." : "I didn't hear anything. Try again.", followUps: [], actions: [], used, limit: LIMIT }); }
    }
    const history = [...(Array.isArray(body.history) ? body.history : []), ...(mode === "chat" ? [{ role: "user", content: message }] : [])];
    const out = await runAgent({ key: openaiKey, M, today, lang, mode, history });
    // Koti speaks only when spoken to: a recording, or words the phone heard (spoken). Never to typing.
    const voice = mode === "chat" && shouldSpeak({ audio: !!audio, spoken: body.spoken === true, settings: M.settings }) ? await speech({ key: openaiKey, text: out.reply, lang }) : null;
    return json(200, { ...out, heard: audio ? message : undefined, speech: voice ? `data:audio/mpeg;base64,${voice}` : null, model: MODEL, used, limit: LIMIT });
  } catch (e) {
    if (me.id) await giveBack(url, me.id);
    return json(502, { error: (e as Error).message || "Koti couldn't think that through. Try again.", code: "openai" });
  }
});
