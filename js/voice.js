// Turns a spoken or typed phrase into an expense: amount, category, place, date and note.
// Works with English and Finnish, with digits ("12,50") or number words ("twelve fifty", "kaksitoista viisikymmentä").

/* ---------- Number words ---------- */
const EN_UNITS = { zero: 0, oh: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const EN_TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const EN_TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const FI_UNITS = [["yhdeksän", 9], ["kahdeksan", 8], ["seitsemän", 7], ["kuusi", 6], ["viisi", 5], ["neljä", 4], ["kolme", 3], ["kaksi", 2], ["yksi", 1], ["nolla", 0]];

function enType(w) {
  if (w in EN_TEENS) return ["teen", EN_TEENS[w]];
  if (w in EN_TENS) return ["tens", EN_TENS[w]];
  if (w === "hundred") return ["hundred", 100];
  if (w === "thousand") return ["thousand", 1000];
  if (w in EN_UNITS && w !== "a" && w !== "an") return ["unit", EN_UNITS[w]];
  return null;
}
/* One Finnish number word, e.g. "kaksikymmentäkolme" → 23. Returns null if it isn't one. */
export function fiWord(w) {
  let i = 0, total = 0, chunk = 0, unit = null, hit = false;
  const take = s => (w.startsWith(s, i) ? (i += s.length, true) : false);
  while (i < w.length) {
    if (take("kymmenen")) { chunk += 10; hit = true; continue; }
    if (take("toista")) { chunk += 10 + (unit || 0); unit = null; hit = true; continue; }
    if (take("kymmentä")) { chunk += (unit || 1) * 10; unit = null; hit = true; continue; }
    if (take("sataa") || take("sata")) { chunk += (unit || 1) * 100; unit = null; hit = true; continue; }
    if (take("tuhatta") || take("tuhat")) { total += ((chunk + (unit || 0)) || 1) * 1000; chunk = 0; unit = null; hit = true; continue; }
    const u = FI_UNITS.find(([s]) => w.startsWith(s, i));
    if (u) { if (unit !== null) { chunk += unit; } unit = u[1]; i += u[0].length; hit = true; continue; }
    return null;
  }
  return hit ? total + chunk + (unit || 0) : null;
}

/* Splits tokens into number groups: "twelve fifty" → [12, 50], "twenty three" → [23]. */
function numberGroups(tokens) {
  const out = []; let cur = null, last = "none", start = 0;
  const close = end => { if (cur) { out.push({ value: cur.small + cur.big, start, end }); cur = null; last = "none"; } };
  tokens.forEach((raw, i) => {
    const w = raw.toLowerCase();
    if (w === "and" && cur) return;
    let t = enType(w);
    if (!t) { const f = fiWord(w); if (f !== null) t = ["fi", f]; }
    if (!t) { close(i); return; }
    const [type, v] = t;
    const ok = cur && ({ unit: ["tens", "hundred", "thousand"], teen: ["hundred", "thousand"], tens: ["hundred", "thousand"], hundred: ["unit", "teen"], thousand: ["unit", "teen", "tens", "hundred"], fi: [] }[type] || []).includes(last);
    if (!ok) { close(i); cur = { small: 0, big: 0 }; start = i; }
    if (type === "hundred") cur.small = (cur.small || 1) * 100;
    else if (type === "thousand") { cur.big += (cur.small || 1) * 1000; cur.small = 0; }
    else cur.small += v;
    last = type;
  });
  close(tokens.length);
  return out;
}

const EURO = /^(e|eur|euro|euros|euroa|€)$/i, CENT = /^(cent|cents|senttiä|sentti|snt)$/i;
export function parseAmount(text) {
  const t = text.replace(/€\s*(\d+(?:[.,]\d{1,2})?)/g, "$1 €");
  // digits first: "12,50", "12.50", "12 euros 50", "1 234,50"
  const m = t.match(/(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)/);
  if (m) {
    let v = Number(m[1].replace(/[  ]/g, "")) + (m[2] ? Number(m[2].padEnd(2, "0")) / 100 : 0);
    if (!m[2]) { const after = t.slice(m.index + m[0].length).match(/^\s*(?:e|eur|euros?|euroa|€)?\s*(?:and|ja)?\s*(\d{1,2})\s*(?:cents?|senttiä|snt)\b/i); if (after) v += Number(after[1]) / 100; }
    return { amount: Math.round(v * 100) / 100, span: [m.index, m.index + m[0].length] };
  }
  // words: "twelve fifty", "twenty three euros forty", "kaksitoista viisikymmentä", "twelve point five"
  const tokens = t.toLowerCase().replace(/[^\p{L}\p{N}€\s-]/gu, " ").split(/[\s-]+/).filter(Boolean);
  const g = numberGroups(tokens);
  if (!g.length) return null;
  let a = g[0].value, end = g[0].end;
  const between = i => tokens.slice(g[i].end, g[i + 1].start);
  if (g[1]) {
    const mid = between(0);
    if (mid.length === 1 && /^(point|pilkku)$/.test(mid[0])) { a = Number(`${a}.${g[1].value}`); end = g[1].end; }
    else if ((mid.length === 0 || mid.every(w => EURO.test(w) || w === "and" || w === "ja")) && g[1].value < 100) { a += g[1].value / 100; end = g[1].end; }
  }
  return a > 0 ? { amount: Math.round(a * 100) / 100, words: tokens.slice(g[0].start, end) } : null;
}

/* ---------- Categories, places, dates ---------- */
const KEYWORDS = {
  "Groceries": ["groceries", "grocery", "supermarket", "food shop", "food", "ruoka", "ruokaa", "ruokakauppa", "kauppa", "kaupasta", "kaupassa", "ostokset", "maito"],
  "Eating out": ["lunch", "dinner", "breakfast", "restaurant", "cafe", "café", "coffee", "pizza", "burger", "kebab", "sushi", "takeaway", "lounas", "lounasta", "illallinen", "aamiainen", "ravintola", "ravintolassa", "kahvi", "kahvila", "kahvilassa", "wolt", "foodora"],
  "Transport": ["bus", "train", "tram", "metro", "taxi", "uber", "bolt", "fuel", "petrol", "parking", "ticket", "hsl", "vr", "bussi", "juna", "ratikka", "raitiovaunu", "taksi", "bensa", "bensiini", "pysäköinti", "lippu"],
  "Shopping": ["clothes", "shoes", "shirt", "jacket", "shopping", "vaatteet", "kengät", "paita", "takki", "ikea", "h&m", "tokmanni", "clas ohlson", "jysk", "gigantti", "verkkokauppa", "power", "stockmann"],
  "Health": ["pharmacy", "medicine", "doctor", "dentist", "apteekki", "apteekista", "lääke", "lääkäri", "hammaslääkäri", "terveystalo", "mehiläinen"],
  "Fun": ["cinema", "movie", "movies", "concert", "game", "games", "bar", "beer", "drinks", "museum", "elokuva", "leffa", "keikka", "konsertti", "olut", "kalja", "baari", "museo", "finnkino"],
};
export const KNOWN_PLACES = [["K-Market", "Groceries", /k[\s-]?market/i], ["K-Supermarket", "Groceries", /k[\s-]?supermarket/i], ["K-Citymarket", "Groceries", /k[\s-]?citymarket|citymarket/i],
  ["S-Market", "Groceries", /s[\s-]?market/i], ["Prisma", "Groceries", /prisma/i], ["Alepa", "Groceries", /alepa/i], ["Sale", "Groceries", /\bsale\b/i], ["Lidl", "Groceries", /lidl/i], ["Tokmanni", "Shopping", /tokmanni/i],
  ["Alko", "Groceries", /\balko\b/i], ["R-Kioski", "Other", /r[\s-]?kioski/i], ["HSL", "Transport", /\bhsl\b/i], ["VR", "Transport", /\bvr\b/i], ["IKEA", "Shopping", /ikea/i], ["Clas Ohlson", "Shopping", /clas\s?ohlson/i],
  ["Jysk", "Shopping", /jysk/i], ["H&M", "Shopping", /h\s?(&|and|ja)\s?m\b/i], ["Gigantti", "Shopping", /gigantti/i], ["Verkkokauppa", "Shopping", /verkkokauppa/i], ["Wolt", "Eating out", /wolt/i], ["Foodora", "Eating out", /foodora/i],
  ["Hesburger", "Eating out", /hesburger|hese/i], ["McDonald's", "Eating out", /mcdonald|mäkkäri/i], ["Subway", "Eating out", /subway/i], ["Starbucks", "Eating out", /starbucks/i], ["Robert's Coffee", "Eating out", /robert'?s/i], ["Apteekki", "Health", /apteek/i], ["Finnkino", "Fun", /finnkino/i]];
const FI_PLACE = /^(\p{Lu}[\p{L}'&-]*?)(?:i)?(ssa|ssä|sta|stä|lla|llä|lta|ltä)$/u;
const STOP = new Set(["for", "at", "from", "in", "on", "the", "a", "an", "i", "spent", "paid", "bought", "euros", "euro", "eur", "cents", "today", "yesterday", "and", "ja", "euroa", "senttiä", "tänään", "eilen", "toissapäivänä", "maksoin", "ostin", "käytin"]);
/* Words after "from" or "at" that are where the money came from, not a place: "from my upcoming salary". */
const NOT_PLACE = /^(my|your|our|his|her|their|this|that|next|mun|minun|sun)\b|\b(salary|pay|paycheck|wages?|account|card|wallet|savings|pocket|cash|loan|palkka|palkasta|tili|tililtä|kortti|kortilla|säästöt)\b/i;
/* Paid out of pay that hasn't come yet: "from my upcoming salary", "next pay", "until payday", "seuraavasta palkasta". */
/* Where the money came from (6 November 2026, the owner's rule): said, it isn't today's money; not said, it is.
   Pay or salary, upcoming or not: it comes out of the next pay. Savings: out of a savings goal. */
export const NEXT_PAY = /\b(?:upcoming|next|coming|future)\s+(?:salary|pay(?:check|cheque|day)?|wages?)\b|\b(?:from|out\s+of)\s+(?:my\s+|the\s+)?(?:salary|pay(?:check|cheque)?|wages?)\b|\bpalka(?:sta|stani)\b|\buntil\s+(?:payday|pay\s*day|i\s+get\s+paid)\b|\bwhen\s+i\s+get\s+paid\b|\b(?:seuraava(?:sta)?|ensi|tuleva(?:sta)?)\s+palka(?:sta|n)?\b|\bpalkkapäivä(?:nä|än)\b/i;
export const FROM_SAVINGS = /\b(?:from|out\s+of)\s+(?:my\s+|our\s+|the\s+)?(?:savings?(?:\s+account)?|[\p{L}-]+\s+(?:fund|savings))\b|(?<!\p{L})säästö(?:istä|istäni|tililtä)(?!\p{L})/iu;
const cap = s => s.replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

export function parseExpense(text, { categories = [], history = [], today = new Date() } = {}) {
  // "from my next pay" says when it's paid, not what it was: noted, then taken out before the rest is read.
  const said = String(text || "").trim(), fromNextPay = NEXT_PAY.test(said), fromSavings = !fromNextPay && FROM_SAVINGS.test(said);
  const strip = re => t => t.replace(new RegExp(`\\s*(?:(?:from|out of|on)\\s+(?:my\\s+|the\\s+)?)?(?:${re.source})`, "giu"), " ");
  const raw = strip(FROM_SAVINGS)(strip(NEXT_PAY)(said)).replace(/\s+/g, " ").trim(); const lower = raw.toLowerCase();
  const out = { amount: null, categoryId: null, payee: null, date: null, note: null, fromNextPay, fromSavings };
  if (!raw) return out;
  const amt = parseAmount(raw); if (amt) out.amount = amt.amount;
  const byName = n => categories.find(c => c.name.toLowerCase() === n.toLowerCase());

  // date
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (/\b(day before yesterday)\b|toissapäivänä/.test(lower)) d.setDate(d.getDate() - 2);
  else if (/\byesterday\b|\beilen\b/.test(lower)) d.setDate(d.getDate() - 1);
  out.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // place: earlier payees first, then known chains, then "at X" / Finnish place endings
  const prev = [...history].reverse().find(t => t.payee && lower.includes(t.payee.toLowerCase()));
  if (prev) { out.payee = prev.payee; out.categoryId = prev.categoryId || null; }
  if (!out.payee) { const k = KNOWN_PLACES.find(([, , re]) => re.test(raw)); if (k) { out.payee = k[0]; const c = byName(k[1]); if (c) out.categoryId = c.id; } }
  if (!out.payee) { const m = raw.match(/\b(?:at|from|in)\s+([\p{L}\p{N}'&.\- ]+?)(?:\s+(?:for|on|yesterday|today|with)\b|[,.!?]|$)/iu); if (m && !/^\d/.test(m[1]) && !STOP.has(m[1].toLowerCase()) && !NOT_PLACE.test(m[1].trim())) out.payee = cap(m[1].trim()); }
  if (!out.payee) { for (const w of raw.split(/\s+/)) { const m = w.replace(/[,.!?]$/, "").match(FI_PLACE); if (m && !Object.values(KEYWORDS).flat().includes(w.toLowerCase())) { out.payee = m[1]; break; } } }

  // category: words in the phrase, then the user's own category names
  if (!out.categoryId) {
    const words = lower.replace(/[^\p{L}&'\s-]/gu, " ");
    const ws = words.split(/\s+/).filter(Boolean);
    const hit = k => k.includes(" ") || k.includes("&") ? words.includes(k) : ws.some(w => w === k || (k.length >= 4 && w.startsWith(k)));   // "kahvia" matches "kahvi"
    for (const [name, keys] of Object.entries(KEYWORDS)) { if (keys.some(hit)) { const c = byName(name); if (c) { out.categoryId = c.id; break; } } }
  }
  if (!out.categoryId) { const c = categories.find(c => lower.includes(c.name.toLowerCase())); if (c) out.categoryId = c.id; }

  // note: "for lunch", or the leftover describing words
  const f = raw.match(/\bfor\s+(?:a\s+|an\s+|the\s+|some\s+)?([\p{L}' -]+?)(?:\s+(?:at|from|in|on|yesterday|today)\b|[,.!?]|$)/iu);
  if (f) out.note = f[1].trim();
  else {
    const amountWords = new Set((amt && amt.words) || []);
    const left = raw.replace(/€?\s*\d+(?:[.,]\d{1,2})?\s*€?/g, " ").split(/\s+/).map(w => w.replace(/[,.!?]$/, "")).filter(w => w && !STOP.has(w.toLowerCase()) && !amountWords.has(w.toLowerCase()) && !(out.payee && out.payee.toLowerCase().split(/\s+/).some(p => w.toLowerCase().startsWith(p.slice(0, 4)))) && !FI_PLACE.test(w));
    if (left.length && left.length <= 4) out.note = left.join(" ");
  }
  return out;
}

/* ---------- Speech recognition ---------- */
export const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export function listen({ lang = "en-GB", onText, onEnd, onError, continuous = false }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR(); r.lang = lang; r.interimResults = true; r.continuous = continuous; r.maxAlternatives = 1;
  r.onresult = e => { let s = ""; for (const res of e.results) s += res[0].transcript; onText(s, e.results[e.results.length - 1].isFinal); };
  r.onerror = e => onError && onError(e.error);
  r.onend = () => onEnd && onEnd();
  r.start();
  return () => { try { r.stop(); } catch {} };
}
