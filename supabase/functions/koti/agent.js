// Koti's brain: a conversation with the person about their own money and home, and a note for the Today screen.
// Plain JavaScript, shared by the "koti" Edge Function (Deno) and the tests (Node).
//
// How it thinks:
//   1. A snapshot of where the person stands today (what's left today and until payday, bills before payday, budgets,
//      goals, this week against a usual week) is worked out by the app's own engine (../send-reminders/engine.js, a
//      copy of js/engine.js) from their records, and goes into the prompt. Koti never works out a money figure itself.
//   2. For anything more, the model looks it up with tools that read the same records: spending in any period (by
//      category, by shop, by what was bought), bills, lists, reminders, and "what if I spend this".
//   3. When the person asks Koti to do something, or it would clearly help, the model proposes an action: an expense,
//      things for a list, a reminder, a bill, a savings goal, a budget, or something to remember about them. Actions
//      are returned to the app as cards; nothing is saved here. The person taps to do it (and can undo).
// What Koti remembers about the person (settings.memory) goes into every prompt, so it gets more personal with use.

import * as E from "../send-reminders/engine.js";
import { modelOf } from "../send-reminders/reminders.js";
import { chatBody, openaiError, OPENAI_BASE, MODEL } from "../_shared/openai.js";

export const MAX_MEMORY = 40, MEMORY_LEN = 200, MAX_ROUNDS = 6;
const eu = c => Math.round(Number(c) || 0) / 100;
const str = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const amountOf = v => (typeof v === "number" && isFinite(v) && v > 0 && v < 1e7 ? Math.round(v * 100) / 100 : null);
const lower = s => String(s || "").toLowerCase().trim();
const weekday = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

/* ---------- The person's records, as the engine reads them ---------- */
export function modelFromRows({ settings = {}, bills = [], tx = [], income = [], cats = [], goals = [], lists = [], items = [], reminders = [] }) {
  const M = modelOf({ settings, bills, tx, income, cats, goals, lists, items });
  M.transactions.forEach((t, i) => { t.note = tx[i].note || null; });
  M.items.forEach((it, i) => { it.priority = items[i].priority || "Soon"; it.qty = items[i].qty == null ? null : Number(items[i].qty); });
  M.bills.forEach((b, i) => { b.payee = bills[i].payee || null; });
  M.goals.forEach((g, i) => { g.targetDate = goals[i].target_date || goals[i].targetDate || null; });
  M.reminders = reminders.map(r => ({ id: r.id, title: r.title, note: r.note || null, when: r.schedule || r.when, date: r.on_date || null, monthDay: r.month_day, weekday: r.weekday,
    beforeDays: r.before_days, aboutKind: r.about_kind, hour: r.hour, active: r.active !== false }));
  return M;
}
export const memoryOf = settings => (Array.isArray(settings && settings.memory) ? settings.memory : [])
  .filter(m => m && typeof m.text === "string" && m.text.trim()).slice(-MAX_MEMORY).map(m => ({ id: String(m.id || ""), text: m.text.trim().slice(0, MEMORY_LEN), at: m.at || null }));

/* Category, project and goal names, both ways. */
function namer(M) {
  const cats = new Map(M.categories.map(c => [c.id, c.name])), lists = new Map(M.lists.map(l => [l.id, l.name]));
  return id => !id || id === "none" ? "Uncategorised" : id === E.BILLS_CAT ? cats.get(id) || "Bills" : id === E.SAVINGS_CAT ? "Savings"
    : String(id).startsWith("proj:") ? `Project: ${lists.get(id.slice(5)) || "a project"}` : cats.get(id) || "Other";
}
const byName = (arr, n) => { const k = lower(n); return k ? arr.find(x => lower(x.name) === k) || arr.find(x => lower(x.name).includes(k) || k.includes(lower(x.name))) || null : null; };

