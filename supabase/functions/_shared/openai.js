// Koti's AI, in one place: which OpenAI model reads and thinks, and how a request is shaped for it.
// Plain JavaScript so the tests (Node) and the Edge Functions (Deno) share it.
//
// The default is gpt-5-mini (chosen 9 November 2026, replacing gpt-4o-mini): a reasoning model at a low price that
// follows the rules in long prompts, reads receipts and handwriting better, and can call tools (look things up) on
// its own, which the "koti" function needs. OPENAI_MODEL still overrides it, for every function at once.
//
// Reasoning models (gpt-5…, o-series) refuse "temperature" and take "reasoning_effort" instead: each function says
// how hard to think. The microphone wants an answer fast ("minimal"), receipts and conversations a little more ("low").
// OPENAI_REASONING overrides the effort everywhere (minimal, low, medium, high).

const env = name => { try { return globalThis.Deno ? globalThis.Deno.env.get(name) || "" : (globalThis.process && process.env[name]) || ""; } catch { return ""; } };

export const DEFAULT_MODEL = "gpt-5-mini";
export const MODEL = env("OPENAI_MODEL") || DEFAULT_MODEL;
export const OPENAI_BASE = env("OPENAI_BASE_URL") || "https://api.openai.com/v1";
export const STT_MODEL = env("OPENAI_TRANSCRIBE_MODEL") || "gpt-4o-mini-transcribe";
const EFFORTS = ["minimal", "low", "medium", "high"];

export const isReasoning = model => /^(gpt-5|o\d)/i.test(String(model || ""));

/* A chat completions body for the model: temperature for the older models, reasoning effort for the new ones. */
export function chatBody(body, { effort = "low", model = body.model || MODEL } = {}) {
  const out = { ...body, model };
  if (isReasoning(model)) {
    delete out.temperature;
    const e = env("OPENAI_REASONING");
    out.reasoning_effort = EFFORTS.includes(e) ? e : effort;
  } else delete out.reasoning_effort;
  return out;
}

/* An error from OpenAI, said in words a person can act on. */
export function openaiError(status, message, model = MODEL) {
  const m = String(message || "");
  if (status === 401) return "OpenAI didn't accept the key. Check OPENAI_API_KEY in Supabase.";
  if (status === 429) return "OpenAI is out of credit or busy. Try again in a minute.";
  if (/model/i.test(m) && /(not exist|not found|access|available)/i.test(m)) return `The model "${model}" isn't available on your OpenAI account. Set OPENAI_MODEL in Supabase to one that is.`;
  return `OpenAI couldn't do it: ${m || status}`;
}

/* Speech to text. words: names this person uses (shops, categories), so they're spelt the way they spell them. */
export async function transcribe({ fetch: f = fetch, key, bytes, type, lang = "en", words = [] }) {
  const ext = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : type.includes("mpeg") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), `said.${ext}`);
  form.append("model", STT_MODEL);
  form.append("language", lang);
  const base = lang === "fi" ? "Ostos ja hinta euroina, esim. Lidl 23,40 tai Prisma 86 euroa." : "A purchase and its price in euros, like Lidl 23,40 or Prisma 86 euros.";
  const names = words.filter(Boolean).slice(0, 40).join(", ");
  form.append("prompt", names ? `${base} ${lang === "fi" ? "Nimiä" : "Names"}: ${names}.`.slice(0, 800) : base);
  const res = await f(`${OPENAI_BASE}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(openaiError(res.status, e.error && e.error.message)), { status: res.status }); }
  return String((await res.json()).text || "").trim().slice(0, 1000);
}

/* "data:audio/webm;base64,…" → bytes and type, or null. */
export function audioOf(dataUrl) {
  const m = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return null;
  return { type: m[1].toLowerCase(), bytes: Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)) };
}
