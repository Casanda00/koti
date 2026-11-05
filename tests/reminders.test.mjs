// The reminders the server sends, worked out from the person's own records with the app's engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../supabase/functions/send-reminders/reminders.js";
import * as E from "../supabase/functions/send-reminders/engine.js";

test("the server's engine is the app's engine, byte for byte", () => {
  const app = readFileSync(new URL("../js/engine.js", import.meta.url), "utf8"), server = readFileSync(new URL("../supabase/functions/send-reminders/engine.js", import.meta.url), "utf8");
  assert.ok(app === server, "copy js/engine.js to supabase/functions/send-reminders/engine.js");
});

const base = ({ settings = {}, ...extra } = {}) => ({
  bills: [], transactions: [], income: [{ id: "sal", name: "Salary", amount: 2400, frequency: "monthly", payDay: 25, active: true, missed: [] }],
  categories: [{ id: "cat-groceries", name: "Groceries", budget: 400 }], goals: [], lists: [], items: [], ...extra,
  settings: { startBalance: 1000, startDate: "2027-09-01", monthStart: 1, ...settings },
});
const at = (day, hour, weekday = "Wed") => ({ day, hour, weekday });
const keys = notes => notes.map(n => n.key);

test("money tight is worked out from the records, with no saved snapshot", () => {
  // €1,000, rent €950 due on the 20th, €3 spent today. This morning €50 was left for the 14 days to payday on
  // Friday the 24th: €3.57 a day. €0.57 of today's share is left, under a quarter of it, so money is tight.
  // Left until payday €47, about €3 a day (47 ÷ 14 = 3.36, shown in whole euros as before).
  const m = base({ bills: [{ id: "rent", name: "Rent", amount: 950, frequency: "monthly", dueDay: 20, anchorMonth: 1, active: true, dues: {} }],
    transactions: [{ id: "c", date: "2027-09-10", amount: 3, kind: "expense", categoryId: "cat-groceries" }] });
  const notes = R.remindersFor(m, {}, at("2027-09-10", 10));
  const tight = notes.find(n => n.key === "tight:2027-09-01");
  assert.ok(tight, keys(notes).join());
  assert.equal(tight.title, "€47 is yours to spend for 14 days. About €3 a day.");
  assert.equal(m.settings.snapshot, undefined);
});

test("over: less than nothing left until payday", () => {
  const m = base({ transactions: [{ id: "t", date: "2027-09-05", amount: 1200, kind: "expense", categoryId: "cat-groceries" }] });
  const n = R.remindersFor(m, {}, at("2027-09-10", 10)).find(x => x.key === "over:2027-09-01");
  assert.equal(n.title, "You're €200 over until payday.");
});

test("'Your week' doesn't count money moved to savings", () => {
  const m = base({ settings: { reminders: { weekly: true } }, transactions: [
    { id: "a", date: "2027-09-08", amount: 30, kind: "expense", categoryId: "cat-groceries" },
    { id: "sav:g:1", date: "2027-09-09", amount: 500, kind: "expense", categoryId: "savings" }] });
  const wk = R.remindersFor(m, {}, at("2027-09-12", 19, "Sun")).find(n => n.key === "wk:2027-09-12");
  assert.match(wk.body, /^€30 spent this week/);
});

test("pay due on a Saturday is asked about the morning after the Friday it arrives", () => {
  const m = base();   // 25 September 2027 is a Saturday: pay comes on Friday the 24th
  const n = R.remindersFor(m, {}, at("2027-09-25", 9, "Sat")).find(x => x.key.startsWith("pay:"));
  assert.equal(n.key, "pay:sal:2027-09-24");
  assert.equal(n.title, "Did your salary, €2,400, land?");
});

