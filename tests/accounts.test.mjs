// Signing in to a different account on the same device (DATA-1).
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-04");
const { store } = await app();

test("the backup check sees money records, not only list items", () => {
  store.model.items.forEach(i => { i.done = false; i.price = null; });
  store.model.transactions = [{ id: "t", date: "2026-11-01", amount: 12, kind: "expense" }];
  assert.equal(!!store.hasUserData(), true);
});

test("switching accounts keeps each account's data, unsent changes included", () => {
  store.meta.owner = "A";
  store.put("transactions", { id: "a1", date: "2026-11-04", amount: 9, kind: "expense", payee: "Alepa" });
  assert.ok(store.meta.pending.transactions.a1);
  store.stashAccount("A"); store.resetLocal({ version: 3, lists: [], items: [], transactions: [] }); store.meta.owner = "B";
  assert.equal(store.model.transactions.length, 0, "B doesn't see A's records");
  store.stashAccount("B");
  assert.equal(store.loadAccount("A"), true);
  assert.ok(store.model.transactions.some(t => t.id === "a1"), "A's record is back");
  assert.ok(store.meta.pending.transactions.a1, "and still waiting to upload");
});

test("data from before signing in can be added to the account", () => {
  localStorage.setItem("koti.beforeSignIn", JSON.stringify({ version: 3, lists: [], items: [], transactions: [{ id: "old", date: "2026-10-30", amount: 20, kind: "expense" }], bills: [], goals: [], income: [], reminders: [], settings: { startBalance: 500, startDate: "2026-10-01" } }));
  store.model.settings.startBalance = null;
  const n = store.addBeforeSignIn();
  assert.equal(n, 1);
  assert.ok(store.model.transactions.some(t => t.id === "old"));
  assert.equal(store.model.settings.startBalance, 500, "a balance the account lacks is taken");
  assert.equal(store.beforeSignIn(), null, "and the copy is gone");
});