/* ---------- Where the person stands today: goes into every prompt ---------- */
export function snapshot(M, today) {
  const name = namer(M), L = E.state(M, today), st = E.startPoint(M, today), pd = E.nextPay(M, today);
  const out = { today: `${today} (${weekday(today)})`, startingBalanceSet: st.set };
  if (L.kind !== "current") return { ...out, note: `Counting starts on ${st.date}; nothing to show before that.` };
  const D = E.dayShare(M, today), mood = E.mood(M, today).mood, T = E.monthTotals(M, L.p, today), B = E.budgets(M, L.p, today);
  const occ = o => ({ bill: o.bill.name, due: o.due, amount: eu(o.amount), autopay: !!o.bill.autopay });
  // This week (Monday to today) against the four weeks before it, by category: what "usual" means here.
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7, wkFrom = E.addDays(today, -dow);
  const thisWeek = E.spending(M, wkFrom, today).byCat, usual = {};
  for (let k = 1; k <= 4; k++) { const f = E.addDays(wkFrom, -7 * k), t = E.addDays(f, dow); const s = E.spending(M, f, t).byCat; for (const [c, v] of Object.entries(s)) usual[c] = (usual[c] || 0) + v / 4; }
  const weekCats = [...new Set([...Object.keys(thisWeek), ...Object.keys(usual)])].filter(c => c !== E.BILLS_CAT)
    .map(c => ({ category: name(c), thisWeekSoFar: eu(thisWeek[c] || 0), usualBySameDay: eu(usual[c] || 0) }))
    .filter(x => x.thisWeekSoFar || x.usualBySameDay).sort((a, b) => b.thisWeekSoFar - a.thisWeekSoFar).slice(0, 8);
  return {
    ...out,
    mood: { calm: "calm (on track)", tight: "tight (little left, or a bill is late)", over: "over (spent more than there is)" }[mood],
    leftToSpendToday: D && D.left != null ? eu(D.left) : null, todaysShare: D && D.share != null ? eu(D.share) : null, spentToday: D ? eu(D.spent) : null,
    perDayFromTomorrow: D && D.tomorrow != null ? eu(D.tomorrow) : null,
    leftUntilPayday: eu(L.left), balanceNow: eu(L.now), moneyMustLastUntil: L.until,
    nextPayday: pd ? { date: pd.date, inDays: pd.days, from: pd.source ? pd.source.name : null, amount: pd.source && pd.source.amount != null ? Number(pd.source.amount) : null } : null,
    setAsideForBillsBeforePayday: L.dueThisMonth.map(occ), overdueBills: L.overdue.map(occ), savingsPlanStillToMove: eu(L.savingsDue),
    toComeOutOfNextPay: eu(L.owedSum), paymentsDatedAhead: eu(L.aheadSum),
    budgetMonth: { from: L.p.from, to: L.p.to, income: T.income == null ? null : eu(T.income), spent: eu(T.spend), billsPaid: eu(T.billsPaid), billsStillDue: eu(T.billsDue) },
    budgets: M.categories.filter(c => B.byId[c.id] != null).map(c => ({ category: c.name, budget: eu(B.byId[c.id]), spent: eu(T.byCat[c.id] || 0), left: eu(B.byId[c.id] - (T.byCat[c.id] || 0)) })),
    categoriesWithoutBudget: M.categories.filter(c => c.budget == null && c.id !== E.BILLS_CAT).map(c => c.name),
    goals: M.goals.map(g => ({ goal: g.name, saved: eu(E.goalSaved(M, g)), target: Number(g.target), monthly: g.monthly, targetDate: g.targetDate || null })),
    thisWeekByCategory: weekCats,
    lists: M.lists.filter(l => l.kind !== "room").map(l => l.name),
  };
}

/* ---------- Tools: what the model can look up ---------- */
const fn = (name, description, properties = {}) => ({ type: "function", function: { name, description, strict: true, parameters: { type: "object", additionalProperties: false, properties, required: Object.keys(properties) } } });
const S = (description, nullable = false) => ({ type: nullable ? ["string", "null"] : "string", description });
const Nm = (description, nullable = false) => ({ type: nullable ? ["number", "null"] : "number", description });
const Bo = description => ({ type: "boolean", description });
const Day = (d = "YYYY-MM-DD", nullable = true) => S(d, nullable);

