// What the person paid, and checking a reading adds up. Added 10 November 2026, after a lunch receipt where the
// employer paid €3.50 of €14.00 was saved as €14.00: the reader took the printed total as what came out of the
// person's pocket.
//
// The reader returns the full prices of the lines, the printed total, and each part someone or something else paid
// (an employer or a lunch benefit, a voucher or gift card, someone's share of a split bill, points used as money). Here
// those parts become negative lines, so what's saved is what the person paid and the lines still add up to it. Nothing
// here knows about employers or any one kind of share: the reader names them, this only does the arithmetic.
//
// Then the reading is checked: the lines should add up to the total. When they don't, the reader is asked to look
// again, told exactly what doesn't add up (see review() in index.ts).
// Plain JavaScript, shared by the Edge Function (Deno) and the tests (Node).

export const SHARE_RULES = `What the person paid:
- total: what came out of the person's own money. printed_total: the total printed on the receipt or screen, before anyone else's part. They differ when someone or something else paid part of it: read the payment lines at the bottom (who or what paid how much).
- covered_by_others: each part of the price that was NOT paid by the person: an employer's or a benefit's share (lunch benefit, staff meal, Edenred, ePassi, Smartum), a voucher, gift card or credit, loyalty points used as money, a deposit or refund used as payment, someone else's share of a split bill. label: a few English words saying who or what paid ("Paid by your employer", "Gift card"); amount: positive euros. Empty when the person paid it all. Never put these parts in items: items keep their full prices.
- A discount is not covered_by_others: it lowers the price of the line it belongs to (see above).
- Check before answering: the items should add up to printed_total, and printed_total minus covered_by_others should be total. If they don't, look again at the image.
- reply: when someone else paid part, say what the person paid and who paid the rest ("Lunch at Prandia on Monday: you paid €10.50, your employer €3.50.").`;

export const shareSchema = () => ({
  printed_total: { type: ["number", "null"], description: "The total as printed, before anyone else's part" },
  covered_by_others: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "amount"], properties: { label: { type: "string" }, amount: { type: "number" } } } },
});

const money = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : null);
const c = v => Math.round((Number(v) || 0) * 100);
const sum = items => items.reduce((s, i) => s + c(i.price), 0);

/* The parts others paid, cleaned: a label and an amount above zero, at most 6. */
export function sharesOf(list) {
  return (Array.isArray(list) ? list : []).map(x => ({ label: typeof (x && x.label) === "string" && x.label.trim() ? x.label.trim().slice(0, 80) : "Paid by someone else", amount: money(x && x.amount) }))
    .filter(x => x.amount && x.amount > 0 && x.amount < 1e6).slice(0, 6);
}

/* The category most of the money went to: where a share the reader didn't place belongs. */
const mainCategory = items => { const by = {}; items.forEach(i => { if (i.category) by[i.category] = (by[i.category] || 0) + Math.abs(c(i.price)); }); return Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };

/* items (full prices), the reader's total and printed total, and the shares → what's saved, and whether it adds up.
   ok: the lines add up to the total (to a cent or two, for rounding). problem: what doesn't, in words for the reader. */
export function applyShares({ items = [], total = null, printedTotal = null, others = [] }) {
  const shares = sharesOf(others), sh = shares.reduce((s, x) => s + c(x.amount), 0);
  const lines = items.map(i => ({ ...i }));
  const full = printedTotal != null ? c(printedTotal) : lines.length ? sum(lines) : total != null ? c(total) + sh : null;
  let paid = total != null ? c(total) : full != null ? full - sh : null;
  // The reader gave the full price as the total even though others paid part of it: what the person paid is the rest.
  if (sh && full != null && paid === full) paid = full - sh;
  if (sh && lines.length) {
    const cat = mainCategory(lines);
    shares.forEach(x => lines.push({ name_fi: x.label, name: x.label, qty: null, price: -x.amount, category: cat, list_item: null, place: null, share: true }));
  }
  const problems = [];
  if (paid != null && paid <= 0) problems.push(`others paid ${(sh / 100).toFixed(2)} of a ${((full || 0) / 100).toFixed(2)} total, which leaves nothing for the person`);
  if (lines.length && paid != null && Math.abs(sum(lines) - paid) > 2) problems.push(`the lines add up to ${(sum(lines) / 100).toFixed(2)} but the person paid ${(paid / 100).toFixed(2)}${sh ? ` (a ${(full / 100).toFixed(2)} total less ${(sh / 100).toFixed(2)} paid by others)` : ""}`);
  return { items: lines, total: paid == null ? null : paid / 100, printedTotal: full == null ? null : full / 100, shares, ok: !problems.length, problem: problems.join("; ") || null };
}
