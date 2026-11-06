// "Suggest budgets": the AI asks a few questions (one always about saving), then plans the month: a monthly amount
// for each savings goal, a new goal when one would help (a buffer for surprises), and a budget for each category.
// The money figures come from js/engine.js (budgetContext): this month's pay and bills, the pay left after bills,
// each goal, and what each category took lately. The suggest-budgets function checks the plan (only these categories
// and goals, rounded to €5, savings and budgets together never more than the pay left after bills). Nothing changes
// until "Use these", and Undo puts budgets and goals back as they were.
import { store, todayISO, newId } from "./data.js";
import { $, $$, esc, eur0, openSheet, closeSheet, toast, aiWait, parseMoney } from "./ui.js";
import { sync } from "./sync.js";
import { aiPossible } from "./receipts.js";
import * as E from "./engine.js";

const eu = c => (c == null ? null : E.euros(c));

/* What the AI is told: the figures, in euros, and the categories and goals by name. */
export function budgetHelpContext(model = store.model, today = todayISO()) {
  const c = E.budgetContext(model, today);
  return { raw: c, send: { income: eu(c.income), bills: eu(c.bills), savings: eu(c.savings), spendable: c.income > 0 ? eu(c.spendable) : null, available: eu(c.available),
    monthsLookedAt: c.monthsLookedAt, daysLeft: E.daysBetween(today, c.period.to) + 1,
    categories: c.categories.map(x => ({ name: x.name, budget: eu(x.budget), average: eu(x.average), thisMonth: eu(x.thisMonth) })),
    goals: c.goals.map(g => ({ name: g.name, target: eu(g.target), saved: eu(g.saved), monthly: eu(g.monthly), targetDate: g.targetDate })) } };
}

async function call(body) {
  const { data, error } = await sync.client.functions.invoke("suggest-budgets", { body });
  if (error) {
    let info = {}; try { info = error.context && error.context.json ? await error.context.json() : {}; } catch {}
    throw new Error(info.error || (/Failed to fetch|network/i.test(error.message) ? "Couldn't reach Koti's AI." : error.message));
  }
  if (data && data.limit) { try { localStorage.setItem("koti.aiLimit", String(data.limit)); } catch {} }
  return data;
}

/* Puts the plan in place: budgets, each goal's monthly amount, and a new goal. Returns Undo. */
export function applyPlan({ budgets = [], goals = [], newGoal = null }) {
  const cats = store.model.categories.map(c => ({ ...c })), gs = store.model.goals.map(g => ({ ...g }));
  budgets.forEach(r => { const c = store.model.categories.find(x => x.id === r.id); if (c && Number(c.budget) !== r.amount) store.put("categories", { ...c, budget: r.amount }); });
  goals.forEach(r => { const g = store.model.goals.find(x => x.id === r.id); if (g && Number(g.monthly) !== r.monthly) store.put("goals", { ...g, monthly: r.monthly }); });
  const made = newGoal ? store.put("goals", { id: newId("goal"), name: newGoal.name, target: newGoal.target, saved: 0, monthly: newGoal.monthly, targetDate: null, position: store.model.goals.length }) : null;
  return () => {
    cats.forEach(b => { const c = store.model.categories.find(x => x.id === b.id); if (c && c.budget !== b.budget) store.put("categories", { ...c, budget: b.budget }); });
    gs.forEach(b => { const g = store.model.goals.find(x => x.id === b.id); if (g && g.monthly !== b.monthly) store.put("goals", { ...g, monthly: b.monthly }); });
    if (made) store.remove("goals", made.id);
  };
}
/* Budgets alone (the tests use it; kept for anything that sets only budgets). */
export const applyBudgets = rows => applyPlan({ budgets: rows });