export const LOOK = [
  fn("spending", "What was spent between two days (inclusive): the total, by category, by shop, and the purchases, newest first. Filter by a category name, or search for a shop or a thing bought (searches receipt lines too). Also gives the period just before, of the same length, for comparison.", {
    from: Day("First day, YYYY-MM-DD", false), to: Day("Last day, YYYY-MM-DD", false), category: S("One of their category names, or null", true), search: S("A shop or a thing bought (e.g. 'Lidl', 'coffee'), or null", true) }),
  fn("bills", "Every bill: amount, how often, next due date, autopay (direct debit), and whether this budget month's are paid."),
  fn("lists", "Their lists (shopping lists and home projects with rooms) and what is still to get on each, with prices where known."),
  fn("reminders", "The reminders they have set in Koti."),
  fn("afford", "What happens if they spend an amount today: what's left today and until payday before and after, the amount a day from tomorrow, and the category's budget. Use for 'can I afford…'.", {
    amount: Nm("Euros"), category: S("One of their category names, or null", true), from_next_pay: Bo("True if it would come out of their next pay instead of today's money") }),
];
export const ACT = [
  fn("add_expense", "Propose saving something they bought (they said what and how much). Shown as a card to confirm.", {
    amount: Nm("Euros paid"), payee: S("Shop or place, or null", true), date: Day("YYYY-MM-DD, or null for today"), category: S("One of their category names, or null", true),
    note: S("A few words of what it was, or null", true), from_next_pay: Bo("They said it comes out of their pay/salary"), from_savings: Bo("They said it comes out of savings"), goal: S("The savings goal it comes out of, or null", true) }),
  fn("add_to_list", "Propose putting things on one of their lists (a shopping list unless they name another).", {
    list: S("One of their list names, or null for the shopping list", true), items: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "qty"], properties: { name: S("The thing"), qty: Nm("How many, or null", true) } } } }),
  fn("add_reminder", "Propose a reminder (a notification on their phone).", {
    title: S("What to be reminded of, short"), when: { type: "string", enum: ["once", "monthly", "weekly"] }, date: Day("For once: YYYY-MM-DD"), month_day: Nm("For monthly: day 1-31", true),
    weekday: Nm("For weekly: 0 Sunday … 6 Saturday", true), hour: Nm("Hour 0-23 (default 9)", true), note: S("More detail, or null", true) }),
  fn("add_bill", "Propose adding a regular bill they told you about.", {
    name: S("Who or what the bill is for"), amount: Nm("Euros each time"), frequency: { type: "string", enum: ["monthly", "quarterly", "yearly", "once"] },
    due_day: Nm("Day of the month it's due, 1-31", true), due_date: Day("For a one-off bill, its due date"), autopay: Bo("It's a direct debit (goes out by itself)") }),
  fn("add_goal", "Propose a savings goal.", { name: S("What they are saving for"), target: Nm("Euros to reach"), monthly: Nm("Euros to put aside a month, or null", true), target_date: Day("When they want it by, or null") }),
  fn("set_budget", "Propose a monthly budget for one of their categories.", { category: S("One of their category names"), amount: Nm("Euros a month") }),
  fn("remember", "Remember something about them that will help later: their situation, preferences, plans, habits, or a correction they gave. One short fact in the third person ('Gets paid on the last working day', 'Is saving for a sofa', 'Prefers short answers'). Never amounts that live in their records, never passwords or card numbers.", { fact: S("The fact, short") }),
  fn("forget", "Forget something remembered that is no longer true or that they ask you to forget.", { fact: S("The remembered fact, as written") }),
];
export const TOOLS = [...LOOK, ...ACT];
const ACTION_NAMES = new Set(ACT.map(t => t.function.name));

