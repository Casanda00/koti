// 300 made-up households for checking money figures: a balance, bills (some paused, skipped or paid by direct
// debit), pay, receipts split by line, refunds, savings, corrections, project purchases and a goal. Each seed gives
// the same household every time, so a failure can be run again.
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const money = r => Math.round(r() * 30000) / 100;   // up to €300, to the cent
export const SEEDS = 300;

/* Fills the model S with household `seed` and returns the day to look at it on. */
export function household(S, seed) {
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
  return pick(r, ["2027-03-01", "2027-03-10", "2027-03-25", "2027-03-31", "2027-04-01"]);
}

/* What the app's screens show for the current budget month, in cents, read through the app's own functions. */
export function appFigures(A, today, extra) {
  const c = v => Math.round(v * 100);
  const p = A.money.periodFor(new Date()), L = A.monthLedger(p), out = { today, kind: L.kind };
  if (L.kind === "current") {
    for (const k of ["now", "carried", "income", "spent", "bills", "adjust", "saved", "due", "aheadSum", "savingsDue", "left", "expectedSum"]) out[k] = c(L[k]);
    out.until = L.until;
    out.overdue = L.overdue.map(o => o.bill.id + "@" + o.due);
    out.dueThisMonth = L.dueThisMonth.map(o => o.bill.id + "@" + o.due);
  }
  const sp = extra.spentBetween(p.from, p.to), tot = A.money.totals(p), B = A.effectiveBudgets(p);
  out.spending = { total: c(sp.total), byCat: Object.fromEntries(Object.entries(sp.byCat).map(([k, v]) => [k, c(v)])), withoutProjects: c(tot.spend), projects: c(tot.projects) };
  out.budgets = { total: c(B.total), byId: Object.fromEntries(Object.entries(B.byId).map(([k, v]) => [k, c(v)])) };
  const D = extra.dayShare();
  out.dayShare = D ? { days: D.days, morning: c(D.morning), share: D.share == null ? null : D.share * 100 } : null;
  return out;
}
