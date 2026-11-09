// Screenshots of payments (a bank or card app, MobilePay, an order confirmation). Until 9 November 2026 the reader
// knew only receipts and bills, and refused every screenshot of a payment as "not a receipt or a bill".
// Here: what the reader returns is cleaned (supabase/functions/read-receipt/payments.js), the phone turns it into
// payments with its own categories (js/receipts.js), a payment already in Koti isn't counted twice, and a payment of
// one of your bills is matched to that bill (js/scan.js).
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
import { cleanPayments, realDay, paymentSchema, PAYMENT_RULES } from "../supabase/functions/read-receipt/payments.js";
setToday("2027-03-10");
localStorage.setItem("koti.consent", JSON.stringify({ v: 1, ai: true, at: "2027-03-01T10:00:00Z" }));   // Koti's AI allowed on this device (js/privacy.js)
globalThis.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then(a => { this.result = `data:${b.type};base64,` + Buffer.from(a).toString("base64"); this.onload(); }); } };
const { store } = await import("../js/data.js");
const { sync } = await import("../js/sync.js");
const { readReceipt } = await import("../js/receipts.js");
const S = await import("../js/scan.js");

test("the reader is told what a payment screenshot is, and may answer with one or several", () => {
  assert.match(PAYMENT_RULES, /doc_type "payment"/);
  assert.match(PAYMENT_RULES, /doc_type "payments"/);
  assert.match(PAYMENT_RULES, /MobilePay/);
  const sch = paymentSchema(["Groceries"]);
  assert.deepEqual(sch.direction.enum, ["out", "in", null]);
  assert.deepEqual(sch.payments.anyOf[1].items.properties.category.enum, ["Groceries", null]);
});

test("payments read from a screen are cleaned: real amounts, real days, their own categories", () => {
  const out = cleanPayments([
    { payee: " Wolt ", amount: -23.4, date: "2027-03-09", direction: "out", category: "eating out", note: null },
    { payee: "Matti", amount: 15, date: "2027-03-10", direction: "in", category: "Groceries", note: "MobilePay" },
    { payee: "Unreadable", amount: 0, date: "2027-03-08", direction: "out", category: null, note: null },
    { payee: "Next year", amount: 9, date: "2028-01-01", direction: "out", category: "Snacks", note: null },
  ], ["Groceries", "Eating out"], "2027-03-10");
  assert.deepEqual(out, [
    { payee: "Wolt", amount: 23.4, date: "2027-03-09", direction: "out", category: "Eating out", note: null },
    { payee: "Matti", amount: 15, date: "2027-03-10", direction: "in", category: null, note: "MobilePay" },
    { payee: "Next year", amount: 9, date: null, direction: "out", category: null, note: null },
  ]);
  assert.equal(realDay("2027-02-30", "2027-03-10"), null);
  assert.equal(realDay("2027-03-11", "2027-03-10"), "2027-03-11", "tomorrow is allowed (time zones)");
});

function reader(data) {
  sync.user = { id: "u" };
  const calls = [];
  sync.client = { functions: { invoke: async (name, { body }) => { calls.push({ name, body }); return { data: { used: 1, limit: 30, ...data }, error: null }; } } };
  return calls;
}
const shot = { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), type: "image/png" };

test("a screenshot of several payments comes back as payments, each with the person's own category", async () => {
  const calls = reader({ doc_type: "payments", reply: "Three payments from your bank app.", receipt: { shop: null, date: null, total: null, items: [] }, bill: null,
    payments: [{ payee: "Lidl", amount: 23.4, date: "2027-03-09", direction: "out", category: "Groceries", note: null }, { payee: "Matti", amount: 15, date: "2027-03-08", direction: "in", category: null, note: null }] });
  const r = await readReceipt(shot);
  assert.equal(calls[0].name, "read-receipt");
  assert.equal(calls[0].body.today, "2027-03-10", "the screen's 'Today' and 'Yesterday' need the phone's day");
  assert.equal(r.docType, "payments");
  const gro = store.model.categories.find(c => c.name === "Groceries").id;
  assert.deepEqual(r.payments, [
    { payee: "Lidl", amount: 23.4, date: "2027-03-09", kind: "expense", categoryId: gro, readCategoryId: gro, note: null },
    { payee: "Matti", amount: 15, date: "2027-03-08", kind: "income", categoryId: null, readCategoryId: null, note: null },
  ]);
});

test("one payment that came in is marked as money in", async () => {
  reader({ doc_type: "payment", direction: "in", reply: "€15 from Matti.", receipt: { shop: "Matti", date: "2027-03-10", total: 15, items: [] }, bill: null });
  const r = await readReceipt(shot);
  assert.equal(r.docType, "payment");
  assert.equal(r.parsed.moneyIn, true);
  assert.equal(r.parsed.amount, 15);
});

test("a payment already in Koti is found, so a second screenshot doesn't count it twice", () => {
  const [a] = S.savePayments([{ payee: "Wolt Oy", amount: 23.4, date: "2027-03-09", kind: "expense", categoryId: null }]);
  assert.equal(S.twinOf({ date: "2027-03-09", amount: 23.4, payee: "WOLT" }).id, a.id);
  assert.equal(S.twinOf({ date: "2027-03-09", amount: 23.4, payee: "Wolt", kind: "income" }), null, "money in is not the same as money out");
  assert.equal(S.twinOf({ date: "2027-03-08", amount: 23.4, payee: "Wolt" }), null);
  store.remove("transactions", a.id);
});

test("several payments are saved as their own expenses and money in", () => {
  const before = store.model.transactions.length;
  const saved = S.savePayments([{ payee: "Lidl", amount: 23.4, date: "2027-03-09", kind: "expense", categoryId: "cat-groceries" }, { payee: "Matti", amount: 15, date: "2027-03-08", kind: "income", categoryId: "cat-groceries" }]);
  assert.equal(store.model.transactions.length, before + 2);
  assert.deepEqual(saved.map(t => [t.kind, t.categoryId, t.source]), [["expense", "cat-groceries", "receipt"], ["income", null, "receipt"]]);
  saved.forEach(t => store.remove("transactions", t.id));
});

test("a bank payment to one of your bills offers to mark that bill paid", () => {
  const bill = store.put("bills", { name: "Rent", amount: 700, frequency: "monthly", dueDay: 15, anchorMonth: 1, active: true, payee: "Kiinteistö Oy Kotikatu" });
  const o = S.billPaymentFor({ docType: "payment", bill: null, parsed: { amount: 700, payee: "KIINTEISTÖ OY KOTIKATU", date: "2027-03-12" } });
  assert.equal(o.bill.id, bill.id);
  assert.equal(o.due, "2027-03-15");
  const named = S.billPaymentFor({ docType: "payment", bill: { match: "Rent" }, parsed: { amount: 700, payee: "Someone else", date: "2027-03-12" } });
  assert.equal(named.due, "2027-03-15", "the reader named the bill");
  assert.equal(S.billPaymentFor({ docType: "payment", bill: null, parsed: { amount: 700, payee: "Kiinteistö Oy Kotikatu", date: "2027-03-12", moneyIn: true } }), null, "money in never pays a bill");
  store.remove("bills", bill.id);
});