function validRange(from, to, today) {
  let f = E.validDay(from) ? from : E.periodOf(today, E.monthStart({ settings: {} })).from, t = E.validDay(to) ? to : today;
  if (t < f) [f, t] = [t, f];
  if (E.daysBetween(f, t) > 800) f = E.addDays(t, -800);
  return { from: f, to: t };
}

export function look(M, today, name, a = {}) {
  const nm = namer(M);
  if (name === "spending") {
    const { from, to } = validRange(a.from, a.to, today), S = E.spending(M, from, to), cat = a.category ? byName(M.categories, a.category) : null, q = lower(a.search);
    const len = E.daysBetween(from, to), pf = E.addDays(from, -(len + 1)), pt = E.addDays(from, -1);
    const sign = t => (t.kind === "refund" ? -1 : 1);
    // What of each purchase matches: the whole of it, or only its lines in the category / matching the search.
    const part = t => {
      const lines = t.lines || [];
      if (cat) {
        const ls = lines.filter(l => (l.categoryId || t.categoryId) === cat.id);
        if (lines.length) { const rest = E.cents(t.amount) - lines.reduce((s, l) => s + E.cents(l.price), 0); return { amount: ls.reduce((s, l) => s + E.cents(l.price), 0) + (t.categoryId === cat.id ? rest : 0), lines: ls }; }
        return t.categoryId === cat.id ? { amount: E.cents(t.amount), lines: [] } : null;
      }
      if (q) {
        if (lower(t.payee).includes(q) || lower(t.note).includes(q)) return { amount: E.cents(t.amount), lines: lines.filter(l => lower(l.name).includes(q)) };
        const ls = lines.filter(l => lower(l.name).includes(q) || lower(l.nameFi).includes(q));
        return ls.length ? { amount: ls.reduce((s, l) => s + E.cents(l.price), 0), lines: ls } : null;
      }
      return { amount: E.cents(t.amount), lines: lines.slice(0, 6) };
    };
    const hits = S.entries.map(t => ({ t, p: part(t) })).filter(x => x.p && x.p.amount !== 0);
    const total = cat && !q ? S.byCat[cat.id] || 0 : cat || q ? hits.reduce((s, x) => s + sign(x.t) * x.p.amount, 0) : S.total;
    const shops = {}; hits.forEach(({ t, p }) => { const k = t.payee || nm(t.categoryId); shops[k] = (shops[k] || 0) + sign(t) * p.amount; });
    const prev = E.spending(M, pf, pt), prevTotal = cat && !q ? prev.byCat[cat.id] || 0 : null;
    return {
      from, to, total: eu(total), purchases: hits.length,
      ...(cat || q ? {} : { byCategory: Object.entries(S.byCat).filter(([, v]) => v).map(([k, v]) => ({ category: nm(k), amount: eu(v) })).sort((x, y) => y.amount - x.amount) }),
      byShop: Object.entries(shops).map(([shop, v]) => ({ shop, amount: eu(v) })).sort((x, y) => y.amount - x.amount).slice(0, 12),
      list: hits.sort((x, y) => (y.t.date || "").localeCompare(x.t.date || "")).slice(0, 40).map(({ t, p }) => ({ date: t.date, shop: t.payee || null, amount: eu(sign(t) * p.amount), category: nm(t.categoryId),
        ...(t.note ? { note: t.note } : {}), ...(p.lines.length ? { lines: p.lines.slice(0, 8).map(l => `${l.name} ${eu(E.cents(l.price))}`) } : {}), ...(t.kind === "refund" ? { refund: true } : {}) })),
      periodBefore: { from: pf, to: pt, total: eu(prevTotal == null ? (cat || q ? null : prev.total) : prevTotal) },
      ...(a.category && !cat ? { note: `No category called "${a.category}". Their categories: ${M.categories.map(c => c.name).join(", ")}` } : {}),
    };
  }
  if (name === "bills") {
    const L = E.state(M, today), p = E.periodOf(today, E.monthStart(M)), occ = E.billOccurrences(M, p, { includePaused: true });
    const next = b => { const y = +today.slice(0, 4), m = +today.slice(5, 7) - 1; for (let k = 0; k < 14; k++) { const d = E.billDue(b, y, m + k); if (d && d >= today) return d; } return null; };
    return { bills: M.bills.map(b => { const o = occ.find(x => x.bill.id === b.id); return { name: b.name, amount: b.amount, frequency: b.frequency, autopay: b.autopay, active: b.active, nextDue: b.active ? next(b) : null,
      thisMonth: o ? { due: o.due, paid: !!o.paid, skipped: o.skipped, amount: eu(o.amount) } : null, ...(b.endDate ? { ends: b.endDate } : {}) }; }),
      overdue: L.kind === "current" ? L.overdue.map(o => ({ bill: o.bill.name, due: o.due, amount: eu(o.amount) })) : [] };
  }
  if (name === "lists") {
    return { lists: M.lists.slice(0, 30).map(l => { const its = M.items.filter(i => i.listId === l.id); return { name: l.name, kind: l.kind, ...(l.parentId ? { in: (M.lists.find(x => x.id === l.parentId) || {}).name } : {}),
      toGet: its.filter(i => !i.done).slice(0, 40).map(i => ({ name: i.name, ...(i.qty ? { qty: i.qty } : {}), ...(i.price ? { price: i.price } : {}), priority: i.priority })), done: its.filter(i => i.done).length }; }) };
  }
  if (name === "reminders") return { reminders: (M.reminders || []).filter(r => r.active).map(r => ({ title: r.title, when: r.when, date: r.date, monthDay: r.monthDay, weekday: r.weekday, hour: r.hour })) };
  if (name === "afford") {
    const amount = amountOf(a.amount); if (!amount) return { error: "Give an amount above zero." };
    const cat = a.category ? byName(M.categories, a.category) : null, pay = a.from_next_pay ? E.nextPay(M, E.addDays(today, 1)) : null;
    const L0 = E.state(M, today); if (L0.kind !== "current") return { error: "Counting hasn't started yet." };
    const M2 = { ...M, transactions: [...M.transactions, { id: "what-if", date: today, amount, kind: "expense", categoryId: cat ? cat.id : null, payee: null, lines: null, fromPay: pay ? pay.date : null }] };
    const L1 = E.state(M2, today), D0 = E.dayShare(M, today), D1 = E.dayShare(M2, today), B = E.budgets(M, L0.p, today);
    const spentCat = cat ? E.monthTotals(M, L0.p, today).byCat[cat.id] || 0 : 0, b = cat ? B.byId[cat.id] : null;
    return { amount, leftUntilPayday: { now: eu(L0.left), after: eu(L1.left) }, leftToday: D0 && D0.left != null ? { now: eu(D0.left), after: eu(D1.left) } : null,
      perDayFromTomorrowAfter: D1 && D1.tomorrow != null ? eu(D1.tomorrow) : null, budget: cat && b != null ? { category: cat.name, leftNow: eu(b - spentCat), leftAfter: eu(b - spentCat - E.cents(amount)) } : null,
      ...(pay ? { comesOutOfPayOn: pay.date } : {}), wouldBeOverUntilPayday: L1.left < 0 };
  }
  return { error: `No tool called ${name}.` };
}

