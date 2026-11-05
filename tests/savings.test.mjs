// A savings goal's total is worked out from its transfers, so it can't drift from them or lose one.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app, devices } from "./_env.mjs";
setToday("2027-03-10");
const A = await app();
const { store } = A;
const M = () => store.model;   // a fresh object after devices.load
const reset = () => { Object.assign(M().settings, { startBalance: 1000, startDate: "2027-03-01", monthStart: 1 }); M().transactions = []; M().bills = []; M().income = []; M().items = [];
  M().goals = [{ id: "g", name: "Buffer", target: 1000, saved: 100, monthly: 150, position: 0 }]; };
const goal = () => M().goals[0];
const L = () => A.monthLedger(A.money.periodFor(new Date()));

test("moving money in adds to the goal and lowers the account; taking it out does the reverse", () => {
  reset();
  A.plan.moveToGoal(goal(), 1, 200);
  assert.equal(A.plan.savedOf(goal()), 300);
  assert.equal(goal().saved, 100, "the goal itself is not changed");
  assert.equal(L().now, 800);
  A.plan.moveToGoal(goal(), -1, 50);
  assert.equal(A.plan.savedOf(goal()), 250);
  assert.equal(L().now, 850);
});

test("deleting a transfer takes it off the goal too", () => {
  reset();
  const { tx } = A.plan.moveToGoal(goal(), 1, 200);
  store.remove("transactions", tx.id);
  assert.equal(A.plan.savedOf(goal()), 100);
  assert.equal(L().now, 1000);
});

test("two phones moving money in at the same time: both count", () => {
  reset();
  const D = devices(store), start = D.snap();
  A.plan.moveToGoal(goal(), 1, 50); const phoneA = D.snap();
  D.load(start); A.plan.moveToGoal(goal(), 1, 70); const phoneB = D.snap();
  // after sync each phone has both transfers and one copy of the goal (whichever was written last)
  M().transactions = [...phoneA.model.transactions, ...phoneB.model.transactions];
  M().goals = phoneB.model.goals;
  assert.equal(A.plan.savedOf(goal()), 220, "100 + 50 + 70; before, the goal kept only one of the two");
});

test("transfers made before this change are already in the goal's saved, so they don't count twice", () => {
  reset();
  M().goals[0].saved = 300;   // the old app added €200 here and also wrote this transfer
  M().transactions = [{ id: "sav-old-1", date: "2027-03-05", amount: 200, kind: "expense", categoryId: "savings", payee: "Buffer" }];
  assert.equal(A.plan.savedOf(goal()), 300);
  assert.equal(L().now, 800, "the transfer still lowered the account");
});

test("you can't take out more than the goal holds", () => {
  reset();
  assert.match(A.plan.moveToGoal(goal(), -1, 150).error, /only €100\.00 in Buffer/);
  assert.equal(M().transactions.length, 0);
  assert.equal(A.plan.moveToGoal(goal(), 1, 0).error, "Type an amount first.");
});

test("a goal reached by transfers stops asking for its monthly amount", () => {
  reset();
  assert.equal(L().savingsDue, 150);
  A.plan.moveToGoal(goal(), 1, 900);   // 100 + 900 = the target
  assert.equal(A.plan.savedOf(goal()), 1000);
  assert.equal(L().savingsDue, 0, "a goal that's reached has no monthly amount to set aside");
});
