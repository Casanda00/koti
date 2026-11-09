// Payments seen on a screen: a screenshot of a bank or card app, MobilePay, a transfer, PayPal or Klarna, a payment
// notification, or an order confirmation from an online shop or a delivery app. Until 9 November 2026 the reader knew
// only receipts and bills, and refused every one of these as "not a receipt".
//   payment    one payment: who was paid (or who paid you), the amount, the day, and the lines if the order lists them
//   payments   several, as a bank app lists them: each one on its own
// Screens rarely print a year ("Today 14:32", "Eilen", "12.11."), so dates are read against the person's today.
// Plain JavaScript, shared by the Edge Function (Deno) and the tests (Node).
import { bestDate } from "./printeddate.js";

export const PAYMENT_RULES = `Screenshots of payments are common. Read them too:
- doc_type "payment": a screen showing ONE payment: a bank or card app (OP, Nordea, S-Pankki, Danske, Revolut, Wise), MobilePay or Pivo, a bank transfer (tilisiirto), PayPal, Klarna, Apple Pay or Google Pay, a payment notification, or an order or payment confirmation from an online shop or delivery app (Wolt, Foodora, Zalando, Verkkokauppa.com, Amazon, Tori). shop: who was paid, as a person would say it (the merchant without card codes, city or terminal numbers: "K-MARKET KAMPPI HKI 0123" → "K-Market Kamppi", "WOLT OY" → "Wolt"; for a transfer, the recipient's name). total: the amount paid, as a positive number. date: the payment day. direction: "out" when money left them (a purchase, a payment, a transfer they sent), "in" when money came to them (received, a refund, a salary, MobilePay from a friend). items: the order lines when the screen lists them; otherwise one line naming what it was (from the merchant or the message, e.g. "Food delivery", "Rent", "Groceries") with the whole amount and its category. If the payee is clearly one of the user's existing bills, set bill.match to that bill and leave the other bill fields null.
- doc_type "payments": a screen listing SEVERAL payments (a bank app's transactions, a card statement). Fill payments with every payment you can read in full, top to bottom, and leave items empty: payee as a person would say it, amount positive, date, date_text (the date or day exactly as the screen shows it for that payment, or the heading it sits under, like "Eilen" or "Su 8.11."), direction, category (one of the user's categories, by what it is; null for money in), and note (a few words if the screen says what it was, otherwise null). Skip lines whose amount you can't read; never guess. Balances are not payments.
- Dates on screens often have no year or are words ("Today", "Tänään", "Yesterday", "Eilen", "Mon", "12.11."): use today's date given below, and the most recent such day that isn't after today.
- reply for a payment: who it was to (or from), the amount, the day, and what it was for; for payments: how many you found, from when to when, and the total out.`;

export function paymentSchema(categories) {
  const cat = categories.length ? { type: ["string", "null"], enum: [...categories, null] } : { type: "null" };
  return {
    direction: { type: ["string", "null"], enum: ["out", "in", null], description: "For a payment: out (paid) or in (received)" },
    payments: { anyOf: [{ type: "null" }, { type: "array", items: { type: "object", additionalProperties: false, required: ["payee", "amount", "date", "date_text", "direction", "category", "note"],
      properties: { payee: { type: ["string", "null"] }, amount: { type: "number" }, date: { type: ["string", "null"], description: "YYYY-MM-DD" }, date_text: { type: ["string", "null"], description: "As printed" }, direction: { type: "string", enum: ["out", "in"] }, category: cat, note: { type: ["string", "null"] } } } }] },
  };
}

const money = v => (typeof v === "number" && isFinite(v) ? Math.round(Math.abs(v) * 100) / 100 : null);
const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
/* A real calendar date, no later than tomorrow (time zones) and not before 1990; otherwise null. */
export function realDay(v, today) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T12:00:00Z");
  return d.toISOString().slice(0, 10) === v && v >= "1990-01-01" && v <= addDays(today, 1) ? v : null;
}

/* Several payments read from a screen, cleaned: real amounts, real days, their own categories, at most 60. */
export function cleanPayments(list, categories, today) {
  const cats = new Map(categories.map(c => [c.toLowerCase(), c]));
  const str = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  return (Array.isArray(list) ? list : []).slice(0, 60).map(p => {
    const amount = money(p && p.amount), direction = p && p.direction === "in" ? "in" : "out";
    return amount ? { payee: str(p.payee, 120), amount, date: bestDate(p.date, p.date_text, today), direction,
      category: direction === "out" && typeof p.category === "string" ? cats.get(p.category.toLowerCase()) || null : null, note: str(p.note, 200) } : null;
  }).filter(Boolean);
}