/* ---------- Actions: checked against their records, then returned to the app as cards ---------- */
export function action(M, today, name, a = {}) {
  const fail = error => ({ error });
  const catName = n => { if (!n) return null; const c = byName(M.categories, n); return c ? c.name : undefined; };
  const latest = E.addDays(today, 1), day = d => (E.validDay(d) && d >= "2000-01-01" && d <= E.addDays(today, 3660) ? d : null);
  if (name === "add_expense") {
    const amount = amountOf(a.amount); if (!amount) return fail("An expense needs the amount paid.");
    const cat = catName(a.category); if (cat === undefined) return fail(`No category called "${a.category}". Use one of: ${M.categories.map(c => c.name).join(", ")}, or null.`);
    const date = day(a.date) && a.date <= latest ? a.date : today, goal = a.goal ? byName(M.goals, a.goal) : null;
    return { type: "expense", amount, payee: str(a.payee, 120), date, category: cat, note: str(a.note, 200), fromNextPay: a.from_next_pay === true, fromSavings: a.from_savings === true && a.from_next_pay !== true, goal: goal ? goal.name : null };
  }
  if (name === "add_to_list") {
    const items = (Array.isArray(a.items) ? a.items : []).map(x => ({ name: str(x && x.name, 120), qty: Number.isInteger(x && x.qty) && x.qty > 1 && x.qty < 1000 ? x.qty : null })).filter(x => x.name).slice(0, 40);
    if (!items.length) return fail("Name at least one thing for the list.");
    const l = a.list ? byName(M.lists, a.list) : null;
    return { type: "list", list: l ? l.name : null, items };
  }
  if (name === "add_reminder") {
    const title = str(a.title, 120); if (!title) return fail("A reminder needs a title.");
    const when = ["once", "monthly", "weekly"].includes(a.when) ? a.when : "once", hour = Number.isInteger(a.hour) && a.hour >= 0 && a.hour <= 23 ? a.hour : 9;
    const r = { type: "reminder", title, when, note: str(a.note, 300), hour, date: null, monthDay: null, weekday: null };
    if (when === "once") { r.date = day(a.date) && a.date >= today ? a.date : null; if (!r.date) return fail("A one-off reminder needs a date from today on (YYYY-MM-DD)."); }
    if (when === "monthly") { r.monthDay = Number.isInteger(a.month_day) && a.month_day >= 1 && a.month_day <= 31 ? a.month_day : null; if (!r.monthDay) return fail("A monthly reminder needs a day of the month."); }
    if (when === "weekly") { r.weekday = Number.isInteger(a.weekday) && a.weekday >= 0 && a.weekday <= 6 ? a.weekday : null; if (r.weekday == null) return fail("A weekly reminder needs a weekday (0 Sunday … 6 Saturday)."); }
    return r;
  }
  if (name === "add_bill") {
    const nm = str(a.name, 80), amount = amountOf(a.amount); if (!nm || !amount) return fail("A bill needs a name and an amount.");
    const frequency = ["monthly", "quarterly", "yearly", "once"].includes(a.frequency) ? a.frequency : "monthly";
    const dueDate = frequency === "once" ? day(a.due_date) : null; if (frequency === "once" && !dueDate) return fail("A one-off bill needs its due date.");
    const dueDay = Number.isInteger(a.due_day) && a.due_day >= 1 && a.due_day <= 31 ? a.due_day : dueDate ? +dueDate.slice(8, 10) : null;
    if (!dueDay) return fail("Which day of the month is it due?");
    if (byName(M.bills, nm) && lower(byName(M.bills, nm).name) === lower(nm)) return fail(`They already have a bill called ${nm}.`);
    return { type: "bill", name: nm, amount, frequency, dueDay, dueDate, autopay: a.autopay === true, anchorMonth: dueDate ? +dueDate.slice(5, 7) : +today.slice(5, 7) };
  }
  if (name === "add_goal") {
    const nm = str(a.name, 80), target = amountOf(a.target); if (!nm || !target) return fail("A goal needs a name and a target.");
    return { type: "goal", name: nm, target, monthly: amountOf(a.monthly), targetDate: day(a.target_date) && a.target_date > today ? a.target_date : null };
  }
  if (name === "set_budget") {
    const c = byName(M.categories, a.category); if (!c) return fail(`No category called "${a.category}".`);
    const amount = typeof a.amount === "number" && a.amount >= 0 && a.amount < 1e6 ? Math.round(a.amount) : null; if (amount == null) return fail("Give the budget in euros.");
    return { type: "budget", category: c.name, amount, was: c.budget };
  }
  if (name === "remember") {
    const fact = str(a.fact, MEMORY_LEN); if (!fact) return fail("Nothing to remember.");
    if (/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|password|salasana|\bpin\b/i.test(fact)) return fail("Koti doesn't keep card numbers, passwords or PINs.");
    if (memoryOf(M.settings).some(m => lower(m.text) === lower(fact))) return fail("Already remembered.");
    return { type: "remember", fact };
  }
  if (name === "forget") {
    const k = lower(a.fact), mem = memoryOf(M.settings), m = mem.find(x => lower(x.text) === k) || mem.find(x => lower(x.text).includes(k) || (k && k.includes(lower(x.text))));
    return m ? { type: "forget", fact: m.text, id: m.id } : fail("Nothing like that is remembered.");
  }
  return fail(`No action called ${name}.`);
}

