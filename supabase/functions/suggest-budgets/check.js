// The AI's plan for the month, made safe before anyone sees it. Plain JavaScript, so tests/budgets.test.mjs runs it
// in Node and suggest-budgets runs it in Deno.
//   budgets   only the person's own categories, each once, whole euros rounded to €5
//   savings   only the person's own goals, each once, a monthly amount rounded to €5
//   newGoal   at most one, with a name, a target and a monthly amount; never one that duplicates a goal they have
// Budgets and savings together never come to more than the pay left after bills ("spendable"). If they do, the
// budgets shrink first, because saving is what the person asked about; savings shrink only when they alone are too
// much. Nothing is ever scaled up.
const r5 = v => Math.round(v / 5) * 5, down5 = v => Math.floor(v / 5) * 5;
const amount = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? r5(n) : null; };

function pick(raw, names, field) {
  const seen = new Set(), byLower = new Map(names.map(n => [n.toLowerCase(), n]));
  return (Array.isArray(raw) ? raw : []).map(b => ({ name: byLower.get(String((b && b[field]) || "").toLowerCase()) || null, amount: amount(b && (b.amount ?? b.monthly)), why: String((b && b.why) || "").trim().slice(0, 200) }))
    .filter(b => b.name && b.amount != null && !seen.has(b.name) && seen.add(b.name));
}

export function checkPlan(raw, categoryNames, goalNames, spendable) {
  let budgets = pick(raw && raw.budgets, categoryNames, "category").map(b => ({ category: b.name, amount: b.amount, why: b.why }));
  let savings = pick(raw && raw.savings, goalNames, "goal").map(b => ({ goal: b.name, monthly: b.amount, why: b.why }));
  const g = raw && raw.newGoal, gName = g && String(g.name || "").trim().slice(0, 80);
  let newGoal = gName && !goalNames.some(n => n.toLowerCase() === gName.toLowerCase()) && amount(g.target) > 0 && amount(g.monthly) != null
    ? { name: gName, target: amount(g.target), monthly: amount(g.monthly), why: String(g.why || "").trim().slice(0, 200) } : null;

  const saveTotal = () => savings.reduce((a, s) => a + s.monthly, 0) + (newGoal ? newGoal.monthly : 0);
  const budgetTotal = () => budgets.reduce((a, b) => a + b.amount, 0);
  if (spendable != null) {
    const room = Math.max(0, spendable);
    if (saveTotal() > room) {   // saving alone is more than there is: scale it down, and nothing is left to budget
      const k = saveTotal() ? room / saveTotal() : 0;
      savings = savings.map(s => ({ ...s, monthly: down5(s.monthly * k) }));
      if (newGoal) newGoal = { ...newGoal, monthly: down5(newGoal.monthly * k) };
    }
    const left = room - saveTotal();
    if (budgetTotal() > left) { const k = budgetTotal() ? left / budgetTotal() : 0; budgets = budgets.map(b => ({ ...b, amount: down5(b.amount * k) })); }
  }
  return { budgets, savings, newGoal, budgetTotal: budgetTotal(), saveTotal: saveTotal() };
}

/* Budgets alone, as before (kept for the tests that check the rounding and the cap). */
export function checkBudgets(raw, names, available) {
  const r = checkPlan({ budgets: raw }, names, [], available == null ? null : available);
  return { budgets: r.budgets, total: r.budgetTotal };
}
