// Koti learns from corrections (js/learn.js, 9 November 2026): your name for a shop it read, and the category you put
// a shop in when you changed Koti's, are used from then on, over whatever the AI says. Misread dates and totals are
// kept as notes for improving the reader and change nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
setToday("2027-03-10");
localStorage.setItem("koti.consent", JSON.stringify({ v: 1, ai: true, at: "2027-03-01T10:00:00Z" }));
const { store } = await import("../js/data.js");
const { sync } = await import("../js/sync.js");
const L = await import("../js/learn.js");
const { readReceipt } = await import("../js/receipts.js");
const gro = store.model.categories.find(c => c.name === "Groceries").id, shopping = store.model.categories.find(c => c.name === "Shopping").id;

test("a corrected shop name and category are learned, and nothing is learned when nothing changed", () => {
  const got = L.learnFromSave({ read: { payee: "K-MARKET KAMPPI HKI 0123", categoryId: shopping, date: "2027-03-10", amount: 23.4 }, saved: { payee: "K-Market Kamppi", categoryId: gro, date: "2027-03-08", amount: 23.4 } });
  assert.deepEqual(got.map(x => x.kind), ["shop", "category", "date"]);
  assert.equal(L.shopFor("K-MARKET KAMPPI HKI 0456"), "K-Market Kamppi", "the terminal number on the end doesn't matter");
  assert.equal(L.categoryFor("k-market kamppi"), gro);
  assert.deepEqual(L.learnFromSave({ read: { payee: "Lidl", categoryId: gro }, saved: { payee: "Lidl", categoryId: gro } }), []);
});

test("the newest fix wins, and a forgotten fix stops applying", () => {
  L.learnFromSave({ read: { payee: "Tokmanni", categoryId: gro }, saved: { payee: "Tokmanni", categoryId: shopping } });
  assert.equal(L.categoryFor("Tokmanni"), shopping);
  L.learnFromSave({ read: { payee: "Tokmanni", categoryId: shopping }, saved: { payee: "Tokmanni", categoryId: gro } });
  assert.equal(L.categoryFor("Tokmanni"), gro);
  assert.equal(L.learned().filter(x => x.kind === "category" && x.key === "tokmanni").length, 1, "one fix per shop, not a pile");
  L.forgetLearned(L.learned().find(x => x.key === "tokmanni").id);
  assert.equal(L.categoryFor("Tokmanni"), null);
});

test("what's learned wins over the AI on the next receipt from that shop", async () => {
  sync.user = { id: "u" };
  sync.client = { functions: { invoke: async () => ({ data: { doc_type: "receipt", reply: "", used: 1, limit: 30, bill: null,
    receipt: { shop: "K-MARKET KAMPPI HKI 0999", date: "2027-03-09", total: 12, items: [{ name: "Snacks", name_fi: "Naposteltavaa", qty: null, price: 12, category: "Shopping", list_item: null, place: null }] } }, error: null }) } };
  globalThis.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then(() => { this.result = "data:image/png;base64,AA=="; this.onload(); }); } };
  const r = await readReceipt({ blob: new Blob([new Uint8Array([1])], { type: "image/png" }), type: "image/png" });
  assert.equal(r.parsed.payee, "K-Market Kamppi");
  assert.equal(r.parsed.categoryId, gro);
  assert.equal(r.parsed.lines[0].categoryId, gro, "a one-line receipt follows the shop's category too");
});

test("misread dates and totals are noted, and don't change anything", () => {
  L.learnFromSave({ read: { payee: "Alepa", amount: 18.9 }, saved: { payee: "Alepa", amount: 19.8 } });
  const n = L.learned().filter(x => x.kind === "amount");
  assert.equal(n.at(-1).from, "18.9"); assert.equal(n.at(-1).to, "19.8");
  assert.equal(L.categoryFor("Alepa"), null);
});

test("at most 150 are kept, the oldest go first", () => {
  for (let i = 0; i < 160; i++) L.learn("shop", `SHOP ${String.fromCharCode(65 + (i % 26))}${i}`, `Shop ${i}`);
  assert.equal(L.learned().length, L.LEARN_MAX);
  assert.equal(L.shopFor("SHOP Z155"), "Shop 155");
});
