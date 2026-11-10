// Koti: read a receipt, a bill or a screenshot of a payment (photo, screenshot or PDF) with OpenAI.
// Receipts: shop, date, total and every line. Bills: company, amount, due date, payment reference and account (IBAN).
// Payments (payments.js): one payment on a bank, card or payment app's screen, or an order confirmation, money out or
// in; or several, as a bank app lists them.
// The OpenAI key lives only here, as the Edge Function secret OPENAI_API_KEY.
// Optional secrets: OPENAI_MODEL, OPENAI_REASONING (see ../_shared/openai.js), AI_DAILY_LIMIT (scans per user per day, default 30).
// @ts-ignore: plain JavaScript module, shared with the tests
import { chatBody, openaiError, OPENAI_BASE, MODEL } from "../_shared/openai.js";
// @ts-ignore: plain JavaScript module, shared with the tests (screenshots of payments)
import { PAYMENT_RULES, paymentSchema, cleanPayments } from "./payments.js";
// @ts-ignore: plain JavaScript module, a copy of js/printeddate.js (the tests check they're the same)
import { bestDate } from "./printeddate.js";
// @ts-ignore: plain JavaScript module, shared with the tests (what the person paid, and checking it adds up)
import { SHARE_RULES, shareSchema, applyShares } from "./shares.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
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
- doc_type: "receipt" for a shop or restaurant receipt (already paid), "bill" for an invoice or bill to pay (lasku, e-lasku, eräpäivä, viitenumero, tilinumero/IBAN), "payment" or "payments" for a screenshot of a payment or of several (see below), "other" only when it shows no money paid, owed or received at all.
For a bill, fill "bill" and leave items empty; for a receipt, set "bill" to null. "payments" is null unless doc_type is "payments"; "direction" is null unless doc_type is "payment".
- bill.company: who sent the bill. bill.amount: the amount to pay (Maksettava, Yhteensä). bill.due_date: eräpäivä as YYYY-MM-DD.
- bill.reference: the payment reference (viitenumero, RF reference) exactly as printed, with spaces. bill.iban: the recipient account (IBAN) as printed.
- bill.invoice_number: laskun numero, or null. bill.period: what the bill covers in a few words (e.g. "Electricity, October 2026"), or null.
- bill.match: if the bill is clearly one of the user's existing bills, that bill's exact name; otherwise null.
Receipt fields:
- items: every purchased product line, in order. Leave out totals, subtotals, VAT/ALV lines, payment lines (KORTTI, VISA, MAKSETTU), change and loyalty points.
- Apply a discount (ALENNUS, ETU, Plussa-etu, -30 %) to the product it belongs to, so price is what was actually paid for that line. A discount that applies to the whole receipt becomes its own line with a negative price.
- A bottle deposit (PANTTI) is its own line called "Bottle deposit"; returned deposits are negative.
- name_fi: the product name in Finnish, as on the receipt but readable: normal capitalisation and abbreviations written out (KEV.MAITO 1L → "Kevytmaito 1 l", RUISLP → "Ruisleipä"). If the receipt is in Swedish, give the Finnish name if you know it, otherwise the Swedish text made readable.
- name: the same product in English, always. Translate every Finnish or Swedish word: KEVYTMAITO 1L → "Low-fat milk 1 l", KAURAHIUTALE → "Oat flakes", JAUHELIHA → "Minced meat", RUISLEIPÄ → "Rye bread", PESUAINE → "Detergent", WC-PAPERI → "Toilet paper", PANTTI → "Bottle deposit". Expand abbreviations (KEV. → low-fat, LUOMU → organic, PKT → pack). If unsure, use the closest plain English product type (e.g. "Sausage", "Bread roll", "Snack"). Keep brand names as they are (Valio, Fazer, Pirkka). Never leave Finnish or Swedish words in name (they belong in name_fi).
- qty: the quantity when printed (2 KPL, 2 x, 0,512 kg → 0.512), otherwise null. price: the line total in euros.
- category: exactly one of the user's categories, chosen by what the product is, not by the shop. Typical fits: food and drink bought in a shop → the groceries category; meals, coffee or snacks bought to eat at a restaurant, café or kiosk → the eating-out category; medicine, pharmacy and health products → the health category; tickets, fuel, parking, taxi → the transport category; clothes, electronics, home and cleaning goods, toiletries → the shopping or household category; cinema, games, hobbies → the fun category. If nothing fits, use the catch-all category (Other) if the user has one.
- If the user has filed the same or a similar product before (listed below), use the same category they chose.
- list_item: if the line is something on the user's shopping list, that list item's exact text; otherwise null.
- place: the user may have projects for setting up a home, listed as places ("Project" or "Project › Room"). If the product is something for that home that stays there (furniture, lamps, curtains, rugs, bedding, towels, kitchenware, small appliances, storage, tools, decor, plants), the best place for it: the room it belongs in if there is one, otherwise the project. Food, drink, toiletries and cleaning products that get used up are never a place: use null. When unsure, null. Fill category as well either way.
- If the user filed the same or a similar product to a place before (listed below), use that place.
- date as YYYY-MM-DD (two-digit years are 20xx): the day it was bought or paid, never the day it is scanned. A date printed without a year ("8.11.", "SU 8.11.") or only as a weekday is the most recent such day that isn't after today (given below). null when there's no date at all. date_text: the date exactly as printed (e.g. "SU 08.11.26 14:02"), or null. total: what the person paid (see below; for a bill: the amount to pay). shop: for a bill, the company.
- is_receipt: true for a receipt, a bill or a payment, false for anything else.
- reply: Koti telling the person what it found, in English: one short, warm sentence of at most 20 words, never a label. For a receipt: the shop, the day, the total, and where most of it went (for example "A K-Market receipt from Tuesday: €23.40, mostly groceries, and the lamp goes to your Living room."). For a bill: who it's from, the amount and when it's due. If something needs checking (a date or total you couldn't read, another currency), say only that, briefly.
${PAYMENT_RULES}
${SHARE_RULES}`;

function buildSchema(categories: string[], listItems: string[], bills: string[], places: string[]) {
const oneOf = (vals: string[]) => vals.length ? { type: ["string", "null"], enum: [...vals, null] } : { type: "null" };
const schema = {
  type: "object", additionalProperties: false,
  required: ["is_receipt", "doc_type", "reply", "shop", "date", "date_text", "total", "printed_total", "covered_by_others", "currency", "items", "bill", "direction", "payments"],
  properties: {
    is_receipt: { type: "boolean" },
    reply: { type: "string" },
    doc_type: { type: "string", enum: ["receipt", "bill", "payment", "payments", "other"] },
    ...paymentSchema(categories),
    ...shareSchema(),
    bill: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      required: ["company", "amount", "due_date", "reference", "iban", "invoice_number", "period", "match"],
      properties: {
        company: { type: ["string", "null"] }, amount: { type: ["number", "null"] }, due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
        reference: { type: ["string", "null"] }, iban: { type: ["string", "null"] }, invoice_number: { type: ["string", "null"] },
        period: { type: ["string", "null"] }, match: oneOf(bills),
      },
    }] },
    shop: { type: ["string", "null"], description: "Shop name and branch as printed, e.g. K-Market Kamppi" },
    date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    date_text: { type: ["string", "null"], description: "The date exactly as printed" },
    total: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name_fi", "name", "qty", "price", "category", "list_item", "place"],
        properties: {
          name_fi: { type: "string", description: "Finnish, readable" },
          name: { type: "string", description: "English only" },
          qty: { type: ["number", "null"] },
          price: { type: "number" },
          category: categories.length ? { type: "string", enum: categories } : { type: "null" },
          list_item: oneOf(listItems),
          place: oneOf(places),
        },
      },
    },
  },
};
return schema;
}

/* Names that still look Finnish or Swedish after reading. */
const NON_ENGLISH = /[äöå]|maito|leipä|leipa|liha|juusto|kahvi|jogurtti|kerma|peruna|sipuli|omena|banaani|makkara|siideri|keksi|suklaa|karkki|pesuaine|paperi|saippua|hammastahna|rasvaton|kevyt|luomu|täysjyvä|kaura|vehnä|kastike|mauste|pakaste|jauhe|\b(muna|munat|kana|kala|olut|vesi|mehu|tuore|riisi|kpl|pss|pkt|rs|tlk)\b/i;

async function translateLeftovers(openaiKey: string, names: string[]): Promise<string[] | null> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(chatBody({ model: MODEL, temperature: 0,
      messages: [{ role: "system", content: "Translate Finnish or Swedish shop receipt product names into short, plain English product names. Keep brand names. Expand abbreviations. Return the same number of names, in the same order." },
        { role: "user", content: JSON.stringify(names) }],
      response_format: { type: "json_schema", json_schema: { name: "names", strict: true, schema: { type: "object", additionalProperties: false, required: ["names"], properties: { names: { type: "array", items: { type: "string" } } } } } } }, { effort: "minimal" })),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  try { const out = JSON.parse((await res.json()).choices?.[0]?.message?.content || "{}").names; return Array.isArray(out) && out.length === names.length ? out.map(String) : null; } catch { return null; }
}

/* A real calendar date (2026-02-31 isn't), no later than tomorrow; otherwise null. */
function realDay(v: unknown, latest: string) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T12:00:00Z");
  return d.toISOString().slice(0, 10) === v && v >= "1990-01-01" && v <= latest ? v : null;
}
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
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in to read receipts.", code: "auth" });
  const url = Deno.env.get("SUPABASE_URL") || "", key = projectKey();

  // Who is calling: only a signed-in Koti user.
  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } });
  if (!who.ok) return json(401, { error: "Your session ended. Sign in again.", code: "auth" });
  const me = await who.json().catch(() => ({})) as { id?: string };

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json(503, { error: "Receipt reading isn't set up yet. Add OPENAI_API_KEY in Supabase → Edge Functions → Secrets.", code: "no_key" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Send a JSON body." }); }
  const image = String(body.image || "");
  const isPdf = /^data:application\/pdf;base64,/.test(image);
  if (!(isPdf || /^data:image\/(jpeg|png|webp);base64,/.test(image)) || image.length > 8_000_000) return json(400, { error: "Send a JPEG, PNG or WebP photo, or a PDF, under 6 MB.", code: "image" });
  const uniq = (xs: string[]) => { const m = new Map<string, string>(); xs.forEach((x) => { if (!m.has(x.toLowerCase())) m.set(x.toLowerCase(), x); }); return [...m.values()]; };
  const categories = uniq(strList(body.categories, 40, 60)), listItems = uniq(strList(body.listItems, 200, 120)), bills = uniq(strList(body.bills, 60, 80)), places = uniq(strList(body.places, 60, 120));
  const hint = ["receipt", "bill"].includes(String(body.hint)) ? String(body.hint) : null;
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const catLower = new Map([...categories, ...places].map((c) => [c.toLowerCase(), c]));
  const examples = (Array.isArray(body.examples) ? body.examples : []).slice(0, 80)
    .filter((x: Record<string, unknown>) => x && typeof x.name === "string" && typeof x.category === "string" && catLower.has(String(x.category).toLowerCase()))
    .map((x: Record<string, unknown>) => `${String(x.name).slice(0, 60)} → ${catLower.get(String(x.category).toLowerCase())}`);

  // Count this scan; stops at the daily limit.
  const use = await fetch(`${url}/rest/v1/rpc/koti_ai_use`, { method: "POST", headers: { Authorization: auth, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ daily_limit: LIMIT }) });
  if (!use.ok) { const e = await use.json().catch(() => ({})); return json(429, { error: (e as { message?: string }).message || `Daily receipt limit reached (${LIMIT}).`, code: "limit" }); }
  const used = await use.json().catch(() => null);

  const prompt = `The user's categories: ${categories.length ? categories.join(" | ") : "(none)"}
Places in the user's home projects: ${places.length ? places.join(" | ") : "(none)"}
Open items on the user's shopping lists: ${listItems.length ? listItems.join(" | ") : "(none)"}
The user's existing bills: ${bills.length ? bills.join(" | ") : "(none)"}
How the user filed products before (follow these): ${examples.length ? examples.join("; ") : "(none yet)"}
Today is ${today} (${new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}).
${hint === "bill" ? "The user says this is a bill." : hint === "receipt" ? "The user says this is a receipt, or a payment." : "It may be a receipt, a bill, or a screenshot of a payment."} Read it.`;
  const doc = isPdf ? { type: "file", file: { filename: "document.pdf", file_data: image } } : { type: "image_url", image_url: { url: image, detail: "high" } };
  const schema = buildSchema(categories, listItems, bills, places);
  const first = [{ role: "system", content: SYSTEM }, { role: "user", content: [{ type: "text", text: prompt }, doc] }];
  /* One reading. Returns the parsed answer and its text, or an error to send back. */
  async function readIt(messages: unknown[]): Promise<{ r?: Record<string, unknown>; text?: string; error?: string }> {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(chatBody({ model: MODEL, temperature: 0, messages, response_format: { type: "json_schema", json_schema: { name: "receipt", strict: true, schema } } }, { effort: "low" })),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
      const m = e.error?.message || res.statusText;
      return { error: res.status === 401 ? "OpenAI didn't accept the key. Check OPENAI_API_KEY in Supabase."
        : res.status === 429 ? "OpenAI is out of credit or busy. Check your OpenAI billing, or try again in a minute."
        : /model/i.test(m) ? `The model "${MODEL}" isn't available on your OpenAI account. Set OPENAI_MODEL in Supabase to one that is.`
        : `OpenAI couldn't read it: ${m}` };
    }
    const text = (await res.json()).choices?.[0]?.message?.content || "{}";
    try { return { r: JSON.parse(text), text }; } catch { return { error: "The answer from OpenAI wasn't readable. Try again." }; }
  }
  const got = await readIt(first);
  if (got.error || !got.r) { if (me.id) await giveBack(url, me.id); return json(502, { error: got.error, code: "openai" }); }
  let r = got.r;
  // Check the reading adds up (the lines against what the person paid, after anyone else's part). When it doesn't,
  // the reader looks again, told exactly what doesn't add up, and the better of the two readings is kept.
  const sharesFor = (x: Record<string, unknown>) => applyShares({ items: Array.isArray(x.items) ? x.items as Record<string, unknown>[] : [], total: money(x.total), printedTotal: money(x.printed_total), others: x.covered_by_others as unknown[] });
  let checked = sharesFor(r);
  if (!checked.ok && ["receipt", "payment"].includes(String(r.doc_type))) {
    const again = await readIt([...first, { role: "assistant", content: got.text }, { role: "user", content: `That doesn't add up: ${checked.problem}. Look at the image again: each line's price, the printed total, and the payment lines at the bottom (who paid how much). Correct what was misread and give the whole reading again.` }]);
    if (again.r) { r = again.r; checked = sharesFor(again.r); }
  }
  if (r.is_receipt === false || r.doc_type === "other") return json(422, { error: "Koti couldn't find a payment, a receipt or a bill in that. Try a clearer picture, with the amount showing.", code: "not_receipt" });
  // Several payments, as a bank app lists them: each one on its own, for the person to tick.
  if (r.doc_type === "payments") {
    const payments = cleanPayments(r.payments, categories, today);
    if (!payments.length) return json(422, { error: "Koti saw payments but couldn't read any amount in full. Try a sharper screenshot.", code: "not_receipt" });
    return json(200, { doc_type: "payments", reply: String(r.reply || "").trim().slice(0, 300), payments, receipt: { shop: null, date: null, total: null, currency: r.currency || "EUR", items: [] }, bill: null, model: MODEL, used, limit: LIMIT });
  }

  const catSet = new Set(categories.map((c) => c.toLowerCase())), listSet = new Map(listItems.map((x) => [x.toLowerCase(), x])), placeSet = new Map(places.map((x) => [x.toLowerCase(), x]));
  const items = checked.items.slice(0, 150).map((x: Record<string, unknown>) => ({
    name_fi: String(x.name_fi || "").trim().slice(0, 120) || null,
    name: String(x.name || "").trim().slice(0, 120) || "Item",
    qty: money(x.qty),
    price: money(x.price) ?? 0,
    category: typeof x.category === "string" && catSet.has(x.category.toLowerCase()) ? categories.find((c) => c.toLowerCase() === (x.category as string).toLowerCase()) : null,
    list_item: typeof x.list_item === "string" ? listSet.get(x.list_item.toLowerCase()) || null : null,
    place: typeof x.place === "string" ? placeSet.get(x.place.toLowerCase()) || null : null,
  }));
  // Rail: English names must be English (the Finnish name is kept separately in name_fi). Anything that still looks Finnish or Swedish gets one more, translation-only pass.
  const left = items.map((it, k) => [k, it.name] as [number, string]).filter(([, n]) => NON_ENGLISH.test(n));
  if (left.length) { const t = await translateLeftovers(openaiKey, left.map(([, n]) => n)); if (t) left.forEach(([k], j) => { if (t[j] && t[j].trim()) items[k].name = t[j].trim().slice(0, 120); }); }
  // The day it happened: what the AI read, checked against the date as printed (a missing year, a misread year or
  // nothing at all is worked out here from the printed text). Never the day it was scanned by default.
  const date = bestDate(r.date, r.date_text, today);
  const total = checked.total ?? Math.round(items.reduce((a, i) => a + i.price, 0) * 100) / 100;
  const docType = r.doc_type === "bill" ? "bill" : r.doc_type === "payment" ? "payment" : "receipt";
  let bill = null;
  if (docType === "payment" && r.bill && typeof r.bill === "object") {   // a payment of one of their bills
    const m = String((r.bill as Record<string, unknown>).match || "").toLowerCase(), hit = bills.find((x) => x.toLowerCase() === m);
    if (hit) bill = { company: null, amount: total, due_date: null, reference: null, iban: null, invoice_number: null, period: null, match: hit };
  }
  if (docType === "bill" && r.bill && typeof r.bill === "object") {
    const b = r.bill as Record<string, unknown>, str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const due = realDay(b.due_date, "2100-12-31");
    const match = str(b.match, 80), billSet = new Map(bills.map((x) => [x.toLowerCase(), x]));
    bill = { company: str(b.company, 120) || (typeof r.shop === "string" ? r.shop.slice(0, 120) : null), amount: money(b.amount) ?? total, due_date: due, reference: str(b.reference, 60),
      iban: str(b.iban, 40), invoice_number: str(b.invoice_number, 60), period: str(b.period, 120), match: match ? billSet.get(match.toLowerCase()) || null : null };
  }
  const direction = docType === "payment" && r.direction === "in" ? "in" : docType === "payment" ? "out" : null;
  return json(200, { doc_type: docType, direction, reply: String(r.reply || "").trim().slice(0, 300), receipt: { shop: typeof r.shop === "string" ? r.shop.slice(0, 120) : null, date, total, currency: r.currency || "EUR", items: docType === "bill" ? [] : items,
    ...(checked.shares.length ? { printedTotal: checked.printedTotal, paidByOthers: checked.shares } : {}), ...(checked.ok ? {} : { check: checked.problem }) }, bill, model: MODEL, used, limit: LIMIT });
});
