// Koti: read a receipt or a bill (photo or PDF) with OpenAI.
// Receipts: shop, date, total and every line. Bills: company, amount, due date, payment reference and account (IBAN).
// The OpenAI key lives only here, as the Edge Function secret OPENAI_API_KEY.
// Optional secrets: OPENAI_MODEL (default below), AI_DAILY_LIMIT (scans per user per day, default 30).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const OPENAI_BASE = Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";
const MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const LIMIT = Math.max(1, Number(Deno.env.get("AI_DAILY_LIMIT") || 30));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const strList = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).slice(0, max).map((x) => (x as string).trim().slice(0, len));
const money = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : null);

function projectKey(): string {
  try { const k = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"); if (k.default) return k.default; } catch { /* use the legacy key */ }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

const SYSTEM = `You read shop receipts and bills (invoices), mostly from Finland (Finnish or Swedish text, comma decimals like 2,49).
Return only what is printed. Never invent items, prices, references or account numbers.
- doc_type: "receipt" for a shop or restaurant receipt (already paid), "bill" for an invoice or bill to pay (lasku, e-lasku, eräpäivä, viitenumero, tilinumero/IBAN), "other" for anything else.
For a bill, fill "bill" and leave items empty; for a receipt, set "bill" to null.
- bill.company: who sent the bill. bill.amount: the amount to pay (Maksettava, Yhteensä). bill.due_date: eräpäivä as YYYY-MM-DD.
- bill.reference: the payment reference (viitenumero, RF reference) exactly as printed, with spaces. bill.iban: the recipient account (IBAN) as printed.
- bill.invoice_number: laskun numero, or null. bill.period: what the bill covers in a few words (e.g. "Electricity, October 2026"), or null.
- bill.match: if the bill is clearly one of the user's existing bills, that bill's exact name; otherwise null.
Receipt fields:
- items: every purchased product line, in order. Leave out totals, subtotals, VAT/ALV lines, payment lines (KORTTI, VISA, MAKSETTU), change and loyalty points.
- Apply a discount (ALENNUS, ETU, Plussa-etu, -30 %) to the product it belongs to, so price is what was actually paid for that line. A discount that applies to the whole receipt becomes its own line with a negative price.
- A bottle deposit (PANTTI) is its own line called "Bottle deposit"; returned deposits are negative.
- name: a short, readable product name in English, translated from Finnish when the meaning is clear (MAITO 1L → "Milk 1 l", KAURAHIUTALE → "Oat flakes"). Keep a brand when it helps.
- qty: the quantity when printed (2 KPL, 2 x, 0,512 kg → 0.512), otherwise null. price: the line total in euros.
- category: the best fit from the user's categories, or null if none fits.
- list_item: if the line is something on the user's shopping list, that list item's exact text; otherwise null.
- date as YYYY-MM-DD (two-digit years are 20xx). total: the amount paid (for a bill: the amount to pay). shop: for a bill, the company.
- is_receipt: true for a receipt or a bill, false for anything else.`;

const schema = {
  type: "object", additionalProperties: false,
  required: ["is_receipt", "doc_type", "shop", "date", "total", "currency", "items", "bill"],
  properties: {
    is_receipt: { type: "boolean" },
    doc_type: { type: "string", enum: ["receipt", "bill", "other"] },
    bill: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      required: ["company", "amount", "due_date", "reference", "iban", "invoice_number", "period", "match"],
      properties: {
        company: { type: ["string", "null"] }, amount: { type: ["number", "null"] }, due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
        reference: { type: ["string", "null"] }, iban: { type: ["string", "null"] }, invoice_number: { type: ["string", "null"] },
        period: { type: ["string", "null"] }, match: { type: ["string", "null"] },
      },
    }] },
    shop: { type: ["string", "null"], description: "Shop name and branch as printed, e.g. K-Market Kamppi" },
    date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    total: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "qty", "price", "category", "list_item"],
        properties: {
          name: { type: "string" },
          qty: { type: ["number", "null"] },
          price: { type: "number" },
          category: { type: ["string", "null"] },
          list_item: { type: ["string", "null"] },
        },
      },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in to read receipts.", code: "auth" });
  const url = Deno.env.get("SUPABASE_URL") || "", key = projectKey();

  // Who is calling: only a signed-in Koti user.
  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } });
  if (!who.ok) return json(401, { error: "Your session ended. Sign in again.", code: "auth" });

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json(503, { error: "Receipt reading isn't set up yet. Add OPENAI_API_KEY in Supabase → Edge Functions → Secrets.", code: "no_key" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Send a JSON body." }); }
  const image = String(body.image || "");
  const isPdf = /^data:application\/pdf;base64,/.test(image);
  if (!(isPdf || /^data:image\/(jpeg|png|webp);base64,/.test(image)) || image.length > 8_000_000) return json(400, { error: "Send a JPEG, PNG or WebP photo, or a PDF, under 6 MB.", code: "image" });
  const categories = strList(body.categories, 40, 60), listItems = strList(body.listItems, 200, 120), bills = strList(body.bills, 60, 80);
  const hint = ["receipt", "bill"].includes(String(body.hint)) ? String(body.hint) : null;

  // Count this scan; stops at the daily limit.
  const use = await fetch(`${url}/rest/v1/rpc/koti_ai_use`, { method: "POST", headers: { Authorization: auth, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ daily_limit: LIMIT }) });
  if (!use.ok) { const e = await use.json().catch(() => ({})); return json(429, { error: (e as { message?: string }).message || `Daily receipt limit reached (${LIMIT}).`, code: "limit" }); }
  const used = await use.json().catch(() => null);

  const prompt = `The user's categories: ${categories.length ? categories.join(" | ") : "(none)"}
Open items on the user's shopping lists: ${listItems.length ? listItems.join(" | ") : "(none)"}
The user's existing bills: ${bills.length ? bills.join(" | ") : "(none)"}
${hint === "bill" ? "The user says this is a bill." : hint === "receipt" ? "The user says this is a receipt." : "It may be a receipt or a bill."} Read it.`;
  const doc = isPdf ? { type: "file", file: { filename: "document.pdf", file_data: image } } : { type: "image_url", image_url: { url: image, detail: "high" } };
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, temperature: 0,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: [{ type: "text", text: prompt }, doc] }],
      response_format: { type: "json_schema", json_schema: { name: "receipt", strict: true, schema } },
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
    const m = e.error?.message || res.statusText;
    const error = res.status === 401 ? "OpenAI didn't accept the key. Check OPENAI_API_KEY in Supabase."
      : res.status === 429 ? "OpenAI is out of credit or busy. Check your OpenAI billing, or try again in a minute."
      : /model/i.test(m) ? `The model "${MODEL}" isn't available on your OpenAI account. Set OPENAI_MODEL in Supabase to one that is.`
      : `OpenAI couldn't read it: ${m}`;
    return json(502, { error, code: "openai" });
  }
  const data = await res.json();
  let r: Record<string, unknown>;
  try { r = JSON.parse(data.choices?.[0]?.message?.content || "{}"); } catch { return json(502, { error: "The answer from OpenAI wasn't readable. Try again.", code: "openai" }); }
  if (r.is_receipt === false || r.doc_type === "other") return json(422, { error: "That doesn't look like a receipt or a bill. Try another photo.", code: "not_receipt" });

  const catSet = new Set(categories.map((c) => c.toLowerCase())), listSet = new Map(listItems.map((x) => [x.toLowerCase(), x]));
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 150).map((x: Record<string, unknown>) => ({
    name: String(x.name || "").trim().slice(0, 120) || "Item",
    qty: money(x.qty),
    price: money(x.price) ?? 0,
    category: typeof x.category === "string" && catSet.has(x.category.toLowerCase()) ? categories.find((c) => c.toLowerCase() === (x.category as string).toLowerCase()) : null,
    list_item: typeof x.list_item === "string" ? listSet.get(x.list_item.toLowerCase()) || null : null,
  }));
  const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  const total = money(r.total) ?? Math.round(items.reduce((a, i) => a + i.price, 0) * 100) / 100;
  const docType = r.doc_type === "bill" ? "bill" : "receipt";
  let bill = null;
  if (docType === "bill" && r.bill && typeof r.bill === "object") {
    const b = r.bill as Record<string, unknown>, str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const due = typeof b.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : null;
    const match = str(b.match, 80), billSet = new Map(bills.map((x) => [x.toLowerCase(), x]));
    bill = { company: str(b.company, 120) || (typeof r.shop === "string" ? r.shop.slice(0, 120) : null), amount: money(b.amount) ?? total, due_date: due, reference: str(b.reference, 60),
      iban: str(b.iban, 40), invoice_number: str(b.invoice_number, 60), period: str(b.period, 120), match: match ? billSet.get(match.toLowerCase()) || null : null };
  }
  return json(200, { doc_type: docType, receipt: { shop: typeof r.shop === "string" ? r.shop.slice(0, 120) : null, date, total, currency: r.currency || "EUR", items: docType === "bill" ? [] : items }, bill, model: MODEL, used, limit: LIMIT });
});
