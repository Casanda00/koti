// Koti's money engine: every money figure, worked out in one place, in whole cents.
//
// Pure: no screen, no storage, no clock. It takes the model (the same shape the app keeps, amounts in euros as
// stored) and the day it is ("YYYY-MM-DD", in the person's own time zone) and returns figures in cents, with the
// parts they are made of, so a screen, the reminders server or Ask Koti can say how a number was reached.
// Dates are strings, worked out in UTC, so the result is the same on a phone and on the server.
//
// Rules (the same as Koti's until now; see tests/figures.test.mjs):
//   Balance: the starting balance, plus everything from the start date up to today. Anything dated later is planned.
//   Only income that has arrived is money you have.
//   Left until payday: the balance, less unpaid bills due by the day before the next payday (a paused bill's only
//   for dates gone by), overdue bills however old, payments dated ahead up to that day, and this month's savings
//   plan not yet moved.
//   Savings transfers and bank corrections change the balance; they are not spending.

export const BILLS_CAT = "cat-bills", ADJUST_CAT = "adjust", SAVINGS_CAT = "savings", CURRENCY = "EUR";
export const LAST_DAY = 0, LAST_WORKING_DAY = -1;

/* ---------- Money ---------- */
export const cents = v => Math.round((Number(v) || 0) * 100);
export const euros = c => c / 100;
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

/* ---------- Days ("YYYY-MM-DD") ---------- */
const pad = n => String(n).padStart(2, "0");
const utc = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
/* A day from a year, a 0-based month that may run outside 0–11, and a day that may run past the month's end. */
export const ymd = (y, m, d) => fromUTC(Date.UTC(y, m, d));
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export const addDays = (s, n) => fromUTC(utc(s) + n * 864e5);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const parts = s => ({ y: +s.slice(0, 4), m: +s.slice(5, 7) - 1, d: +s.slice(8, 10) });
export const validDay = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(utc(s)) === s;

/* ---------- Paydays: Finnish working days ---------- */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return ymd(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
const holidayCache = new Map();
/* Days banks are shut on a weekday: the fixed holidays, Christmas Eve, Good Friday, Easter Monday, Ascension Day,
   Midsummer Eve. */
export function finnishHolidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const set = new Set(["01-01", "01-06", "05-01", "12-06", "12-24", "12-25", "12-26"].map(md => `${y}-${md}`)), es = easter(y);
  [-2, 1, 39].forEach(n => set.add(addDays(es, n)));
  for (let d = 19; d <= 25; d++) { const s = ymd(y, 5, d); if (new Date(utc(s)).getUTCDay() === 5) set.add(s); }
  holidayCache.set(y, set); return set;
}
export const isWorkingDay = s => { const w = new Date(utc(s)).getUTCDay(); return w !== 0 && w !== 6 && !finnishHolidays(+s.slice(0, 4)).has(s); };
const workingDayBefore = s => { while (!isWorkingDay(s)) s = addDays(s, -1); return s; };
/* Pay day in a month (m 0-based, may run outside 0–11): a day of the month, the last day (0) or the last working
   day (-1). A day that isn't a working day moves to the working day before. */
export function payDate(payDay, y, m) {
  const first = ymd(y, m, 1), Y = +first.slice(0, 4), M = +first.slice(5, 7) - 1, last = lastOfMonth(Y, M);
  if (payDay === LAST_WORKING_DAY) return workingDayBefore(ymd(Y, M, last));
  return workingDayBefore(ymd(Y, M, payDay === LAST_DAY ? last : Math.min(payDay, last)));
}

/* ---------- Budget months ---------- */
export const monthStart = model => Math.min(28, Math.max(1, Number(model.settings.monthStart) || 1));
/* The budget month a day falls in: from the month-start day to the day before the next one. */
export function periodOf(day, sd) {
  const { y, d } = parts(day); let { m } = parts(day); if (d < sd) m -= 1;
  return { from: ymd(y, m, sd), to: ymd(y, m + 1, sd - 1) };
}
export const shiftPeriod = (p, n, sd) => { const { y, m } = parts(p.from); return periodOf(ymd(y, m + n, sd), sd); };
const startOf = p => parts(p.from);

