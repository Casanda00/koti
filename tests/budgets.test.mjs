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

/* ---------- Suggest budgets ---------- */
const E = await import("../js/engine.js");
const { checkBudgets } = await import("../supabase/functions/suggest-budgets/check.js");

test("the AI is given the engine's figures: pay − bills − savings, and each category's recent average", () => {
  // Pay €2,400, rent €850, a €150 savings plan: €1,400 a month for everyday spending. Groceries took €300 in
  // September and €330 in October (two months with spending): €315 on average. November so far: €40.
  const m = { settings: { startBalance: 1000, startDate: "2026-09-01", monthStart: 1 }, lists: [], items: [],
    income: [{ id: "sal", name: "Salary", amount: 2400, frequency: "monthly", payDay: 25, active: true, missed: [] }],
    bills: [{ id: "rent", name: "Rent", amount: 850, frequency: "monthly", dueDay: 1, anchorMonth: 1, active: true, dues: {} }],
    goals: [{ id: "g", name: "Buffer", target: 3000, saved: 0, monthly: 150 }],
    categories: [{ id: "cat-groceries", name: "Groceries", budget: null }, { id: "cat-fun", name: "Fun", budget: 50 }],
    transactions: [{ id: "a", date: "2026-09-10", amount: 300, kind: "expense", categoryId: "cat-groceries" }, { id: "b", date: "2026-10-10", amount: 330, kind: "expense", categoryId: "cat-groceries" },
                   { id: "c", date: "2026-11-03", amount: 40, kind: "expense", categoryId: "cat-groceries" }] };
  const C = E.budgetContext(m, "2026-11-06");
  assert.deepEqual([C.income, C.bills, C.savings, C.available], [240000, 85000, 15000, 140000]);
  assert.equal(C.monthsLookedAt, 2);
  assert.deepEqual(C.categories.map(c => [c.name, c.average, c.thisMonth, c.budget]), [["Groceries", 31500, 4000, null], ["Fun", 0, 0, 5000]]);
});

test("the AI's budgets are checked: own categories once, rounded to €5, never more in total than is available", () => {
  const names = ["Groceries", "Fun", "Transport"];
  const r = checkBudgets([{ category: "groceries", amount: 412, why: "x" }, { category: "Fun", amount: 98, why: "" }, { category: "Fun", amount: 5, why: "again" }, { category: "Rent", amount: 900 }, { category: "Transport", amount: -20 }], names, 1000);
  assert.deepEqual(r.budgets.map(b => [b.category, b.amount]), [["Groceries", 410], ["Fun", 100]]);
  const over = checkBudgets([{ category: "Groceries", amount: 600 }, { category: "Fun", amount: 400 }], names, 500);
  assert.ok(over.total <= 500, `scaled down to fit: ${over.total}`);
  assert.deepEqual(over.budgets.map(b => b.amount), [300, 200]);
  assert.deepEqual(checkBudgets([{ category: "Fun", amount: 50 }], names, -100).budgets.map(b => b.amount), [0], "nothing to spend: nothing budgeted");
});

test("Use these sets the budgets, and Undo puts the old ones back", async () => {
  const { store } = D;
  store.model.categories = [{ id: "cat-groceries", name: "Groceries", budget: null, position: 0 }, { id: "cat-fun", name: "Fun", budget: 50, position: 1 }];
  const { applyBudgets } = await import("../js/budgetai.js");
  const undo = applyBudgets([{ id: "cat-groceries", amount: 320 }, { id: "cat-fun", amount: 60 }]);
  assert.deepEqual(store.model.categories.map(c => c.budget), [320, 60]);
  undo();
  assert.deepEqual(store.model.categories.map(c => c.budget), [null, 50]);
});
