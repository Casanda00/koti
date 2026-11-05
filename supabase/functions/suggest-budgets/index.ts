// Koti: suggest monthly budgets with OpenAI, after a few questions.
//   {step:"questions", context}            up to three short questions, each with answers to tap
//   {step:"suggest", context, answers}     a budget for each category, with a line on why
// The figures (pay, bills, savings plan, what's left for everyday spending, what each category took lately) are
// worked out in the app by js/engine.js and sent here; the AI only divides what's available. Its answer is checked
// here: only the person's own categories, whole amounts rounded to €5, and never more in total than is available.
// Nothing is saved: the app shows the suggestion and the person chooses to use it.
// Secrets: OPENAI_API_KEY. Optional: OPENAI_MODEL, AI_DAILY_LIMIT (shared with receipts and the microphone).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const OPENAI_BASE = Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";
const MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const LIMIT = Math.max(1, Number(Deno.env.get("AI_DAILY_LIMIT") || 30));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
type Row = Record<string, unknown>;
// @ts-ignore: plain JavaScript module, shared with the tests
import { checkBudgets } from "./check.js";
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

/* The context the app sent, kept to sane sizes and shapes. Money in euros. */
const eurosOf = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : null);
function cleanContext(c: Row) {
  const cats = (Array.isArray(c.categories) ? c.categories : []).slice(0, 40).filter((x: Row) => x && typeof x.name === "string" && x.name.trim())
    .map((x: Row) => ({ name: String(x.name).trim().slice(0, 60), budget: eurosOf(x.budget), average: eurosOf(x.average), thisMonth: eurosOf(x.thisMonth) ?? 0 }));
  return { income: eurosOf(c.income) ?? 0, bills: eurosOf(c.bills) ?? 0, savings: eurosOf(c.savings) ?? 0, available: eurosOf(c.available), monthsLookedAt: Math.max(0, Math.min(24, Number(c.monthsLookedAt) || 0)), daysLeft: Math.max(0, Math.min(31, Number(c.daysLeft) || 0)), categories: cats };
}
function describe(c: ReturnType<typeof cleanContext>) {
  const e = (n: number | null) => n == null ? "unknown" : `€${n.toFixed(2)}`;
  return [`Pay this month: ${e(c.income)}. Bills: ${e(c.bills)}. Savings plan: ${e(c.savings)}. Left for everyday spending: ${e(c.available)} a month.`,
    `Average spending per category over the last ${c.monthsLookedAt} month(s) with spending (null if no history), so far this month, and the current budget:`,
    ...c.categories.map((x) => `- ${x.name}: average ${e(x.average)}, this month so far ${e(x.thisMonth)}, budget ${x.budget == null ? "none" : e(x.budget)}`)].join("\n");
}

const SYSTEM = `You help one person in Finland set monthly budgets for everyday spending in a household money app. Be concrete and kind; plain English.
The app has worked out the money figures; never change them or invent others. Budgets cover only the categories listed, not bills or savings.`;
const QUESTIONS = `Ask up to three short questions whose answers change the budgets, and only what the figures can't tell you (for example: who lives in the household, how often they eat out or cook, whether they have a car or use public transport, anything big coming this month, what matters most to keep). Skip anything already clear from the spending history. Each question has 2 to 4 short answers to tap. intro: one sentence saying what you'll do.`;
const SUGGEST = `Suggest a monthly budget for each listed category, in whole euros, rounded to 5. Base each on their spending history where there is one, adjusted by their answers; where there is no history, use typical amounts for a household like theirs in Finland. The total must not be more than what is left for everyday spending; leave a little unbudgeted if you can. why: one short sentence per category, naming the figure or answer it rests on. note: one or two sentences on the overall plan.`;

const questionsSchema = { type: "object", additionalProperties: false, required: ["intro", "questions"], properties: {
  intro: { type: "string" },
  questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text", "options"], properties: {
    id: { type: "string" }, text: { type: "string" }, options: { type: "array", items: { type: "string" } } } } } } };
const suggestSchema = (names: string[]) => ({ type: "object", additionalProperties: false, required: ["budgets", "note"], properties: {
  note: { type: "string" },
  budgets: { type: "array", items: { type: "object", additionalProperties: false, required: ["category", "amount", "why"], properties: {
    category: { type: "string", enum: names }, amount: { type: "number" }, why: { type: "string" } } } } } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in to get budget suggestions.", code: "auth" });
  const url = Deno.env.get("SUPABASE_URL") || "", key = projectKey();
  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } });
  if (!who.ok) return json(401, { error: "Your session ended. Sign in again.", code: "auth" });
  const me = await who.json().catch(() => ({})) as { id?: string };
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json(503, { error: "AI isn't set up yet. Add OPENAI_API_KEY in Supabase → Edge Functions → Secrets.", code: "no_key" });

  let body: Row;
  try { body = await req.json(); } catch { return json(400, { error: "Send a JSON body." }); }
  const step = body.step === "suggest" ? "suggest" : "questions", ctx = cleanContext((body.context || {}) as Row);
  if (!ctx.categories.length) return json(400, { error: "Add a category first.", code: "input" });
  const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, 5).map((a: Row) => `${String(a.question || "").slice(0, 200)} → ${String(a.answer || "").slice(0, 200)}`);

  const use = await fetch(`${url}/rest/v1/rpc/koti_ai_use`, { method: "POST", headers: { Authorization: auth, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ daily_limit: LIMIT }) });
  if (!use.ok) return json(429, { error: `That's today's ${LIMIT} AI uses. Try again tomorrow, or set the budgets yourself.`, code: "limit" });
  const used = await use.json().catch(() => null);

  const names = ctx.categories.map((c) => c.name);
  const prompt = `${describe(ctx)}${ctx.daysLeft ? `\nDays left in this budget month: ${ctx.daysLeft}.` : ""}${answers.length ? `\nTheir answers:\n${answers.join("\n")}` : ""}\n\n${step === "suggest" ? SUGGEST : QUESTIONS}`;
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: step, strict: true, schema: step === "suggest" ? suggestSchema(names) : questionsSchema } } }),
  });
  if (!res.ok) {
    if (me.id) await giveBack(url, me.id);
    const e = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return json(502, { error: res.status === 401 ? "OpenAI didn't accept the key." : res.status === 429 ? "OpenAI is out of credit or busy. Try again in a minute." : `OpenAI couldn't do it: ${e.error?.message || res.statusText}`, code: "openai" });
  }
  let r: Row;
  try { r = JSON.parse((await res.json()).choices?.[0]?.message?.content || "{}"); } catch { if (me.id) await giveBack(url, me.id); return json(502, { error: "The answer from OpenAI wasn't readable. Try again.", code: "openai" }); }

  if (step === "questions") {
    const questions = (Array.isArray(r.questions) ? r.questions : []).slice(0, 3).map((q: Row, i: number) => ({ id: String(q.id || `q${i + 1}`).slice(0, 40), text: String(q.text || "").trim().slice(0, 200),
      options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim().slice(0, 60)).filter(Boolean).slice(0, 4) })).filter((q: Row) => q.text);
    return json(200, { intro: String(r.intro || "").slice(0, 300), questions, used, limit: LIMIT });
  }
  const checked = checkBudgets((r.budgets || []) as Row[], names, ctx.available);
  return json(200, { ...checked, available: ctx.available, note: String(r.note || "").slice(0, 400), used, limit: LIMIT });
});