/* ---------- Bills ---------- */
const billPayment = (model, billId, due) => model.transactions.find(t => t.id === `bill:${billId}:${due}`) || null;
/* A bill's due date in a month (0-based, may run outside 0–11), or null. */
export function billDue(b, y, m) {
  const mm = ((m % 12) + 12) % 12, first = ymd(y, m, 1);
  if (b.frequency === "once") return b.dueDate && b.dueDate.slice(0, 7) === first.slice(0, 7) ? b.dueDate : null;
  if (b.frequency === "yearly" && mm !== b.anchorMonth - 1) return null;
  if (b.frequency === "quarterly" && ((mm - (b.anchorMonth - 1)) % 3 + 3) % 3 !== 0) return null;
  const Y = +first.slice(0, 4), M = +first.slice(5, 7) - 1, s = ymd(Y, M, Math.min(b.dueDay, lastOfMonth(Y, M)));
  if (b.startDate && s < b.startDate.slice(0, 8) + "01") return null;
  if (b.endDate && s > b.endDate) return null;
  return s;
}
export function billOccurrence(model, b, due) {
  const d = (b.dues && b.dues[due]) || {};
  return { bill: b, due, amount: cents(d.amount || b.amount), paid: billPayment(model, b.id, due), skipped: !!d.skipped, failed: !!d.failed };
}
/* Every due date of every bill in a budget month. */
export function billOccurrences(model, p, { includePaused = false } = {}) {
  const out = [], { y, m } = startOf(p);
  model.bills.filter(b => includePaused || b.active).forEach(b => {
    for (let k = -1; k <= 1; k++) { const due = billDue(b, y, m + k); if (due && due >= p.from && due <= p.to) out.push(billOccurrence(model, b, due)); }
  });
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
}

/* ---------- Income ---------- */
const incomeTx = (model, sid, due) => model.transactions.find(t => t.id === `inc:${sid}:${due}`) || null;
export function incomeOccurrences(model, p) {
  const out = [], { y, m } = startOf(p);
  model.income.filter(s => s.active).forEach(src => {
    if (src.frequency === "once") { if (src.expectedDate && src.expectedDate >= p.from && src.expectedDate <= p.to) out.push({ src, due: src.expectedDate }); return; }
    for (let k = -1; k <= 1; k++) { const due = payDate(src.payDay, y, m + k); if (due >= p.from && due <= p.to && (!src.endDate || due <= src.endDate)) out.push({ src, due }); }
  });
  return out.map(o => ({ ...o, amount: cents(o.src.amount), got: incomeTx(model, o.src.id, o.due), missed: (o.src.missed || []).includes(o.due) })).sort((a, b) => a.due.localeCompare(b.due));
}
/* The main pay: the biggest regular income, or the payday setting when there is none. */
export function nextPay(model, today) {
  const main = model.income.filter(s => s.active && s.frequency !== "once").sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
  const sp = model.settings.payday, pd = main ? main.payDay : sp === "last" ? LAST_DAY : sp ? Number(sp) : null;
  if (pd == null || Number.isNaN(pd)) return null;
  const { y, m } = parts(today);
  let date = payDate(pd, y, m); if (date < today) date = payDate(pd, y, m + 1);
  return { date, days: daysBetween(today, date), source: main || null };
}

/* ---------- Projects (checklist purchases count as spending) ---------- */
function projectOf(model, listId) {
  const l = model.lists.find(x => x.id === listId); if (!l) return null;
  return l.kind === "project" ? l : l.parentId ? model.lists.find(x => x.id === l.parentId) || null : null;
}
export function projectEntries(model, from, to) {
  const onReceipt = new Set(); model.transactions.forEach(t => (t.lines || []).forEach(l => { if (l.itemId) onReceipt.add(l.itemId); }));
  return model.items.filter(i => i.done && i.price > 0 && !onReceipt.has(i.id) && i.boughtAt && i.boughtAt >= from && i.boughtAt <= to)
    .map(i => ({ i, pr: projectOf(model, i.listId) })).filter(x => x.pr)
    .map(({ i, pr }) => ({ id: "item:" + i.id, itemId: i.id, date: i.boughtAt, amount: cents(i.price), categoryId: "proj:" + pr.id, projectId: pr.id, payee: i.name }));
}

