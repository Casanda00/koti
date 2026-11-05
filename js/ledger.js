// Running balance and what's left until payday. The figures come from js/engine.js, in cents; this file turns them
// into euros for the screens, which is the only thing it does. The rules are written there.
import { store, todayISO } from "./data.js";
import { periodFor, shift } from "./money.js";
import { occurrenceOf } from "./plan.js";
import { incomeOccurrences } from "./income.js";
import * as E from "./engine.js";

export const ADJUST_CAT = E.ADJUST_CAT;   // "Check with bank" corrections: change the balance, not spending
export const SAVINGS_CAT = E.SAVINGS_CAT; // money moved to or from a savings goal: changes the balance, isn't spending
const eu = E.euros, M = () => store.model, P = p => ({ from: p.from, to: p.to });
/* An occurrence from the engine (amount in cents) as the screens expect it (amount in euros). */
export const billEu = o => ({ ...o, amount: eu(o.amount) });
const incEu = o => { const { amount, ...rest } = o; return rest; };   // the screens read the source's own amount

export function startPoint() { const s = E.startPoint(M(), todayISO()); return { ...s, amount: eu(s.amount) }; }
export function flow(from, to) { const f = E.flow(M(), from, to); return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, eu(v)])); }
export function balanceAt(day) { const b = E.balanceAt(M(), day, todayISO()); return b == null ? null : eu(b); }
export const overdueBills = (before = periodFor(new Date()).from) => E.overdueBills(M(), before, todayISO()).map(billEu);
export const horizon = (p = periodFor(new Date())) => E.horizon(M(), P(p), todayISO()).until;

/* Income that was expected on or before today but isn't marked received or missed. */
export function awaitingIncome() {
  const st = startPoint(), today = todayISO(), out = [];
  let p = periodFor(new Date());
  for (let k = 0; k < 6 && p.to >= st.date; k++, p = shift(p, -1)) {
    incomeOccurrences(p).forEach(o => { if (!o.got && !o.missed && o.due <= today && o.due >= st.date && o.src.amount) out.push(o); });
  }
  return out.sort((a, b) => b.due.localeCompare(a.due));
}

const MONEY = ["carried", "income", "spent", "bills", "adjust", "saved", "net", "now", "due", "aheadSum", "savingsDue", "left", "expectedSum", "end", "start", "budgets", "goals", "incomeSum"];
/* One month: past, current or a plan, in euros. */
export function monthLedger(p) {
  const L = E.month(M(), P(p), todayISO()), out = { ...L, p };
  MONEY.forEach(k => { if (typeof L[k] === "number") out[k] = eu(L[k]); });
  ["dueThisMonth", "overdue", "unpaid", "billList"].forEach(k => { if (L[k]) out[k] = L[k].map(billEu); });
  ["expected", "late", "missedIncome", "income"].forEach(k => { if (Array.isArray(L[k])) out[k] = L[k].map(incEu); });
  return out;
}

/* Every category's budget for a month (with roll over when it's on), and the total. */
export function effectiveBudgets(p) {
  const B = E.budgets(M(), P(p), todayISO());
  return { byId: Object.fromEntries(Object.entries(B.byId).map(([k, v]) => [k, eu(v)])), total: eu(B.total) };
}

export { occurrenceOf };
