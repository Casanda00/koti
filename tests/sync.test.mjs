// Sync between two devices on one account, against a pretend server that applies the database's rules.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app, fakeServer, devices } from "./_env.mjs";
setToday("2026-11-04");
const { store, sync } = await app();
const S = fakeServer(), D = devices(store);
sync.sync.client = S.client; sync.sync.user = { id: "u" }; store.meta.owner = "u";
const rowOf = (t, id) => S.table(t).find(r => r.id === id);
const edit = (id, patch, at) => { const t = store.model.transactions.find(x => x.id === id); Object.assign(t, patch, { updatedAt: at }); store.touch("transactions", id); };

test("an older offline edit doesn't overwrite a newer one (SYNC-2)", async () => {
  store.put("transactions", { id: "x", date: "2026-11-04", amount: 10, kind: "expense", payee: "Lidl" }); await sync.flush(); await sync.pull();
  const base = D.snap();
  D.load(base); edit("x", { amount: 12 }, "2026-11-04T13:00:00.000Z"); const A = D.snap();   // phone, offline at 13:00
  D.load(base); edit("x", { amount: 15 }, "2026-11-04T14:00:00.000Z"); await sync.flush(); const B = D.snap();   // computer at 14:00
  D.load(A); await sync.flush(); await sync.pull();
  assert.equal(rowOf("transactions", "x").amount, 15, "server keeps the newer value");
  assert.equal(store.model.transactions.find(t => t.id === "x").amount, 15, "the phone takes the newer value back");
  D.load(B); await sync.pull();
  assert.equal(store.model.transactions.find(t => t.id === "x").amount, 15);
});

test("a delete isn't undone by an older edit (SYNC-3)", async () => {
  store.put("transactions", { id: "y", date: "2026-11-04", amount: 5, kind: "expense" }); await sync.flush(); await sync.pull();
  const base = D.snap();
  D.load(base); edit("y", { amount: 6 }, "2026-11-04T13:00:00.000Z"); const A = D.snap();   // an edit while offline
  setToday("2026-11-05"); D.load(base); store.remove("transactions", "y"); await sync.flush();   // deleted the next day elsewhere
  D.load(A); await sync.flush(); await sync.pull();
  assert.equal(rowOf("transactions", "y").deleted, true);
  assert.equal(store.model.transactions.some(t => t.id === "y"), false);
});

test("one row the server refuses doesn't block the others (SYNC-4)", async () => {
  S.refuse = (table, r) => (table === "transactions" && r.id === "bad" ? "invalid input syntax for type date" : null);
  store.model.transactions.push({ id: "bad", date: "2026-11-04", amount: 3, kind: "expense", updatedAt: new Date().toISOString() }); store.touch("transactions", "bad");
  store.put("bills", { id: "rent", name: "Rent", amount: 850, frequency: "monthly", dueDay: 1 });
  store.updateSettings({ startBalance: 1000, startDate: "2026-11-04" });
  await sync.flush();
  assert.ok(rowOf("bills", "rent"), "the bill still uploads");
  assert.equal(S.table("settings")[0].data.startBalance, 1000, "settings still upload");
  assert.ok(store.meta.failed && store.meta.failed.transactions && store.meta.failed.transactions.bad, "the refused row is set aside and kept");
  assert.equal(store.meta.pending.transactions.bad, undefined, "and doesn't block later uploads");
  S.refuse = null;
});

test("rows are checked before they're saved: an impossible date isn't kept (SYNC-4)", () => {
  const t = store.put("transactions", { id: "d", date: "2026-02-31", amount: 4, kind: "expense" });
  assert.notEqual(t.date, "2026-02-31");
  assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("a device that never had a setting can't erase it (SYNC-1)", async () => {
  store.updateSettings({ startDate: "2026-11-04", startBalance: 1120, askedStart: true }); await sync.flush();
  const phone = D.snap();
  store.model.settings = { ...store.model.settings, startBalance: null, startDate: null, askedStart: false, _t: {} }; store.meta.pending.settings = false;
  store.updateSettings({ snapshot: { left: 5 } }); await sync.flush();
  assert.equal(S.table("settings")[0].data.startBalance, 1120);
  assert.equal(store.model.settings.startBalance, 1120, "the computer receives it");
  D.load(phone); await sync.pull();
  assert.deepEqual(store.model.settings.snapshot, { left: 5 }, "and the phone receives the computer's change");
});

test("rows sharing one timestamp across a page are all pulled (SYNC-5)", async () => {
  const t = S.table("items"); t.length = 0;
  for (let k = 0; k < 1100; k++) t.push({ user_id: "u", id: "i" + String(k).padStart(4, "0"), list_id: "list-groceries", name: "x", priority: "Soon", done: false, position: k, deleted: false, updated_at: "2026-01-01T00:00:00Z", synced_at: "2026-02-01T00:00:00.000Z" });
  for (let k = 0; k < 50; k++) t.push({ user_id: "u", id: "j" + k, list_id: "list-groceries", name: "y", priority: "Soon", done: false, position: k, deleted: false, updated_at: "2026-01-01T00:00:00Z", synced_at: "2026-02-02T00:00:00.000Z" });
  store.meta.lastSync.items = null; store.model.items = [];
  await sync.pull();
  assert.equal(store.model.items.filter(i => /^[ij]/.test(i.id)).length, 1150);
});