/* ---------- Spending ---------- */
/* What went out between two days, by category ("proj:<id>" for projects): receipt lines in their own category,
   the part not itemised in the receipt's, refunds taken off, project purchases added. Income, savings transfers
   and bank corrections are not spending. */
export function spending(model, from, to) {
  const byCat = {}, byDay = {}, entries = [];
  const add = (k, v, d) => { byCat[k] = (byCat[k] || 0) + v; byDay[d] = (byDay[d] || 0) + v; };
  model.transactions.forEach(t => {
    if (t.date < from || t.date > to || t.kind === "income" || t.categoryId === ADJUST_CAT || t.categoryId === SAVINGS_CAT) return;
    entries.push(t);
    const amount = cents(t.amount);
    if (t.kind === "refund") { add(t.categoryId || "none", -amount, t.date); return; }
    if (t.lines && t.lines.length) {
      let rest = amount;
      t.lines.forEach(l => { const p = cents(l.price); add(l.categoryId || t.categoryId || "none", p, t.date); rest -= p; });
      if (rest !== 0) add(t.categoryId || "none", rest, t.date);
      return;
    }
    add(t.categoryId || "none", amount, t.date);
  });
  projectEntries(model, from, to).forEach(e => { add(e.categoryId, e.amount, e.date); entries.push(e); });
  let total = 0, projects = 0;
  for (const [k, v] of Object.entries(byCat)) { total += v; if (k.startsWith("proj:")) projects += v; }
  return { total, projects, everyday: total - projects - (byCat[BILLS_CAT] || 0), bills: byCat[BILLS_CAT] || 0, byCat, byDay, entries };
}

/* ---------- The balance ---------- */
/* Where counting starts: the starting balance, or €0 at the start of the first month with money in Koti. */
export function startPoint(model, today) {
  const S = model.settings;
  if (S.startDate && S.startBalance != null) return { date: S.startDate, amount: cents(S.startBalance), set: true };
  const first = model.transactions.filter(t => t.date).reduce((m, t) => (!m || t.date < m ? t.date : m), null);
  return { date: periodOf(first || today, monthStart(model)).from, amount: 0, set: false };
}
/* "From my next pay": an expense bought today and paid out of the coming salary (a card paid off on payday, money
   borrowed until then). It counts in Spent and its category's budget on the day it was bought, and in the balance on
   the payday it comes out of, so today's money doesn't drop and the next pay starts that much lower. */
export const fromNextPay = t => !!(t.fromPay && t.kind === "expense" && t.fromPay > t.date);
export const moneyDay = t => (fromNextPay(t) ? t.fromPay : t.date);
/* A payment planned ahead (Koti's "plan a payment"): an expense entered for its day, in its own category. Until then
   it's set aside (aheadOut); on the day it's spending in that category, but not out of that day's share. */
export const isPlanned = t => t.source === "planned" && t.kind === "expense" && !t.billId;
/* Expenses still waiting for the pay they come out of, after today. */
export function owedFromPay(model, today) {
  const list = model.transactions.filter(t => fromNextPay(t) && t.fromPay > today && t.date <= today).sort((a, b) => a.fromPay.localeCompare(b.fromPay) || a.date.localeCompare(b.date));
  return { list, total: sum(list, t => cents(t.amount)) };
}
/* Money in and out between two days (inclusive), each payment on the day it leaves the account (moneyDay). */
export function flow(model, from, to) {
  let income = 0, spent = 0, bills = 0, adjust = 0, refunds = 0, saved = 0, fromSavings = 0;
  if (from > to) return { income, spent, bills, adjust, saved, fromSavings, net: 0 };
  model.transactions.forEach(t => {
    const day = moneyDay(t);
    if (day < from || day > to) return;
    const a = cents(t.amount);
    if (t.categoryId === ADJUST_CAT) { adjust += t.kind === "expense" ? -a : a; return; }
    if (isSpendFromSavings(t)) { fromSavings += a; return; }
    if (t.categoryId === SAVINGS_CAT) { saved += t.kind === "expense" ? a : -a; return; }
    if (t.kind === "income") income += a;
    else if (t.kind === "refund") refunds += a;
    else if (t.billId || t.categoryId === BILLS_CAT) bills += a;
    else spent += a;
  });
  projectEntries(model, from, to).forEach(e => { spent += e.amount; });
  spent -= refunds;
  return { income, spent, bills, adjust, saved, fromSavings, net: income - spent - bills + adjust - saved + fromSavings };
}
export function balanceAt(model, day, today = day) {
  const st = startPoint(model, today);
  return day < st.date ? null : st.amount + flow(model, st.date, day).net;
}

