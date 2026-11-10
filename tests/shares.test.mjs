// What the person paid (supabase/functions/read-receipt/shares.js): a receipt where someone else paid part of the
// price is saved at the person's own part, and a reading that doesn't add up is sent back to be read again.
import test from "node:test";
import assert from "node:assert/strict";
import { applyShares, sharesOf, SHARE_RULES } from "../supabase/functions/read-receipt/shares.js";

const lunch = [{ name_fi: "Lounas", name: "Lunch", qty: null, price: 14, category: "Eating out", list_item: null, place: null }];

test("the lunch the employer paid part of: saved at €10.50, and the lines still add up", () => {
  const r = applyShares({ items: lunch, total: 10.5, printedTotal: 14, others: [{ label: "Paid by your employer", amount: 3.5 }] });
  assert.equal(r.total, 10.5);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => [i.name, i.price, i.category]), [["Lunch", 14, "Eating out"], ["Paid by your employer", -3.5, "Eating out"]]);
});

test("the reader gave the printed total as what was paid: the others' part comes off", () => {
  const r = applyShares({ items: lunch, total: 14, printedTotal: 14, others: [{ label: "Lunch benefit", amount: 3.5 }] });
  assert.equal(r.total, 10.5);
  assert.equal(r.ok, true);
});

test("a reading that doesn't add up says exactly what, so it can be read again", () => {
  const r = applyShares({ items: lunch, total: 10.5, printedTotal: null, others: [] });
  assert.equal(r.ok, false);
  assert.match(r.problem, /the lines add up to 14.00 but the person paid 10.50/);
});

test("nothing paid by others: nothing changes", () => {
  const items = [{ name: "Milk", price: 1.2, category: "Groceries" }, { name: "Bread", price: 2.3, category: "Groceries" }];
  const r = applyShares({ items, total: 3.5, printedTotal: 3.5, others: [] });
  assert.deepEqual(r.items, items);
  assert.equal(r.total, 3.5);
  assert.equal(r.ok, true);
});

test("shares are cleaned, and the rules name no single kind of payer as the only one", () => {
  assert.deepEqual(sharesOf([{ label: " Gift card ", amount: 5 }, { label: "x", amount: -2 }, null]), [{ label: "Gift card", amount: 5 }]);
  for (const w of ["employer", "voucher", "gift card", "split bill"]) assert.match(SHARE_RULES, new RegExp(w, "i"));
});
