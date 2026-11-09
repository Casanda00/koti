// Koti: understand what someone said (or typed) in the add box, with OpenAI.
// A recording is written down first (speech to text, Finnish or English), then read for what was meant:
//   spend    one purchase or several ("Prisma 86 euros, the lamp was 35 of it"), each with a category or a place
//            in a home project
//   question what was spent in a period ("what did I spend last week?")
//   remind   a reminder ("remind me to pay water on the 15th"); the app reads the details itself
//   list     things to put on a list ("milk, eggs and two tomatoes")
// Nothing is saved here: the app shows what was heard, and the person checks it first. The recording isn't kept.
// Anything else (a question about their money, "can I afford…", a request) is "ask": the app hands it to Koti's
// brain (the "koti" function), which can look things up.
// Secrets: OPENAI_API_KEY. Optional: OPENAI_MODEL, OPENAI_REASONING, OPENAI_TRANSCRIBE_MODEL, AI_DAILY_LIMIT (shared
// with receipts). The model and how it's asked are in ../_shared/openai.js.
// @ts-ignore: plain JavaScript module, shared with the tests
import { chatBody, openaiError, transcribe, audioOf, OPENAI_BASE, MODEL } from "../_shared/openai.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const LIMIT = Math.max(1, Number(Deno.env.get("AI_DAILY_LIMIT") || 30));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const strList = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).slice(0, max).map((x) => (x as string).trim().slice(0, len));
const money = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : null);
const uniq = (xs: string[]) => { const m = new Map<string, string>(); xs.forEach((x) => { if (!m.has(x.toLowerCase())) m.set(x.toLowerCase(), x); }); return [...m.values()]; };
function projectKey(): string {
  try { const k = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"); if (k.default) return k.default; } catch { /* use the legacy key */ }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}
const RANGES = ["today", "yesterday", "week", "lastweek", "month", "lastmonth"];

const SYSTEM = `You understand short things people say or type into a household money app, in English or Finnish, and return what they meant. Never invent amounts.
- intent "spend": they bought something. total: the amount paid in euros (Finnish "kaksikymmentäkolme neljäkymmentä" is 23.40; "23,40" is 23.40). payee: the shop or place if said (Lidl, Prisma, K-Market, Alepa, S-Market, Tokmanni, IKEA, Clas Ohlson…), otherwise null. Where the money came from (my salary, my next pay, my card, my savings) is not the payee. date: YYYY-MM-DD from words like yesterday, eilen, on Monday, maanantaina, relative to today's date given below; null means today. note: a few words of what it was if said and not already a line, otherwise null.
  Where the money came from decides whose money it is. Not said, or their card, account or cash: today's money (both below false).
  from_next_pay: true when they say it comes out of their salary or pay, whether or not they say upcoming or next: "from my salary", "from my upcoming salary", "from my next pay", "until payday", "I'll pay it back when I get paid", "palkasta", "seuraavasta palkasta", "ensi palkasta". It leaves on their next payday (given below), not today.
  from_savings: true when they say it comes out of their savings ("from my savings", "from the holiday fund", "säästöistä"). goal: the savings goal it comes out of, one of theirs (listed below), when they name it or there is only one; otherwise null.
  lines: when they name parts with their own prices ("86 at Prisma, the lamp was 35 of it"), one line per named part with its price, plus one line for the rest ("Other groceries") so the lines add up to the total. When there's only one thing, one line with the whole total. Each line: name in English, price, category (one of the user's categories, by what it is), and place (one of the user's places when it is something for setting up the home that stays there — furniture, lamps, curtains, rugs, bedding, kitchenware, tools, decor — otherwise null).
- intent "question": they ask only how much they spent in one of these periods, nothing more. range: today, yesterday, week (this week), lastweek, month (this month) or lastmonth.
- intent "ask": any other question or request to Koti: about a category, a shop or a thing ("how much on coffee in October?"), bills, savings, budgets, whether they can afford something, advice, or several things at once. reply: an empty string (Koti's brain answers it).
- intent "remind": they ask to be reminded of something ("remind me…", "muistuta…").
- intent "list": they name things to buy or to put on a list, without prices ("milk, eggs and two tomatoes"). items: each thing with qty when said.
- intent "unclear": anything else.
transcript: what they said, cleaned up (fix obvious mishearings of shop names and numbers).
reply: Koti answering them, in the language they used: one or two short, warm sentences saying back what you understood in plain words (the amount, where, what for, when, or the things for the list, or the period they asked about), never a label like "Here's what we heard". When from_next_pay is true, say it comes out of their pay on that payday (by its day, e.g. "from your pay on the 25th"); if no payday is known, ask when they get paid. When from_savings is true, say which savings it comes out of. Never say their money "stays as it is" or "stays the same". If something needed is missing or unclear (no amount, can't tell what it was), ask for it in one short question instead. Never invent amounts.`;

function schema(categories: string[], places: string[], goals: string[]) {
  const oneOf = (vals: string[]) => vals.length ? { type: ["string", "null"], enum: [...vals, null] } : { type: "null" };
  return {
    type: "object", additionalProperties: false,
    required: ["transcript", "reply", "intent", "spend", "range", "items"],
    properties: {
      transcript: { type: "string" },
      reply: { type: "string" },
      intent: { type: "string", enum: ["spend", "question", "ask", "remind", "list", "unclear"] },
      spend: { anyOf: [{ type: "null" }, {
        type: "object", additionalProperties: false, required: ["total", "payee", "date", "note", "from_next_pay", "from_savings", "goal", "lines"],
        properties: {
          total: { type: ["number", "null"] }, payee: { type: ["string", "null"] }, date: { type: ["string", "null"], description: "YYYY-MM-DD" }, note: { type: ["string", "null"] }, from_next_pay: { type: "boolean" }, from_savings: { type: "boolean" }, goal: oneOf(goals),
          lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "price", "category", "place"],
            properties: { name: { type: "string" }, price: { type: "number" }, category: categories.length ? { type: ["string", "null"], enum: [...categories, null] } : { type: "null" }, place: oneOf(places) } } },
        },
      }] },
      range: { type: ["string", "null"], enum: [...RANGES, null] },
      items: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "qty"], properties: { name: { type: "string" }, qty: { type: ["number", "null"] } } } },
    },
  };
}