/* ---------- What is owed ---------- */
/* Bills from earlier budget months not paid and not marked "Not owed", however old, since counting started.
   A paused bill's past due dates still count. */
export function overdueBills(model, before, today) {
  const sd = monthStart(model), st = startPoint(model, today), out = [], seen = new Set();
  let p = shiftPeriod(periodOf(before, sd), -1, sd);
  for (let k = 0; k < 240 && p.to >= st.date; k++, p = shiftPeriod(p, -1, sd)) {
    billOccurrences(model, p, { includePaused: true }).forEach(o => { if (!o.paid && !o.skipped && o.due >= st.date && o.due < before && o.due < today) out.push(o); });
  }
  return out.filter(o => { const k = o.bill.id + o.due; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.due.localeCompare(b.due));
}
/* The last day money has to last: the day before the next payday (after today's pay, once it has arrived), or
   the end of the budget month when no payday is known. */
export function horizon(model, p, today) {
  let pd = nextPay(model, today);
  if (!pd) return { until: p.to, payday: null };
  if (pd.days === 0) {
    const got = pd.source && incomeTx(model, pd.source.id, today);
    if (!got) return { until: today, payday: pd };
    pd = nextPay(model, addDays(today, 1));
    if (!pd) return { until: p.to, payday: null };
  }
  const before = addDays(pd.date, -1);
  return { until: before < today ? today : before, payday: pd };
}
/* Unpaid bills due from the start of this budget month up to that day, across budget months. Paused bills only
   for dates already gone by. */
export function committedBills(model, p, until, start, today) {
  const sd = monthStart(model), out = [];
  for (let q = p, k = 0; q.from <= until && k < 3; q = shiftPeriod(q, 1, sd), k++) {
    billOccurrences(model, q, { includePaused: true }).forEach(o => {
      if (o.paid || o.skipped || o.due < start || o.due < p.from || o.due > until) return;
      if (!o.bill.active && o.due >= today) return;
      out.push(o);
    });
  }
  return out;
}
/* Payments already entered for a later day, up to the horizon. */
export function aheadOut(model, today, until) {
  const list = model.transactions.filter(t => t.date > today && t.date <= until && t.kind !== "income" && t.categoryId !== ADJUST_CAT && !fromNextPay(t));
  return { list, total: sum(list, t => (t.kind === "refund" ? -1 : 1) * cents(t.amount)) };
}
/* What a goal holds: the amount saved outside Koti's transfers (the goal's own "saved"; transfers made before
   5 November 2026 were added there too), plus every transfer in or out recorded since, each carrying the goal in its
   id ("sav:<goal id>:…"). Worked out from the transfers, two phones moving money at once both count. */
/* Spending paid "from my savings": the expense, and beside it a withdrawal from the goal with an id
   "sav:<goal id>:spend-…". The goal goes down; the balance doesn't (the withdrawal brings the money in for the
   expense), and the month's savings plan doesn't ask for it back. */
export const isSpendFromSavings = t => t.categoryId === SAVINGS_CAT && t.kind === "income" && /^sav:[^:]+:spend-/.test(String(t.id));
export const isGoalTransfer = (t, goalId) => t.categoryId === SAVINGS_CAT && String(t.id).startsWith(`sav:${goalId}:`);
export function goalSaved(model, g) {
  const moved = sum(model.transactions.filter(t => isGoalTransfer(t, g.id)), t => (t.kind === "expense" ? 1 : -1) * cents(t.amount));
  return Math.max(0, cents(g.saved) + moved);
}
export const goalsMonthly = model => sum(model.goals, g => (goalSaved(model, g) < cents(g.target) ? cents(g.monthly) : 0));

/* ---------- The state now ---------- */
/* The current budget month, as Today shows it: the balance now and what's left until payday, with every part. */
export function state(model, today) {
  const sd = monthStart(model), p = periodOf(today, sd), st = startPoint(model, today);
  if (p.to < st.date) return { kind: "before", p, currency: CURRENCY };
  const from = p.from < st.date ? st.date : p.from;
  const carried = from === st.date ? st.amount : balanceAt(model, addDays(from, -1), today);
  const f = flow(model, from, today), now = carried + f.net;
  const { until, payday } = horizon(model, p, today);
  const dueThisMonth = committedBills(model, p, until, st.date, today), overdue = overdueBills(model, p.from, today);
  const due = sum(dueThisMonth, o => o.amount) + sum(overdue, o => o.amount);
  const ahead = aheadOut(model, today, until), savingsDue = Math.max(0, goalsMonthly(model) - flow(model, p.from, p.to).saved);
  const inc = incomeOccurrences(model, p);
  const expected = inc.filter(o => !o.missed && !o.got && o.due >= today), late = inc.filter(o => !o.missed && !o.got && o.due < today);
  const left = now - due - ahead.total - savingsDue, owed = owedFromPay(model, today);
  return {
    kind: "current", currency: CURRENCY, today, p, startsHere: from === st.date && st.set, carried, ...f, now,
    dueThisMonth, overdue, due, ahead: ahead.list, aheadSum: ahead.total, savingsDue, until, payday, left,
    expected, late, expectedSum: sum(expected, o => o.amount), owed: owed.list, owedSum: owed.total,
    assumptions: [
      `Counted from ${st.set ? `your starting balance on ${st.date}` : `${st.date}, with no starting balance`}, up to ${today}`,
      "Only income that has arrived is counted",
      payday ? `Money has to last until ${until}, the day before payday` : `No payday is known, so money has to last until ${until}, the end of the budget month`,
      "Unpaid bills due by then and overdue bills are set aside, and so are payments dated ahead and this month's savings plan not yet moved",
      "Spending you said comes out of your next pay leaves the balance on that payday, not before",
      "Spending you said comes out of your savings comes out of that goal",
    ],
  };
}

/* Today's share: what was left this morning, shared over the days to payday, less what was spent today. Spent more
   than it, "left" is negative, and "tomorrow" is the new amount a day for the days after today.
   Bills paid today were already taken off, so they don't count against it. */
export function dayShare(model, today) {
  const L = state(model, today); if (L.kind !== "current") return null;
  // Not today's money: spending from the next pay, spending paid for out of savings (its withdrawal is today's), and a
  // payment planned ahead (set aside until its day, like a bill).
  const S = spending(model, today, today), later = sum(S.entries.filter(fromNextPay), t => cents(t.amount)), saved = flow(model, today, today).fromSavings;
  const planned = sum(S.entries.filter(isPlanned), t => cents(t.amount));
  const spent = S.total - S.bills - later - saved - planned, days = L.payday ? Math.max(1, L.payday.days) : null;
  const morning = L.left + spent, share = days ? Math.round(Math.max(0, morning) / days) : null;
  // Over today's share: what's left is shared again over the days after today, so tomorrow's amount is smaller.
  // (Under it, tomorrow's is bigger.) None when payday is tomorrow: the new pay sets it.
  const tomorrow = days && days > 1 ? Math.round(Math.max(0, L.left) / (days - 1)) : null;
  return { days, spent, morning, share, left: share != null ? share - spent : null, tomorrow };
}

/* ---------- Budgets ---------- */
/* A category's budget for a budget month. With roll over on, what was left unspent last month is added and an
   overspend is taken off, up to a year back and never before counting started. */
export function budgets(model, p, today) {
  const sd = monthStart(model), st = startPoint(model, today), cache = new Map();
  const spentIn = (id, q) => { if (!cache.has(q.from)) cache.set(q.from, spending(model, q.from, q.to).byCat); return cache.get(q.from)[id] || 0; };
  const budgetOf = (cat, q, depth) => {
    const base = cents(cat.budget);
    if (!model.settings.rollover || cat.budget == null || depth > 11) return base;
    const prev = shiftPeriod(q, -1, sd);
    if (prev.to < st.date) return base;
    return base + (budgetOf(cat, prev, depth + 1) - spentIn(cat.id, prev));
  };
  const byId = {}; let total = 0;
  model.categories.forEach(c => { if (c.budget == null) return; const b = budgetOf(c, p, 0); byId[c.id] = b; total += Math.max(0, b); });
  return { byId, total };
}

/* ---------- Month totals ---------- */
/* Pay in a budget month: expected (every occurrence not marked missed), received, and still to come. */
export function incomeTotals(model, p) {
  const occ = incomeOccurrences(model, p); let expected = 0, received = 0, pending = 0;
  occ.forEach(o => { if (o.got) { received += cents(o.got.amount); expected += o.amount; } else if (!o.missed) { expected += o.amount; pending += o.amount; } });
  return { occ, expected, received, pending, total: received + pending };
}
/* Bills in a budget month. A due date marked "Not owed" counts only if it was paid anyway. */
export function billTotals(model, p) {
  const occ = billOccurrences(model, p).filter(o => !o.skipped || o.paid);
  return { occ, total: sum(occ, o => o.amount), paid: sum(occ, o => (o.paid ? cents(o.paid.amount) : 0)), due: sum(occ.filter(o => !o.paid), o => o.amount),
    count: occ.length, paidCount: occ.filter(o => o.paid).length };
}
/* A budget month as the Budgets and Month screens show it. Income here is what arrived plus, for a month not yet
   over, what is still expected: not the same as the balance's income, which counts only what arrived. */
export function monthTotals(model, p, today) {
  const sp = spending(model, p.from, p.to), byCat = {}, byProject = {};
  for (const [k, v] of Object.entries(sp.byCat)) { if (k.startsWith("proj:")) byProject[k.slice(5)] = v; else byCat[k] = v; }
  const incomeLoose = sum(model.transactions.filter(t => t.date >= p.from && t.date <= p.to && t.kind === "income" && !t.incomeId && t.categoryId !== ADJUST_CAT && t.categoryId !== SAVINGS_CAT), t => cents(t.amount));
  const inc = incomeTotals(model, p), bills = billTotals(model, p), spend = sp.total - sp.projects, billsPaid = byCat[BILLS_CAT] || 0;
  const income = inc.received + incomeLoose + (p.to >= today ? inc.pending : 0);
  return { byCat, byProject, spend, everyday: spend - billsPaid, projects: sp.projects, total: sp.total, income: income || null, inc, incomeLoose, bills, billsPaid, billsDue: bills.due };
}

/* ---------- Any budget month ---------- */
const plannedIncome = (model, p) => incomeOccurrences(model, p).filter(o => !o.missed);
const plannedBills = (model, p) => billOccurrences(model, p).filter(o => !o.skipped);
/* A month before counting started, a finished month, the current month (state), or a month ahead (a plan). */
export function month(model, p, today) {
  const sd = monthStart(model), cur = periodOf(today, sd), st = startPoint(model, today);
  if (p.from > cur.from) return planMonth(model, p, today);
  if (p.from === cur.from) return state(model, today);
  if (p.to < st.date) return { kind: "before", p, currency: CURRENCY };
  const from = p.from < st.date ? st.date : p.from;
  const carried = from === st.date ? st.amount : balanceAt(model, addDays(from, -1), today);
  const f = flow(model, from, p.to);
  return { kind: "past", currency: CURRENCY, p, carried, startsHere: from === st.date && st.set, ...f, end: carried + f.net,
    unpaid: plannedBills(model, p).filter(o => !o.paid && o.due >= st.date), missedIncome: plannedIncome(model, p).filter(o => !o.got && o.due >= st.date) };
}
/* A month ahead: what's left now plus pay still expected, then each month's planned pay less bills, budgets and goals. */
function planMonth(model, p, today) {
  const sd = monthStart(model), cur = periodOf(today, sd), L = state(model, today), goals = goalsMonthly(model);
  let start = L.left + L.expectedSum + sum(L.late, o => o.amount) - L.owedSum;
  for (let m = shiftPeriod(cur, 1, sd); m.from < p.from; m = shiftPeriod(m, 1, sd)) {
    start += sum(plannedIncome(model, m), o => o.amount) - sum(plannedBills(model, m), o => o.amount) - budgets(model, m, today).total - goals;
  }
  const billList = plannedBills(model, p), bills = sum(billList, o => o.amount), b = budgets(model, p, today).total, income = plannedIncome(model, p);
  return { kind: "plan", currency: CURRENCY, p, start, bills, budgets: b, goals, left: start - bills - b - goals, income, incomeSum: sum(income, o => o.amount), billList };
}

/* ---------- How the month is going ---------- */
/* "over" (less than nothing left, or today's share already spent), "tight" (a bill is late, little of today's
   share is left, or each day has much less than the budgets plan for a day), or "calm". Today's colour, and the
   reminders' "money is tight". */
export function mood(model, today) {
  const L = state(model, today);
  if (L.kind !== "current") return { mood: "calm", L };
  const pd = nextPay(model, today), days = pd ? Math.max(1, pd.days) : null, perDay = days && L.left > 0 ? Math.round(L.left / days) : 0;
  const D = dayShare(model, today);
  let m;
  if (L.left < 0) m = "over";
  else if (D && D.left != null) m = D.left < 0 ? "over" : D.share > 0 && D.left < D.share * 0.25 ? "tight" : L.overdue.length ? "tight" : "calm";
  else if (L.overdue.length) m = "tight";
  else { const planned = budgets(model, L.p, today).total / (daysBetween(L.p.from, L.p.to) + 1); m = perDay < (planned > 0 ? planned * 0.6 : 1000) ? "tight" : "calm"; }
  return { mood: m, L, days, perDay, share: D ? D.share : null, leftToday: D ? D.left : null };
}

/* ---------- What a budget has to fit into ---------- */
/* The figures a budget suggestion works from, in cents: this budget month's pay (arrived or expected), bills and
   savings plan, what is left for everyday spending, and what each category took on average over the last few full
   budget months that had any spending (and so far this month). The AI only divides what's available; it never
   works these out. */
export function budgetContext(model, today, months = 3) {
  const sd = monthStart(model), cur = periodOf(today, sd), T = monthTotals(model, cur, today);
  const income = T.inc.expected + T.incomeLoose, bills = T.bills.total, savings = goalsMonthly(model);
  const sums = {}; let counted = 0;
  for (let k = 0, p = shiftPeriod(cur, -1, sd); k < 24 && counted < months; k++, p = shiftPeriod(p, -1, sd)) {
    const byCat = spending(model, p.from, p.to).byCat;
    if (!Object.keys(byCat).some(c => c !== BILLS_CAT && !c.startsWith("proj:") && byCat[c] > 0)) continue;
    counted++;
    for (const [c, v] of Object.entries(byCat)) sums[c] = (sums[c] || 0) + v;
  }
  const now = spending(model, cur.from, today).byCat;
  const categories = model.categories.filter(c => c.id !== BILLS_CAT).map(c => ({
    id: c.id, name: c.name, budget: c.budget == null ? null : cents(c.budget),
    average: counted ? Math.round(Math.max(0, sums[c.id] || 0) / counted) : null, thisMonth: Math.max(0, now[c.id] || 0),
  }));
  // Savings goals, so a plan can weigh saving against spending: what each holds now and what it puts aside a month.
  const goals = model.goals.map(g => ({ id: g.id, name: g.name, target: cents(g.target), saved: goalSaved(model, g), monthly: g.monthly == null ? null : cents(g.monthly), targetDate: g.targetDate || null }));
  return { currency: CURRENCY, period: cur, income, bills, savings, spendable: income - bills, available: income - bills - savings, monthsLookedAt: counted, categories, goals };
}
