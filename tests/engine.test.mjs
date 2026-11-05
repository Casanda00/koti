// The engine against today's app: the same households must give the same figures, to the cent.
// The app still uses ledger.js, money.js and spent.js; until it moves onto the engine (step 3), these tests are
// what says the engine reproduces them. Floats are compared after rounding to cents, which is the point of it.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2027-03-10");
const A = await app();
const E = await import("../js/engine.js");
const { payDateFor } = await import("../js/paydays.js");
const { spentBetween } = await import("../js/spent.js");
const { dayShare } = await import("../js/receipt.js");
const S = A.store.model;
const c = v => Math.round(v * 100);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("pay dates match the app's for every pay day, every month, 2026 to 2035", () => {
  for (let y = 2026; y <= 2035; y++) for (let m = 0; m < 12; m++) for (const pd of [-1, 0, 1, 5, 15, 20, 25, 28, 29, 30, 31]) {
    assert.equal(E.payDate(pd, y, m), iso(payDateFor(pd, y, m)), `${pd} in ${y}-${m + 1}`);
  }
});

test("bill due dates match the app's for every kind of bill over ten years", () => {
  const kinds = [
    { frequency: "monthly", dueDay: 31, anchorMonth: 1 }, { frequency: "monthly", dueDay: 15, anchorMonth: 1, startDate: "2027-05-20", endDate: "2029-02-10" },
    { frequency: "quarterly", dueDay: 30, anchorMonth: 2 }, { frequency: "yearly", dueDay: 29, anchorMonth: 2 }, { frequency: "once", dueDate: "2028-02-29", dueDay: 29, anchorMonth: 2 },
  ];
  kinds.forEach((k, i) => {
    S.bills = [{ id: "b" + i, name: "b" + i, amount: 10, active: true, dues: {}, ...k }]; S.transactions = [];
    for (let y = 2026; y <= 2035; y++) for (let m = 0; m < 12; m++) {
      const p = A.money.periodFor(new Date(y, m, 10));
      assert.deepEqual(E.billOccurrences(S, { from: p.from, to: p.to }).map(o => o.due), A.plan.occurrences(p).map(o => o.due), `${JSON.stringify(k)} ${p.from}`);
    }
  });
});

/* A small random number generator with a seed, so a failure can be run again. */
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const money = r => Math.round(r() * 30000) / 100;   // up to €300, in cents
function household(seed) {
  const r = rng(seed), sd = pick(r, [1, 1, 15, 25]), start = pick(r, ["2026-06-01", "2027-01-01", "2027-02-14", "2027-03-01"]);
  const days = ["2027-01-05", "2027-02-01", "2027-02-27", "2027-03-01", "2027-03-05", "2027-03-09", "2027-03-10", "2027-03-15", "2027-03-28", "2027-04-02"];
  Object.assign(S.settings, { startBalance: Math.round(r() * 300000) / 100, startDate: start, monthStart: sd, rollover: r() < 0.5, payday: pick(r, ["last", "25", null]) });
  S.categories = [{ id: "cat-groceries", name: "Groceries", budget: 400 }, { id: "cat-fun", name: "Fun", budget: r() < 0.5 ? 100 : null }, { id: "cat-shopping", name: "Shopping", budget: 150 }];
  S.lists = [{ id: "p1", name: "Home", kind: "project" }, { id: "r1", name: "Kitchen", kind: "room", parentId: "p1" }];
  S.items = Array.from({ length: 4 }, (_, i) => ({ id: "it" + i, listId: pick(r, ["p1", "r1", "nowhere"]), done: r() < 0.7, price: money(r), boughtAt: pick(r, days) }));
  S.income = r() < 0.8 ? [{ id: "sal", name: "Salary", amount: 2400, frequency: "monthly", payDay: pick(r, [-1, 0, 10, 25]), active: true, missed: [] }] : [];
  S.bills = Array.from({ length: 4 }, (_, i) => ({ id: "b" + i, name: "Bill " + i, amount: money(r), frequency: pick(r, ["monthly", "monthly", "quarterly", "once"]), dueDay: pick(r, [1, 5, 12, 28, 31]),
    anchorMonth: pick(r, [1, 2, 3]), dueDate: pick(r, days), active: r() < 0.85, autopay: r() < 0.3, dues: r() < 0.3 ? { [pick(r, days)]: { skipped: r() < 0.5, amount: money(r) } } : {} }));
  S.goals = r() < 0.6 ? [{ id: "g", name: "Buffer", target: 1000, saved: Math.round(r() * 1200), monthly: 150 }] : [];
  S.transactions = Array.from({ length: 25 }, (_, i) => {
    const kind = pick(r, ["expense", "expense", "expense", "refund", "income"]), cat = pick(r, ["cat-groceries", "cat-fun", "cat-shopping", "savings", "adjust", "cat-bills", null]);
    const t = { id: "t" + i, date: pick(r, days), amount: money(r), kind, categoryId: cat, payee: "x" };
    if (kind === "expense" && r() < 0.25) t.lines = [{ name: "a", price: Math.round(t.amount * 40) / 100, categoryId: pick(r, ["cat-fun", "proj:p1", null]), itemId: pick(r, ["it0", null]) }];
    return t;
  });
  S.bills.forEach(b => { if (r() < 0.4) { const due = pick(r, days); S.transactions.push({ id: `bill:${b.id}:${due}`, date: due, amount: b.amount, kind: "expense", categoryId: "cat-bills", billId: b.id, billDue: due }); } });
  if (S.income.length && r() < 0.6) { const due = pick(r, ["2027-02-25", "2027-03-10", "2027-03-25", "2027-02-26"]); S.transactions.push({ id: `inc:sal:${due}`, date: due, amount: 2400, kind: "income", incomeId: "sal", incomeDue: due }); }
  A.store.emit("local");   // the app clears its month cache on every change
  return pick(r, ["2027-03-01", "2027-03-10", "2027-03-25", "2027-03-31", "2027-04-01"]);
}