/* ---------- The prompts ---------- */
export function systemPrompt(M, today, { lang = "en", mode = "chat" } = {}) {
  const mem = memoryOf(M.settings), fi = lang === "fi", name = str(M.settings.name, 60);
  const snap = snapshot(M, today);
  return `You are Koti, the assistant inside Koti, a phone app for one person in Finland to run their money and set up their home. Money is in euros.
You are their sharp, warm, proactive helper: you notice what matters, say it plainly, and offer the next step. You can look things up with tools and propose actions, which appear as cards the person taps to confirm. You never save, pay or move money yourself, and you never claim you did.

How Koti counts (use these words):
- "Left to spend today" is today's share of what's left until payday, minus what was spent today. "Left until payday" is the balance after setting aside unpaid bills due before payday, overdue bills, payments dated ahead and this month's savings plan not yet moved. Money moved to a savings goal is not spending. Spending they said comes out of their next pay leaves on that payday.
- A direct debit (autopay) is never assumed paid; Koti asks.

Rules:
- Every amount you state comes from the snapshot below or from a tool result. Never estimate, add up in your head across tools, or invent figures. If you need a number you don't have, call a tool; if no tool has it, say you don't know.
- Dates: today is ${snap.today}. Turn "last week", "in October", "eilen" into exact dates yourself (weeks start on Monday).
- Answer in ${fi ? "Finnish" : "English"} unless they write in the other language. Be brief: one or two short sentences, under 30 words, plain text, no markdown, no lists unless they ask. Amounts like ${fi ? "23,40 €" : "€23.40"}.
- When they say they bought something with a price, call add_expense. "Remind me…" → add_reminder. Things to buy → add_to_list. A new regular bill → add_bill. Saving for something → offer add_goal. Then say in one sentence what you've put on the card.
- When they tell you something about themselves that would help later (how they get paid, who pays what, what they're saving for, preferences, a correction), call remember. Use what you remember to make answers personal. Don't repeat remembered facts back unprompted.
- Be proactive but not pushy: when you see a real risk (a bill before payday that money doesn't cover, a budget about to run out, a late bill) or a good move (a goal nearly reached, spare money before payday), mention it once, with the figure.
- Give at most three follow_ups: questions of a few words the person might tap next, in their language, each answerable with the tools.
- Never give investment, tax or legal advice beyond general common sense; never ask for card numbers or passwords.
${name ? `\nTheir name: ${name}.` : ""}
What you remember about them:
${mem.length ? mem.map(m => `- ${m.text}`).join("\n") : "- (nothing yet)"}

Their categories: ${M.categories.map(c => c.name).join(", ") || "(none)"}
Their savings goals: ${M.goals.map(g => g.name).join(", ") || "(none)"}

Where they stand today (worked out by Koti's engine):
${JSON.stringify(snap)}
${mode === "brief" ? `
Now write today's note for the top of their Today screen. Give one to three notes, most important first, each one short sentence under 90 characters, specific and with the figure: a bill due in the next few days and whether there's money for it, spending this week against usual, a budget running out, a late bill, pay arriving, a goal nearly there, or a quiet day with money to spare. Look things up with tools only if the snapshot isn't enough. Don't restate today's amount on its own: it is already shown in large type. If nothing stands out, one short encouraging note. Propose an action only when it clearly helps (for example a reminder for a bill due soon that isn't a direct debit). follow_ups: questions they might ask you next.` : ""}`;
}

