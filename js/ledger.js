// Running balance: money carries from month to month.
//   Each month starts with the previous month's real end balance (positive or negative).
//   Only income you've received counts as money you have; expected income is shown on its own.
//   Unpaid bills stay overdue in later months until they're paid or marked "Not owed".
//   Future months are a plan: planned income, bills, budgets and goals.
import { store, todayISO, BILLS_CAT } from "./data.js";
import { parseDay } from "./ui.js";
import { periodFor, shift, projectEntries } from "./money.js";
import { occurrences, occurrenceOf } from "./plan.js";
import { incomeOccurrences } from "./income.js";

export const ADJUST_CAT = "adjust";   // "Check with bank" corrections: change the balance, not spending
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
  let income = 0, spent = 0, bills = 0, adjust = 0, refunds = 0;
  if (from > to) return { income, spent, bills, adjust, net: 0 };
  store.model.transactions.forEach(t => {
    if (t.date < from || t.date > to) return;
    if (t.categoryId === ADJUST_CAT) { adjust += t.kind === "expense" ? -t.amount : t.amount; return; }
    if (t.kind === "income") income += t.amount;
    else if (t.kind === "refund") refunds += t.amount;
    else if (t.billId || t.categoryId === BILLS_CAT) bills += t.amount;
    else spent += t.amount;
  });
  projectEntries({ from, to }).forEach(e => { spent += e.amount; });
  spent -= refunds;
  return { income, spent, bills, adjust, net: income - spent - bills + adjust };
}

/* Balance at the end of a day (null before the starting point). */
export function balanceAt(day) {
  const st = startPoint();
  if (day < st.date) return null;
  return st.amount + flow(st.date, day).net;
}

/* Bills from earlier months that weren't paid (and weren't marked "Not owed"). Only since you started counting. */
export function overdueBills(before = periodFor(new Date()).from) {
  const st = startPoint(), today = todayISO(), out = [];
  let p = periodFor(parseDay(before)); p = shift(p, -1);
  for (let k = 0; k < 12 && p.to >= st.date; k++, p = shift(p, -1)) {
    occurrences(p).forEach(o => { if (!o.paid && !o.skipped && o.due >= st.date && o.due < before && o.due < today) out.push(o); });
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
const budgetsTotal = () => sum(store.model.categories, c => Number(c.budget) || 0);
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
  const f = flow(from, p.to), now = carried + f.net;
  if (p.from < cur.from) {   // a finished month
    const unpaid = plannedBills(p).filter(o => !o.paid && o.due >= st.date);
    const missed = plannedIncome(p).filter(o => !o.got && o.due >= st.date);
    return { kind: "past", p, carried, startsHere, ...f, end: now, unpaid, missedIncome: missed };
  }
  const thisMonth = plannedBills(p).filter(o => !o.paid && o.due >= st.date);
  const overdue = overdueBills(p.from);
  const due = sum(thisMonth, o => o.amount) + sum(overdue, o => o.amount);
  const expected = plannedIncome(p).filter(o => !o.got && o.due >= today);
  const late = plannedIncome(p).filter(o => !o.got && o.due < today);
  const left = now - due;
  return { kind: "current", p, carried, startsHere, ...f, now, dueThisMonth: thisMonth, overdue, due, left, expected, late, expectedSum: sum(expected, o => Number(o.src.amount) || 0) };
}

/* A future month: start from what's left now plus income still expected, then run the plan forward. */
function planLedger(p) {
  const cur = periodFor(new Date()), L = monthLedger(cur);
  let start = L.left + L.expectedSum + sum(L.late, o => Number(o.src.amount) || 0);
  for (let m = shift(cur, 1); m.from < p.from; m = shift(m, 1)) {
    start += sum(plannedIncome(m), o => Number(o.src.amount) || 0) - sum(plannedBills(m), o => o.amount) - budgetsTotal() - goalsMonthly();
  }
  const bills = sum(plannedBills(p), o => o.amount), budgets = budgetsTotal(), goals = goalsMonthly();
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

export { occurrenceOf };
