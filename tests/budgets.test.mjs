// Budgets are yours to set. Koti used to give every new account made-up ones (Groceries €400, Eating out €120, …,
// Home setup €500); new accounts start with none, and any still exactly as Koti set them are cleared once.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday } from "./_env.mjs";
setToday("2026-11-06");
const D = await import("../js/data.js");

test("a new account's categories and Home setup have no budgets", () => {
  const m = D.seedModel();
  assert.deepEqual(m.categories.map(c => c.name), ["Groceries", "Eating out", "Transport", "Shopping", "Health", "Fun", "Other"]);
  assert.ok(m.categories.every(c => c.budget === null));
  assert.equal(m.lists.find(l => l.id === D.HOME_PROJECT).budget, null);
});

test("budgets still as Koti set them are cleared; ones you changed are kept", () => {
  const m = D.normalizeModel({ lists: [{ id: D.HOME_PROJECT, name: "Home setup", kind: "project", budget: 500, updatedAt: "1970-01-01T00:00:00.000Z" }], items: [], settings: {},
    categories: [
      { id: "cat-groceries", name: "Groceries", budget: 400, updatedAt: "2026-11-04T20:03:14.9+00:00" },     // Koti's, unchanged
      { id: "cat-eating-out", name: "Eating out", budget: 200, updatedAt: "2026-11-04T20:03:14.9+00:00" },   // you changed it
      { id: "cat-fun", name: "Fun", budget: 100, updatedAt: "2026-11-07T09:00:00.000Z" },                     // you set it again, later
      { id: "cat-mine", name: "Pets", budget: 400, updatedAt: "2026-11-01T09:00:00.000Z" },                   // your own category
    ], transactions: [], bills: [], goals: [], income: [], reminders: [] });
  const changed = D.upgradeModel(m);
  const by = id => m.categories.find(c => c.id === id).budget;
  assert.equal(by("cat-groceries"), null);
  assert.equal(by("cat-eating-out"), 200);
  assert.equal(by("cat-fun"), 100);
  assert.equal(by("cat-mine"), 400);
  assert.equal(m.lists.find(l => l.id === D.HOME_PROJECT).budget, null);
  assert.deepEqual(changed.categories, ["cat-groceries"]);
  assert.ok(changed.lists.includes(D.HOME_PROJECT), "the change is uploaded, so every device and the reminders see it");
  assert.deepEqual(D.upgradeModel(m).categories, [], "running it again changes nothing");
});