const FINAL = {
  chat: { name: "answer", strict: true, schema: { type: "object", additionalProperties: false, required: ["reply", "follow_ups"], properties: { reply: { type: "string" }, follow_ups: { type: "array", items: { type: "string" } } } } },
  brief: { name: "brief", strict: true, schema: { type: "object", additionalProperties: false, required: ["notes", "follow_ups"], properties: { notes: { type: "array", items: { type: "string" } }, follow_ups: { type: "array", items: { type: "string" } } } } },
};

/* The history the app sent: user and assistant turns only, text only, the last few. */
export function cleanHistory(h) {
  return (Array.isArray(h) ? h : []).filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12).map(m => ({ role: m.role, content: m.content.trim().slice(0, m.role === "user" ? 1000 : 1500) }));
}

/* The conversation: the model may look things up and propose actions for a few rounds, then answers. */
export async function runAgent({ fetch: f = fetch, key, M, today, lang = "en", mode = "chat", history = [], model = MODEL, maxRounds = MAX_ROUNDS }) {
  const messages = [{ role: "system", content: systemPrompt(M, today, { lang, mode }) }, ...cleanHistory(history)];
  if (mode === "brief") messages.push({ role: "user", content: lang === "fi" ? "Mitä minun pitäisi tietää tänään?" : "What should I know today?" });
  const actions = [], looked = [];
  for (let round = 0; round < maxRounds; round++) {
    const last = round === maxRounds - 1;
    const res = await f(`${OPENAI_BASE}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(chatBody({ model, messages, tools: TOOLS, tool_choice: last ? "none" : "auto", response_format: { type: "json_schema", json_schema: FINAL[mode] || FINAL.chat } }, { effort: "low", model })),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(openaiError(res.status, e.error && e.error.message, model)), { status: res.status }); }
    const msg = ((await res.json()).choices || [])[0]?.message || {};
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter(c => c && c.type === "function") : [];
    if (calls.length && !last) {
      messages.push({ role: "assistant", content: msg.content || null, tool_calls: calls });
      for (const c of calls) {
        let args = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* empty */ }
        const n = c.function.name;
        let out;
        if (ACTION_NAMES.has(n)) {
          out = action(M, today, n, args);
          if (!out.error && actions.length < 6) { actions.push({ id: `a${actions.length + 1}`, ...out }); out = { ok: true, shown: "A card is shown to them to confirm." }; }
          else if (!out.error) out = { error: "Too many cards already. Finish with what you have." };
        } else { out = look(M, today, n, args); looked.push(n); }
        messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out).slice(0, 24000) });
      }
      continue;
    }
    let r = {}; try { r = JSON.parse(msg.content || "{}"); } catch { r = { reply: String(msg.content || "") }; }
    const ups = (Array.isArray(r.follow_ups) ? r.follow_ups : []).map(x => str(x, 90)).filter(Boolean).slice(0, 3);
    if (mode === "brief") return { notes: (Array.isArray(r.notes) ? r.notes : []).map(x => str(x, 220)).filter(Boolean).slice(0, 3), followUps: ups, actions, looked };
    return { reply: str(r.reply, 1500) || (lang === "fi" ? "En osannut vastata. Kokeile kysyä toisin." : "I couldn't work that out. Try asking another way."), followUps: ups, actions, looked };
  }
  return mode === "brief" ? { notes: [], followUps: [], actions, looked } : { reply: lang === "fi" ? "Tämä vei liian monta vaihetta. Kokeile kysyä tarkemmin." : "That took too many steps. Try asking something narrower.", followUps: [], actions, looked };
}
