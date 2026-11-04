// Running balance: money carries from month to month.
//   Each month starts with the previous month's real end balance (positive or negative).
//   The balance now counts what has happened up to today; anything dated later is planned, not spent.
//   Only income you've received counts as money you have; expected income is shown on its own.
//   Left until payday sets aside everything owed before the next payday: unpaid bills due by then (whatever the
//   budget month), overdue bills however old (a paused bill's too), payments dated ahead, and this month's
//   savings plan not yet moved. Unpaid bills stay owed until they're paid or marked "Not owed".
//   Future months are a plan: planned income, bills, budgets and goals.
import { store, todayISO, BILLS_CAT } from "./data.js";
import { parseDay } from "./ui.js";
import { periodFor, shift, projectEntries, totals } from "./money.js";
import { occurrences, occurrenceOf } from "./plan.js";
import { incomeOccurrences, nextPay, incId } from "./income.js";

export const ADJUST_CAT = "adjust";   // "Check with bank" corrections: change the balance, not spending
export const SAVINGS_CAT = "savings"; // money moved to or from a savings goal: changes the balance, isn't spending
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayBefore = s => { const d = parseDay(s); d.setDate(d.getDate() - 1); return iso(d); };

/* Where counting starts: your starting balance, or €0 at the start of the first month with any money in Koti. */
export function startPoint() {
  const S = store.model.settings;
  if (S.startDate && S.startBalance != null) return { date: S.startDate, amount: Number(S.startBalance) || 0, set: true };
  const first = store.model.transactions.filter(t => t.date).reduce((m, t) => (!m || t.date < m ? t.date : m), null);
  return { date: periodFor(first ? parseDay(first) : new Date()).from, amount: 0, set: false };
}

/* Money in and out between two dates (inclusive). */
export function flow(from, to) {
  let income = 0, spent = 0, bills = 0, adjust = 0, refunds = 0, saved = 0;
  if (from > to) return { income, spent, bills, adjust, saved, net: 0 };
  store.model.transactions.forEach(t => {
    if (t.date < from || t.date > to) return;
    if (t.categoryId === ADJUST_CAT) { adjust += t.kind === "expense" ? -t.amount : t.amount; return; }
    if (t.categoryId === SAVINGS_CAT) { saved += t.kind === "expense" ? t.amount : -t.amount; return; }
    if (t.kind === "income") income += t.amount;
    else if (t.kind === "refund") refunds += t.amount;
    else if (t.billId || t.categoryId === BILLS_CAT) bills += t.amount;
    else spent += t.amount;
  });
  projectEntries({ from, to }).forEach(e => { spent += e.amount; });
  spent -= refunds;
  return { income, spent, bills, adjust, saved, net: income - spent - bills + adjust - saved };
}

/* Balance at the end of a day (null before the starting point). */
export function balanceAt(day) {
  const st = startPoint();
  if (day < st.date) return null;
  return st.amount + flow(st.date, day).net;
}

/* Bills from earlier months that weren't paid (and weren't marked "Not owed"), however old, since you started
   counting. A paused bill's unpaid past due dates still count: pausing stops the bill from now on. */