/* A real calendar date (2026-02-31 isn't), no later than tomorrow; otherwise null. */
function realDay(v: unknown, latest: string) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T12:00:00Z");
  return d.toISOString().slice(0, 10) === v && v >= "1990-01-01" && v <= latest ? v : null;
}
const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
/* Gives one AI use back (the reading failed), with the server's own key so a user can't do it themselves. */
async function giveBack(url: string, userId: string) {
  const key = (() => { try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); if (k.default) return k.default; } catch { /* legacy */ } return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; })();
  if (!key) return;
  await fetch(`${url}/rest/v1/rpc/koti_ai_refund`, { method: "POST", headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ u: userId }) }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in to use the microphone with AI.", code: "auth" });
  const url = Deno.env.get("SUPABASE_URL") || "", key = projectKey();
  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } });
  if (!who.ok) return json(401, { error: "Your session ended. Sign in again.", code: "auth" });
  const me = await who.json().catch(() => ({})) as { id?: string };
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json(503, { error: "AI isn't set up yet. Add OPENAI_API_KEY in Supabase → Edge Functions → Secrets.", code: "no_key" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Send a JSON body." }); }
  const audio = typeof body.audio === "string" ? body.audio : "";
  let text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
  const m = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/i.exec(audio);
  if (!text && !m) return json(400, { error: "Send a recording or some text.", code: "input" });
  if (audio.length > 4_000_000) return json(400, { error: "That recording is too long. Keep it under a minute.", code: "input" });
  const lang = String(body.lang || "en").toLowerCase().startsWith("fi") ? "fi" : "en";
  const categories = uniq(strList(body.categories, 40, 60)), places = uniq(strList(body.places, 60, 120)), goals = uniq(strList(body.goals, 30, 80));
  const payees = uniq(strList(body.payees, 30, 60)), memory = strList(body.memory, 20, 200);
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const nextPay = typeof body.nextPay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.nextPay) && body.nextPay > today ? body.nextPay : null;

  const use = await fetch(`${url}/rest/v1/rpc/koti_ai_use`, { method: "POST", headers: { Authorization: auth, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ daily_limit: LIMIT }) });
  if (!use.ok) return json(429, { error: `That's today's ${LIMIT} AI uses (scans and the microphone together). The microphone still works on this phone.`, code: "limit" });
  const used = await use.json().catch(() => null);

  const fail = async (res: Response, e: { error?: { message?: string } }) => {
    if (me.id) await giveBack(url, me.id);
    const msg = e.error?.message || res.statusText;
    return json(502, { error: openaiError(res.status, msg), code: "openai" });
  };

  // 1. Speech to text, with the names this person uses so they're spelt their way
  if (!text && m) {
    const a = audioOf(audio);
    try { text = a ? (await transcribe({ key: openaiKey, bytes: a.bytes, type: a.type, lang, words: [...payees, ...categories, ...goals] })).slice(0, 500) : ""; }
    catch (e) { if (me.id) await giveBack(url, me.id); return json(502, { error: (e as Error).message, code: "openai" }); }
    if (!text) return json(200, { transcript: "", reply: lang === "fi" ? "En kuullut mitään. Kokeile uudelleen tai kirjoita se." : "I didn't hear anything. Try again, or type it.", intent: "unclear", spend: null, range: null, items: [], used, limit: LIMIT });
  }

  // 2. What was meant
  const prompt = `Today is ${today} (${new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long" })}). They were using the app in ${lang === "fi" ? "Finnish" : "English"}.
The user's categories: ${categories.length ? categories.join(" | ") : "(none)"}
Places in the user's home projects: ${places.length ? places.join(" | ") : "(none)"}
Their savings goals: ${goals.length ? goals.join(" | ") : "(none)"}
Shops they use most: ${payees.length ? payees.join(" | ") : "(not known yet)"}
What Koti remembers about them: ${memory.length ? memory.join(" | ") : "(nothing yet)"}
Their next payday: ${nextPay ? `${nextPay} (${new Date(nextPay + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })})` : "not known"}
They said: ${JSON.stringify(text)}`;
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(chatBody({ model: MODEL, temperature: 0, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "heard", strict: true, schema: schema(categories, places, goals) } } }, { effort: "minimal" })),
  });
  if (!res.ok) return await fail(res, await res.json().catch(() => ({})));
  let r: Record<string, unknown>;
  try { r = JSON.parse((await res.json()).choices?.[0]?.message?.content || "{}"); } catch { if (me.id) await giveBack(url, me.id); return json(502, { error: "The answer from OpenAI wasn't readable. Try again.", code: "openai" }); }

  const catSet = new Map(categories.map((c) => [c.toLowerCase(), c])), placeSet = new Map(places.map((c) => [c.toLowerCase(), c]));
  const intent = ["spend", "question", "ask", "remind", "list"].includes(String(r.intent)) ? String(r.intent) : "unclear";
  let spend = null;
  if (intent === "spend" && r.spend && typeof r.spend === "object") {
    const s = r.spend as Record<string, unknown>, str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const lines = (Array.isArray(s.lines) ? s.lines : []).slice(0, 30).map((l: Record<string, unknown>) => ({
      name: String(l.name || "").trim().slice(0, 120) || "Item", price: money(l.price) ?? 0,
      category: typeof l.category === "string" ? catSet.get(l.category.toLowerCase()) || null : null,
      place: typeof l.place === "string" ? placeSet.get(l.place.toLowerCase()) || null : null,
    })).filter((l) => l.price !== 0);
    const total = money(s.total) ?? (lines.length ? Math.round(lines.reduce((a, l) => a + l.price, 0) * 100) / 100 : null);
    const date = realDay(s.date, today);
    spend = { total, payee: str(s.payee, 120), date, note: str(s.note, 200), fromNextPay: s.from_next_pay === true, fromSavings: s.from_savings === true && s.from_next_pay !== true,
      goal: typeof s.goal === "string" ? goals.find((g) => g.toLowerCase() === (s.goal as string).toLowerCase()) || null : null, lines };
  }
  const items = intent === "list" ? (Array.isArray(r.items) ? r.items : []).slice(0, 40).map((x: Record<string, unknown>) => ({ name: String(x.name || "").trim().slice(0, 120), qty: money(x.qty) })).filter((x) => x.name) : [];
  return json(200, { transcript: String(r.transcript || text).slice(0, 500), reply: String(r.reply || "").trim().slice(0, 300), intent, spend, range: RANGES.includes(String(r.range)) ? r.range : null, items, used, limit: LIMIT });
});