test("300 random households: the state now matches the app's, to the cent", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const today = household(seed); setToday(today);
    const L = A.monthLedger(A.money.periodFor(new Date())), M = E.state(S, today), why = `seed ${seed}, ${today}`;
    assert.equal(M.kind, L.kind, why);
    if (L.kind !== "current") continue;
    for (const k of ["now", "carried", "income", "spent", "bills", "adjust", "saved", "due", "aheadSum", "savingsDue", "left", "expectedSum"]) assert.equal(M[k], c(L[k]), `${k}: ${why}`);
    assert.equal(M.until, L.until, `until: ${why}`);
    assert.deepEqual(M.overdue.map(o => o.bill.id + o.due), L.overdue.map(o => o.bill.id + o.due), `overdue: ${why}`);
    assert.deepEqual(M.dueThisMonth.map(o => o.bill.id + o.due), L.dueThisMonth.map(o => o.bill.id + o.due), `this month: ${why}`);
  }
});

test("300 random households: spending, budgets and today's share match the app's", () => {
  let diffs = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const today = household(seed); setToday(today);
    const p = A.money.periodFor(new Date()), why = `seed ${seed}, ${today}`;
    const sp = E.spending(S, p.from, p.to), old = spentBetween(p.from, p.to), tot = A.money.totals(p);
    assert.equal(sp.total, c(old.total), `total: ${why}`);
    for (const [k, v] of Object.entries(old.byCat)) assert.equal(sp.byCat[k] || 0, c(v), `${k}: ${why}`);
    assert.equal(sp.total - sp.projects, c(tot.spend), `spend without projects: ${why}`);
    assert.equal(sp.projects, c(tot.projects), `projects: ${why}`);
    const B = E.budgets(S, p, today), OB = A.effectiveBudgets(p);
    assert.equal(B.total, c(OB.total), `budgets: ${why}`);
    for (const [k, v] of Object.entries(OB.byId)) assert.equal(B.byId[k], c(v), `budget ${k}: ${why}`);
    const D = E.dayShare(S, today), OD = dayShare();
    if (!OD) { assert.equal(D, null, why); continue; }
    assert.equal(D.morning, c(OD.morning), `morning: ${why}`);
    // The one deliberate difference: on payday, once the pay has arrived, the app shared what was left over 1 day
    // (the whole month became today's to spend). The engine shares it over the days to the next payday.
    const paidToday = S.income.length && S.transactions.some(t => t.id === `inc:sal:${today}`) && OD.days === 1;
    if (paidToday) { assert.ok(D.days > 1, `payday after pay: ${why}`); diffs++; continue; }
    assert.equal(D.days, OD.days, `days: ${why}`);
    if (OD.share != null) assert.ok(Math.abs(D.share - OD.share * 100) <= 1, `share: ${why}: ${D.share} vs ${OD.share}`);   // a share is rounded to the cent; the app kept fractions
  }
  assert.ok(diffs > 0 && diffs < 30, `the payday difference showed up ${diffs} times`);
});

test("the engine's sums are exact: €0.10 + €0.20 is €0.30", () => {
  setToday("2027-03-10");
  Object.assign(S.settings, { startBalance: 1000, startDate: "2027-03-01", monthStart: 1 });
  S.transactions = [{ id: "a", date: "2027-03-02", amount: 0.1, kind: "expense", categoryId: "x" }, { id: "b", date: "2027-03-03", amount: 0.2, kind: "expense", categoryId: "x" }];
  S.bills = []; S.items = []; S.goals = []; S.income = [];
  assert.equal(E.spending(S, "2027-03-01", "2027-03-31").total, 30);
  assert.equal(E.euros(E.state(S, "2027-03-10").now), 999.7);
});

test("the state says how it was reached", () => {
  const M = E.state(S, "2027-03-10");
  assert.equal(M.currency, "EUR");
  assert.ok(M.assumptions.length >= 3);
  assert.match(M.assumptions[0], /starting balance on 2027-03-01/);
});