export function overdueBills(before = periodFor(new Date()).from) {
  const st = startPoint(), today = todayISO(), out = [];
  let p = periodFor(parseDay(before)); p = shift(p, -1);
  for (let k = 0; k < 240 && p.to >= st.date; k++, p = shift(p, -1)) {
    occurrences(p, { includePaused: true }).forEach(o => { if (!o.paid && !o.skipped && o.due >= st.date && o.due < before && o.due < today) out.push(o); });
  }
  const seen = new Set();
  return out.filter(o => { const k = o.bill.id + o.due; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.due.localeCompare(b.due));
}

/* Income that was expected on or before today but isn't marked received or missed. */
export function awaitingIncome() {
  const st = startPoint(), today = todayISO(), out = [];
  let p = periodFor(new Date());
  for (let k = 0; k < 6 && p.to >= st.date; k++, p = shift(p, -1)) {
    incomeOccurrences(p).forEach(o => { if (!o.got && !o.missed && o.due <= today && o.due >= st.date && o.src.amount) out.push(o); });
  }
  return out.sort((a, b) => b.due.localeCompare(a.due));
}

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const budgetsTotal = p => effectiveBudgets(p).total;
const goalsMonthly = () => sum(store.model.goals, g => (g.saved < g.target ? Number(g.monthly) || 0 : 0));
const plannedIncome = p => incomeOccurrences(p).filter(o => !o.missed);
const plannedBills = p => occurrences(p).filter(o => !o.skipped);

/* One month: past, current or a plan. */
export function monthLedger(p) {
  const cur = periodFor(new Date()), today = todayISO(), st = startPoint();
  if (p.from > cur.from) return planLedger(p);
  if (p.to < st.date) return { kind: "before", p };
  const from = p.from < st.date ? st.date : p.from;
  const carried = from === st.date ? st.amount : balanceAt(dayBefore(from));
  const startsHere = from === st.date && st.set;
  const f = flow(from, p.from < cur.from ? p.to : today), now = carried + f.net;
  if (p.from < cur.from) {   // a finished month
    const unpaid = plannedBills(p).filter(o => !o.paid && o.due >= st.date);
    const missed = plannedIncome(p).filter(o => !o.got && o.due >= st.date);
    return { kind: "past", p, carried, startsHere, ...f, end: now, unpaid, missedIncome: missed };
  }
  // what's owed before the next payday
  const until = horizon(p), thisMonth = committedBills(p, until, st.date, today);
  const overdue = overdueBills(p.from);
  const due = sum(thisMonth, o => o.amount) + sum(overdue, o => o.amount);
  const ahead = aheadOut(today, until), savingsDue = Math.max(0, goalsMonthly() - flow(p.from, p.to).saved);
  const expected = plannedIncome(p).filter(o => !o.got && o.due >= today);
  const late = plannedIncome(p).filter(o => !o.got && o.due < today);
  const left = now - due - ahead.total - savingsDue;
  return { kind: "current", p, carried, startsHere, ...f, now, dueThisMonth: thisMonth, overdue, due, ahead: ahead.list, aheadSum: ahead.total, savingsDue, until, left, expected, late, expectedSum: sum(expected, o => Number(o.src.amount) || 0) };
}

/* The last day money has to last: the day before the next payday (after today's pay, once it has arrived),
   or the end of the budget month when no payday is known. */
export function horizon(p = periodFor(new Date())) {
  const today = todayISO(); let pd = nextPay();
  if (!pd) return p.to;
  if (pd.days === 0) {
    const main = pd.source, got = main && store.model.transactions.some(t => t.id === incId(main.id, today));
    if (!got) return today;   // pay is due today and hasn't arrived: only today's bills
    const t = parseDay(today); t.setDate(t.getDate() + 1); pd = nextPay(t);
    if (!pd) return p.to;
  }
  return dayBefore(iso(pd.date)) < today ? today : dayBefore(iso(pd.date));
}
/* Unpaid bills due from the start of this month up to that day, across budget months. Paused bills only for
   dates already gone by. */
function committedBills(p, until, start, today) {
  const out = [];
  for (let q = p, k = 0; q.from <= until && k < 3; q = shift(q, 1), k++) {
    occurrences(q, { includePaused: true }).forEach(o => {
      if (o.paid || o.skipped || o.due < start || o.due < p.from || o.due > until) return;
      if (!o.bill.active && o.due >= today) return;
      out.push(o);
    });
  }
  return out;
}
/* Payments already entered for a later day, up to the horizon: they will go out, so they're set aside. */
function aheadOut(today, until) {
  const list = store.model.transactions.filter(t => t.date > today && t.date <= until && t.kind !== "income" && t.categoryId !== ADJUST_CAT);
  return { list, total: sum(list, t => (t.kind === "refund" ? -1 : 1) * t.amount) };
}

/* A future month: start from what's left now plus income still expected, then run the plan forward. */
function planLedger(p) {
  const cur = periodFor(new Date()), L = monthLedger(cur);
  let start = L.left + L.expectedSum + sum(L.late, o => Number(o.src.amount) || 0);
  for (let m = shift(cur, 1); m.from < p.from; m = shift(m, 1)) {
    start += sum(plannedIncome(m), o => Number(o.src.amount) || 0) - sum(plannedBills(m), o => o.amount) - budgetsTotal(m) - goalsMonthly();
  }
  const bills = sum(plannedBills(p), o => o.amount), budgets = budgetsTotal(p), goals = goalsMonthly();
  const income = plannedIncome(p);
  return { kind: "plan", p, start, bills, budgets, goals, left: start - bills - budgets - goals, income, incomeSum: sum(income, o => Number(o.src.amount) || 0), billList: plannedBills(p) };
}

/* Category budget for a month, with roll over: unspent money adds to next month, overspending takes from it. */
export function categoryBudget(cat, p, spentIn, depth = 0) {
  const base = Number(cat.budget) || 0;
  if (!store.model.settings.rollover || cat.budget == null || depth > 11) return base;
  const st = startPoint(), prev = shift(p, -1);
  if (prev.to < st.date) return base;
  const prevBudget = categoryBudget(cat, prev, spentIn, depth + 1);
  return base + (prevBudget - spentIn(cat.id, prev));
}

/* Every category's budget for a month (with roll over when it's on), and the total. Months not yet happened have nothing spent. */
export function effectiveBudgets(p) {
  const byId = {}; let total = 0;
  store.model.categories.forEach(c => { if (c.budget == null) return; const b = categoryBudget(c, p, (id, q) => (byMonth(q)[id] || 0)); byId[c.id] = b; total += Math.max(0, b); });
  return { byId, total };
}
const monthCache = new Map();
function byMonth(q) { const k = q.from; if (!monthCache.has(k)) monthCache.set(k, totals(q).byCat); return monthCache.get(k); }
store.on && store.on(() => monthCache.clear());

export { occurrenceOf };