test("a direct debit is reminded about as late only after you say it didn't go out", () => {
  const gym = { id: "gym", name: "Gym", amount: 40, frequency: "monthly", dueDay: 5, anchorMonth: 1, active: true, autopay: true, dues: {} };
  const day = at("2027-09-06", 9);
  assert.ok(!keys(R.remindersFor(base({ bills: [gym] }), {}, day)).some(k => k.startsWith("od:")));
  const failed = { ...gym, dues: { "2027-09-05": { failed: true } } };
  assert.ok(keys(R.remindersFor(base({ bills: [failed] }), {}, day)).includes("od:gym:2027-09-05:2027-09-06"));
});

test("a budget warning uses this month's budget with roll over, as the app shows it", () => {
  // August: €450 of €400, so September has €350. €300 spent is 86 %: a warning, though it's only 75 % of €400.
  const m = base({ settings: { startDate: "2027-08-01", rollover: true }, transactions: [
    { id: "aug", date: "2027-08-10", amount: 450, kind: "expense", categoryId: "cat-groceries" },
    { id: "sep", date: "2027-09-08", amount: 300, kind: "expense", categoryId: "cat-groceries" }] });
  const n = R.remindersFor(m, {}, at("2027-09-10", 10)).find(x => x.key === "bud:cat-groceries:2027-09-01");
  assert.equal(n.title, "Groceries is nearly used up. €50 to go.");
});

test("today's payments: purchases, refunds and project purchases, with the total", () => {
  const m = base({ lists: [{ id: "p", name: "Home", kind: "project" }], items: [{ id: "i", listId: "p", name: "Lamp", done: true, price: 25, boughtAt: "2027-09-10" }],
    transactions: [{ id: "a", date: "2027-09-10", amount: 12.4, kind: "expense", categoryId: "cat-groceries", payee: "K-Market" },
                   { id: "r", date: "2027-09-10", amount: 2.4, kind: "refund", categoryId: "cat-groceries", payee: "K-Market" }] });
  const n = R.remindersFor(m, {}, at("2027-09-10", 20)).find(x => x.key === "dy:2027-09-10");
  assert.equal(n.body, "Lamp €25 and K-Market €12.40. €35 in total.");
});

test("the hour is the person's own: 9 in the morning in New York is not 9 in Helsinki", () => {
  const when = new Date("2027-09-10T13:00:00Z");
  assert.deepEqual(R.local(when, "America/New_York"), { day: "2027-09-10", hour: 9, weekday: "Fri" });
  assert.deepEqual(R.local(when, "Europe/Helsinki"), { day: "2027-09-10", hour: 16, weekday: "Fri" });
  assert.equal(R.local(when, "Not/AZone").hour, 16, "an unknown zone falls back to Helsinki");
});

test("database rows become the app's model", () => {
  const m = R.modelOf({ settings: { tz: "Europe/Helsinki" },
    bills: [{ id: "b", name: "Rent", amount: "850.00", frequency: "monthly", due_day: 1, anchor_month: 1, autopay: false, active: true, dues: null }],
    tx: [{ id: "t", date: "2027-09-01", amount: "12.40", kind: "expense", category_id: "cat-groceries", bill_id: null, lines: null }],
    goals: [{ id: "g", name: "Buffer", target: "1000", saved: "100", monthly: "150" }] });
  assert.equal(m.bills[0].dueDay, 1);
  assert.equal(m.transactions[0].amount, 12.4);
  assert.equal(m.goals[0].saved, 100);
  assert.deepEqual(m.bills[0].dues, {});
});

test("the mood: over, tight with a late bill, calm", () => {
  assert.equal(E.mood(base({ transactions: [{ id: "x", date: "2027-09-02", amount: 1500, kind: "expense", categoryId: "c" }] }), "2027-09-10").mood, "over");
  const late = base({ settings: { startDate: "2027-08-01" }, bills: [{ id: "b", name: "Phone", amount: 20, frequency: "monthly", dueDay: 5, anchorMonth: 1, active: true, dues: {} }] });
  assert.equal(E.mood(late, "2027-09-10").mood, "tight");
  assert.equal(E.mood(base({ settings: { startBalance: 5000 } }), "2027-09-10").mood, "calm");
});
