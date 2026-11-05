// The AI's budget suggestion, made safe before anyone sees it: only the person's own categories, each once, whole
// euros rounded to €5, and a total no bigger than what is left for everyday spending (scaled down to fit, never up).
// Plain JavaScript, so tests/budgets.test.mjs runs it in Node and suggest-budgets runs it in Deno.
export function checkBudgets(raw, names, available) {
  const seen = new Set(), byLower = new Map(names.map(n => [n.toLowerCase(), n]));
  let out = (Array.isArray(raw) ? raw : []).map(b => ({ category: byLower.get(String((b && b.category) || "").toLowerCase()) || null, amount: Number(b && b.amount), why: String((b && b.why) || "").trim().slice(0, 200) }))
    .filter(b => b.category && Number.isFinite(b.amount) && b.amount >= 0 && !seen.has(b.category) && seen.add(b.category))
    .map(b => ({ ...b, amount: Math.round(b.amount / 5) * 5 }));
  const total = () => out.reduce((a, b) => a + b.amount, 0);
  if (available != null && available < 0) out = out.map(b => ({ ...b, amount: 0 }));
  else if (available != null && total() > available) { const k = available / total(); out = out.map(b => ({ ...b, amount: Math.floor(b.amount * k / 5) * 5 })); }
  return { budgets: out, total: total() };
}