export function openBudgetHelp() {
  if (!aiPossible()) { toast("Sign in and go online to get budget suggestions."); return; }
  const ctx = budgetHelpContext(), C = ctx.raw, answers = [], hasPay = C.income > 0;
  const figures = () => hasPay
    ? `<p class="bh-fig">Your pay ${eur0(eu(C.income))} − bills ${eur0(eu(C.bills))} leaves <b>${eur0(eu(C.spendable))}</b> a month to share between saving and everyday spending.${C.goals.length ? ` ${C.goals.length === 1 ? "Your goal puts" : "Your goals put"} ${eur0(eu(C.savings))} aside now.` : ""}</p>`
    : `<p class="bh-fig">Koti doesn't know your pay yet, so the plan will follow what you've spent. <a href="#income" data-close>Add your pay</a> for one that fits it.</p>`;
  openSheet({ title: "Plan my month", left: "Cancel", body: B => {
    const fail = e => { B.innerHTML = `<p class="msg" data-state="error">${esc(e.message || e)}</p><button type="button" class="btn" data-again>Try again</button>`; $("[data-again]", B).onclick = start; };
    async function start() {
      B.innerHTML = aiWait("Looking at your month…", "Your pay, bills, savings and what you've spent lately");
      let q; try { q = await call({ step: "questions", context: ctx.send }); } catch (e) { fail(e); return; }
      askQuestions(q);
    }
    function askQuestions(q) {
      const qs = q.questions || []; if (!qs.length) { suggest(); return; }
      B.innerHTML = `${figures()}${q.intro ? `<p class="note" style="margin:0">${esc(q.intro)}</p>` : ""}
        ${qs.map((x, i) => `<fieldset class="bq" data-q="${i}"><legend>${esc(x.text)}</legend><div class="bq-opts">${x.options.map(o => `<button type="button" class="fchip" aria-pressed="false" data-o="${esc(o)}">${esc(o)}</button>`).join("")}</div>
          <input class="inp" data-free placeholder="Or in your own words" maxlength="200" autocomplete="off" aria-label="${esc(x.text)} In your own words"></fieldset>`).join("")}
        <button type="button" class="btn primary" data-go>Plan my month</button>`;
      $$(".bq", B).forEach(f => f.addEventListener("click", e => { const b = e.target.closest("[data-o]"); if (!b) return; const on = b.getAttribute("aria-pressed") !== "true"; $$("[data-o]", f).forEach(x => x.setAttribute("aria-pressed", x === b && on)); }));
      $("[data-go]", B).onclick = () => {
        answers.length = 0;
        $$(".bq", B).forEach(f => { const pick = $("[data-o][aria-pressed=true]", f), free = $("[data-free]", f).value.trim(), a = [pick && pick.dataset.o, free].filter(Boolean).join(". "); if (a) answers.push({ question: qs[f.dataset.q].text, answer: a }); });
        suggest();
      };
    }
    async function suggest() {
      B.innerHTML = aiWait("Planning your month…", hasPay ? `Sharing ${eur0(eu(C.spendable))} between saving and spending` : "From what you've spent lately");
      let s; try { s = await call({ step: "suggest", context: ctx.send, answers }); } catch (e) { fail(e); return; }
      show(s);
    }
    function show(s) {
      const catBy = new Map(C.categories.map(c => [c.name, c])), goalBy = new Map(C.goals.map(g => [g.name, g]));
      const budgets = (s.budgets || []).filter(b => catBy.has(b.category)), savings = (s.savings || []).filter(x => goalBy.has(x.goal)), ng = s.newGoal || null;
      if (!budgets.length && !savings.length && !ng) { fail(new Error("The AI didn't suggest anything. Try again.")); return; }
      const amt = (attrs, v, label) => `<span class="bh-amt"><span aria-hidden="true">€</span><input class="inl num" inputmode="decimal" ${attrs} value="${v}" aria-label="${esc(label)}"></span>`;
      B.innerHTML = `${s.note ? `<p class="note" style="margin:0">${esc(s.note)}</p>` : ""}
        ${savings.length || ng ? `<h3 class="bh-h">Savings, each month</h3><div class="grp">
          ${savings.map(x => { const g = goalBy.get(x.goal); return `<label class="row bh-row"><span class="rt">${esc(x.goal)}<small>${esc(x.why)}${g.target ? ` ${esc(eur0(eu(g.saved)))} of ${esc(eur0(eu(g.target)))} saved.` : ""}</small></span>${amt(`data-goal="${esc(g.id)}" data-save`, x.monthly, `${x.goal}, euros a month`)}</label>`; }).join("")}
          ${ng ? `<div class="row bh-row bh-new"><label class="rt" for="bhNew"><span><input type="checkbox" id="bhNew" checked> New goal: ${esc(ng.name)}</span><small>${esc(ng.why)} Target ${esc(eur0(ng.target))}.</small></label>${amt(`data-new data-save`, ng.monthly, `${ng.name}, euros a month`)}</div>` : ""}
        </div>` : ""}
        <h3 class="bh-h">Budgets, each month</h3>
        <div class="grp">${budgets.map(b => { const c = catBy.get(b.category); return `<label class="row bh-row"><span class="rt">${esc(b.category)}<small>${esc(b.why)}</small></span>${amt(`data-id="${esc(c.id)}"`, b.amount, `${b.category} budget, euros a month`)}</label>`; }).join("")}</div>
        <p class="bh-total" aria-live="polite"></p>
        <button type="button" class="btn primary" data-use>Use these</button>
        <button type="button" class="btn" data-again>Start again</button>
        <p class="note">You can change budgets later in Budgets → Edit, and goals in Savings.</p>`;
      const num = i => parseMoney(i.value), newOn = () => !!(ng && $("#bhNew", B) && $("#bhNew", B).checked);
      const read = () => ({
        budgets: $$("[data-id]", B).map(i => ({ id: i.dataset.id, amount: num(i) })),
        goals: $$("[data-goal]", B).map(i => ({ id: i.dataset.goal, monthly: num(i) })),
        newGoal: newOn() ? { name: ng.name, target: ng.target, monthly: num($("[data-new]", B)) } : null,
      });
      const paintTotal = () => {
        const r = read(), vals = [...r.budgets.map(x => x.amount), ...r.goals.map(x => x.monthly), ...(r.newGoal ? [r.newGoal.monthly] : [])], bad = vals.some(v => Number.isNaN(v) || v < 0);
        const save = r.goals.reduce((a, x) => a + (Number(x.monthly) || 0), 0) + (r.newGoal ? Number(r.newGoal.monthly) || 0 : 0), spend = r.budgets.reduce((a, x) => a + (Number(x.amount) || 0), 0);
        const room = hasPay ? eu(C.spendable) : null, total = save + spend;
        $(".bh-total", B).innerHTML = bad ? `<span class="danger">Type each amount as a number.</span>`
          : `Saving <b class="num">${eur0(save)}</b> and spending <b class="num">${eur0(spend)}</b>${room != null ? ` of <b class="num">${eur0(room)}</b> left after bills${total > room ? ` <span class="danger">(${eur0(total - room)} more than you have)</span>` : `, with ${eur0(room - total)} unplanned`}` : ""}.`;
        $("[data-use]", B).disabled = bad;
      };
      B.addEventListener("input", paintTotal); B.addEventListener("change", paintTotal); paintTotal();
      $("[data-again]", B).onclick = start;
      $("[data-use]", B).onclick = () => {
        const r = read(), round = v => Math.round(v * 100) / 100;
        const undo = applyPlan({ budgets: r.budgets.map(x => ({ id: x.id, amount: round(x.amount) })), goals: r.goals.map(x => ({ id: x.id, monthly: round(x.monthly) })), newGoal: r.newGoal && { ...r.newGoal, monthly: round(r.newGoal.monthly) } });
        closeSheet(); toast(r.newGoal || r.goals.length ? "Budgets and savings set" : "Budgets set", { label: "Undo", run: undo });
      };
    }
    start();
  } });
}
