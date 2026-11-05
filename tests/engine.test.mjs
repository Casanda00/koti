// The engine, and the app on top of it, against what the app showed before it moved onto the engine.
// tests/households.snapshot.json holds the old app's figures for 300 made-up households (see
// tests/snapshot-households.mjs); both the engine's own figures and the screens' figures must match them to the
// cent, except where a difference is named below and explained.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday, app } from "./_env.mjs";
import { household, appFigures, SEEDS } from "./_households.mjs";
setToday("2027-03-10");
const A = await app();
const E = await import("../js/engine.js");
const extra = { spentBetween: (await import("../js/spent.js")).spentBetween, dayShare: (await import("../js/receipt.js")).dayShare };
const S = A.store.model;
const SNAP = JSON.parse(readFileSync(new URL("./households.snapshot.json", import.meta.url), "utf8"));

/* Pay dates, checked by their rule rather than by a second copy of the code: a working day, on or before the pay
   day (its month's last day for 0 and -1), with only days off between the two. */
test("pay dates follow the rule for every pay day, every month, 2026 to 2035", () => {
  for (let y = 2026; y <= 2035; y++) for (let m = 0; m < 12; m++) for (const pd of [-1, 0, 1, 5, 15, 20, 25, 28, 29, 30, 31]) {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), target = E.ymd(y, m, pd <= 0 ? last : Math.min(pd, last)), got = E.payDate(pd, y, m), why = `${pd} in ${y}-${m + 1}`;
    assert.ok(E.isWorkingDay(got), `a working day: ${why}`);
    assert.ok(got <= target && E.daysBetween(got, target) < 7, `on or before, within a week: ${why}`);   // pay day 1 on New Year's Day moves into December
    for (let d = E.addDays(got, 1); d <= target; d = E.addDays(d, 1)) assert.ok(!E.isWorkingDay(d), `only days off after it: ${why}`);
  }
  assert.ok(E.finnishHolidays(2027).has("2027-03-26") && E.finnishHolidays(2027).has("2027-06-25") && E.finnishHolidays(2027).has("2027-05-06"), "Good Friday, Midsummer Eve, Ascension Day 2027");
});

test("bill due dates follow the rule over ten years", () => {
  for (let y = 2026; y <= 2035; y++) for (let m = 0; m < 12; m++) {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    assert.equal(E.billDue({ frequency: "monthly", dueDay: 31, anchorMonth: 1 }, y, m), E.ymd(y, m, last));
    assert.equal(E.billDue({ frequency: "quarterly", dueDay: 15, anchorMonth: 2 }, y, m), (m - 1) % 3 === 0 ? E.ymd(y, m, 15) : null);
    assert.equal(E.billDue({ frequency: "yearly", dueDay: 29, anchorMonth: 2 }, y, m), m === 1 ? E.ymd(y, 1, Math.min(29, last)) : null);
  }
  const ranged = { frequency: "monthly", dueDay: 15, startDate: "2027-05-20", endDate: "2029-02-10" };
  assert.equal(E.billDue(ranged, 2027, 4), "2027-05-15", "the start month counts from its 1st");
  assert.equal(E.billDue(ranged, 2027, 3), null);
  assert.equal(E.billDue(ranged, 2029, 1), null, "after the end date");
  assert.equal(E.billDue({ frequency: "once", dueDate: "2028-02-29" }, 2028, 1), "2028-02-29");
  assert.equal(E.billDue({ frequency: "once", dueDate: "2028-02-29" }, 2028, 2), null);
});

/* The one deliberate difference: on payday, once the pay has arrived, the old app shared what was left over 1 day
   (the whole month became today's to spend). The engine shares it over the days to the next payday. */
const paydayAfterPay = (snap, today) => snap.dayShare && snap.dayShare.days === 1 && S.income.length && S.transactions.some(t => t.id === `inc:sal:${today}`);

function compare(got, snap, why, counts) {
  assert.equal(got.kind, snap.kind, why);
  for (const k of ["now", "carried", "income", "spent", "bills", "adjust", "saved", "due", "aheadSum", "savingsDue", "left", "expectedSum", "until"]) assert.equal(got[k], snap[k], `${k}: ${why}`);
  assert.deepEqual(got.overdue, snap.overdue, `overdue: ${why}`);
  assert.deepEqual(got.dueThisMonth, snap.dueThisMonth, `this month: ${why}`);
  assert.equal(got.spending.total, snap.spending.total, `spending: ${why}`);
  for (const [k, v] of Object.entries(snap.spending.byCat)) assert.equal(got.spending.byCat[k] || 0, v, `spending ${k}: ${why}`);
  assert.equal(got.spending.withoutProjects, snap.spending.withoutProjects, `without projects: ${why}`);
  assert.equal(got.spending.projects, snap.spending.projects, `projects: ${why}`);
  assert.deepEqual(got.budgets, snap.budgets, `budgets: ${why}`);
  if (!snap.dayShare) { assert.equal(got.dayShare, null, `share: ${why}`); return; }
  assert.equal(got.dayShare.morning, snap.dayShare.morning, `morning: ${why}`);
  if (paydayAfterPay(snap, got.today)) { assert.ok(got.dayShare.days > 1, `payday after pay: ${why}`); counts.payday++; return; }
  assert.equal(got.dayShare.days, snap.dayShare.days, `days: ${why}`);
  if (snap.dayShare.share != null) assert.ok(Math.abs(got.dayShare.share - snap.dayShare.share) <= 1, `share: ${why}`);   // rounded to the cent now; it kept fractions
}

/* The engine's own figures, in the same shape as the snapshot. */
function engineFigures(today) {
  const p = E.periodOf(today, E.monthStart(S)), L = E.state(S, today), out = { today, kind: L.kind };
  if (L.kind === "current") {
    for (const k of ["now", "carried", "income", "spent", "bills", "adjust", "saved", "due", "aheadSum", "savingsDue", "left", "expectedSum", "until"]) out[k] = L[k];
    out.overdue = L.overdue.map(o => o.bill.id + "@" + o.due);
    out.dueThisMonth = L.dueThisMonth.map(o => o.bill.id + "@" + o.due);
  }
  const sp = E.spending(S, p.from, p.to);
  out.spending = { total: sp.total, byCat: sp.byCat, withoutProjects: sp.total - sp.projects, projects: sp.projects };
  out.budgets = E.budgets(S, p, today);
  out.dayShare = E.dayShare(S, today);
  return out;
}

for (const [name, figures] of [["the engine", engineFigures], ["the app's screens", today => appFigures(A, today, extra)]]) {
  test(`${SEEDS} households: ${name} match the old app, to the cent`, () => {
    const counts = { payday: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const today = household(S, seed); A.store.emit("local"); setToday(today);
      compare(figures(today), SNAP[seed - 1], `seed ${seed}, ${today}`, counts);
    }
    assert.ok(counts.payday > 0 && counts.payday < 30, `the payday difference showed up ${counts.payday} times`);
  });
}

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
