// Direct debits and paydays.
import test from "node:test";
import assert from "node:assert/strict";
import { setToday, app } from "./_env.mjs";
setToday("2027-03-10");
const A = await app();
const { store } = A, S = store.model;
S.settings.startBalance = 1000; S.settings.startDate = "2027-03-01";

test("a direct debit isn't recorded as paid on its own; it's set aside until confirmed (FIN-2)", () => {
  S.bills = [{ id: "gym", name: "Gym", amount: 40, frequency: "monthly", dueDay: 4, anchorMonth: 1, active: true, autopay: true, dues: {}, position: 0, startDate: "2027-03-01" }];
  const L = A.monthLedger(A.money.periodFor(new Date()));
  assert.equal(S.transactions.length, 0, "nothing paid without asking");
  assert.equal(L.due, 40, "the money stays set aside");
  const o = L.dueThisMonth.find(x => x.bill.id === "gym");
  assert.equal(A.plan.awaitingDebit(o), true, "Koti asks whether it went out");
  A.plan.setFailed(o, true);
  const o2 = A.monthLedger(A.money.periodFor(new Date())).dueThisMonth.find(x => x.bill.id === "gym");
  assert.equal(A.plan.awaitingDebit(o2), false, "after 'It didn't', it's an ordinary unpaid bill");
  assert.equal(o2.paid, null);
});

test("a fixed payday on a holiday or weekend moves to the working day before (FIN-8)", async () => {
  const { payDateFor } = await import("../js/paydays.js");
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(iso(payDateFor(25, 2026, 11)), "2026-12-23", "25 Dec, and 24 Dec is a bank holiday too");
  assert.equal(iso(payDateFor(15, 2026, 10)), "2026-11-13", "Sunday 15 November");
  assert.equal(iso(payDateFor(10, 2026, 10)), "2026-11-10", "a working day stays");
  assert.equal(iso(payDateFor(-1, 2026, 10)), "2026-11-30", "last working day");
});
