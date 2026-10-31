// Home: your day at a glance. What's left until payday, anything that needs you, what's coming up,
// this month by category, and your lists.
import { store, todayISO, topLists, itemsOf, projectItems, projectSpent, BILLS_CAT } from "./data.js";
import { $, esc, eur, eur0, icon, parseDay, fmtDay } from "./ui.js";
import { periodFor, shift, totals, heroHTML, alertsHTML, bindHero, catName, catColor } from "./money.js";
import { monthLedger } from "./ledger.js";
import { occurrences } from "./plan.js";
import { incomeOccurrences, nextPay } from "./income.js";

let root = null;
export function mountHome(el) {
  root = el;
  root.innerHTML = `
  <header class="vh"><div><h1 id="hoTitle">Home</h1><div class="sub" id="hoSub"></div></div><a class="avatar" href="#settings" id="hoAvatar" aria-label="Settings and profile"></a></header>
  <div id="hoAlerts"></div>
  <div class="ho-grid">
    <section class="card mo-hero" id="hoHero"></section>
    <div>
      <div class="gh"><h2>Coming up</h2><a class="link" href="#bills">Bills</a></div><div id="hoNext"></div>
      <div class="gh"><h2>This month</h2><a class="link" href="#budgets">Budgets</a></div><a class="card ho-month" href="#budgets" id="hoMonth"></a>
    </div>
  </div>
  <div class="gh"><h2>Lists</h2><a class="link" href="#expenses">Expenses</a></div><div class="minis" id="hoLists"></div>`;
  bindHero(root, () => renderHome());
}

export function renderHome() {
  if (!root) return;
  const S = store.model.settings, nm = (S.name || "").trim(), cur = periodFor(new Date()), today = todayISO(), pd = nextPay();
  $("#hoTitle", root).textContent = nm ? `Hi ${nm}` : "Home";
  $("#hoSub", root).textContent = [new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }), pd ? (pd.days === 0 ? "payday today" : `${pd.days} day${pd.days === 1 ? "" : "s"} to payday`) : ""].filter(Boolean).join(" · ");
  const av = $("#hoAvatar", root); av.innerHTML = nm ? esc(nm[0].toUpperCase()) : icon("user", "ic sm"); av.style.background = S.avatarColor || "";

  const L = monthLedger(cur);
  $("#hoHero", root).innerHTML = heroHTML(L);
  $("#hoAlerts", root).innerHTML = alertsHTML(L, true);

  // Coming up: unpaid bills and expected pay in the next 30 days
  const horizon = (() => { const d = parseDay(today); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
  const next = [];
  [cur, shift(cur, 1)].forEach(p => {
    occurrences(p).forEach(o => { if (!o.paid && !o.skipped && o.due >= today && o.due <= horizon) next.push({ due: o.due, name: o.bill.name, sub: o.bill.autopay ? "Paid automatically" : rel(o.due, today), amount: o.amount, kind: "bill" }); });
    incomeOccurrences(p).forEach(o => { if (!o.got && !o.missed && o.due >= today && o.due <= horizon && o.src.amount) next.push({ due: o.due, name: o.src.name, sub: "Expected · not counted yet", amount: o.src.amount, kind: "in" }); });
  });
  const seen = new Set(), list = next.filter(x => { const k = x.kind + x.name + x.due; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  $("#hoNext", root).innerHTML = list.length ? `<div class="grp">${list.map(x => { const d = parseDay(x.due);
    return `<a class="row" href="${x.kind === "bill" ? "#bills" : "#income"}"><span class="dchip${x.kind === "in" ? " g" : ""}"><b>${d.getDate()}</b>${d.toLocaleDateString("en-GB", { month: "short" })}</span><span class="rt">${esc(x.name)}<small>${esc(x.sub)}</small></span><span class="rv num${x.kind === "in" ? " good" : ""}">${x.kind === "in" ? "+" : ""}${eur(x.amount)}</span></a>`; }).join("")}</div>`
    : `<div class="empty" style="padding:16px">Nothing due in the next 30 days.</div>`;

  // This month by category
  const T = totals(cur), parts = Object.entries(T.byCat).filter(([k, v]) => k !== BILLS_CAT && v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k === "none" ? "No category" : catName(k), v, k === "none" ? "#9aa59f" : catColor(k)]);
  if (T.projects > 0) parts.push(["Projects", T.projects, "var(--amber)"]);
  const sum = parts.reduce((a, p) => a + p[1], 0), budgeted = store.model.categories.reduce((a, c) => a + (Number(c.budget) || 0), 0);
  $("#hoMonth", root).innerHTML = sum ? `<div class="card-head" style="margin:0 0 8px"><span class="k">Spent so far</span><b class="num">${eur0(sum)}${budgeted ? ` <small class="muted">of ${eur0(budgeted)} budgeted</small>` : ""}</b></div>
    <span class="stack" role="img" aria-label="${esc(parts.map(p => `${p[0]} ${eur0(p[1])}`).join(", "))}">${parts.map(p => `<i style="width:${p[1] / sum * 100}%;background:${p[2]}"></i>`).join("")}</span>
    <span class="plegend two">${parts.slice(0, 8).map(([l, v, c]) => `<span><i style="background:${c}"></i><span>${esc(l)}</span><b class="num">${eur0(v)}</b></span>`).join("")}</span>`
    : `<span class="k">Nothing spent yet this month.</span>`;

  // Lists
  const lists = topLists();
  $("#hoLists", root).innerHTML = lists.map(l => {
    if (l.kind === "project") { const its = projectItems(l.id), done = its.filter(i => i.done).length, b = Number(l.budget) || 0;
      return `<a class="mini" href="#list/${encodeURIComponent(l.id)}"><b>${esc(l.name)}</b><small>${its.length ? Math.round(done / its.length * 100) + "% bought" : "No items"}${b ? ` · ${eur0(b - projectSpent(l.id))} left` : ""}</small></a>`; }
    const todo = itemsOf(l.id).filter(i => !i.done).length;
    return `<a class="mini" href="#list/${encodeURIComponent(l.id)}"><b>${esc(l.name)}</b><small>${todo ? `${todo} to buy` : "All bought"}</small></a>`;
  }).join("") || `<a class="mini" href="#expenses"><b>Make a list</b><small>Groceries, a project…</small></a>`;
}
function rel(due, today) { const n = Math.round((parseDay(due) - parseDay(today)) / 864e5); return n === 0 ? "Due today" : n === 1 ? "Due tomorrow" : `Due in ${n} days`; }
