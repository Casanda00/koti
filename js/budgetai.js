// "Suggest budgets": the AI asks a few questions, then suggests a monthly budget for each category.
// The money figures come from js/engine.js (budgetContext): this month's pay, bills and savings plan, what's left for
// everyday spending, and what each category took lately. The suggest-budgets function checks the AI's answer (only
// these categories, rounded to €5, never more in total than is left). Nothing changes until "Use these", and Undo
// puts the old budgets back.
import { store, todayISO } from "./data.js";
import { $, $$, esc, eur0, openSheet, closeSheet, toast, aiWait, parseMoney } from "./ui.js";
import { sync } from "./sync.js";
import { aiPossible } from "./receipts.js";
import * as E from "./engine.js";

const eu = c => (c == null ? null : E.euros(c));

/* What the AI is told: the figures, in euros, and the categories by name. */
export function budgetHelpContext(model = store.model, today = todayISO()) {
  const c = E.budgetContext(model, today);
  return { raw: c, send: { income: eu(c.income), bills: eu(c.bills), savings: eu(c.savings), available: eu(c.available), monthsLookedAt: c.monthsLookedAt,
    daysLeft: E.daysBetween(today, c.period.to) + 1, categories: c.categories.map(x => ({ name: x.name, budget: eu(x.budget), average: eu(x.average), thisMonth: eu(x.thisMonth) })) } };
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

/* Sets the suggested budgets; returns the old ones so Undo can put them back. */
export function applyBudgets(rows) {
  const before = store.model.categories.map(c => ({ ...c }));
  rows.forEach(r => { const c = store.model.categories.find(x => x.id === r.id); if (c && Number(c.budget) !== r.amount) store.put("categories", { ...c, budget: r.amount }); });
  return () => before.forEach(b => { const c = store.model.categories.find(x => x.id === b.id); if (c && c.budget !== b.budget) store.put("categories", { ...c, budget: b.budget }); });
}

export function openBudgetHelp() {
  if (!aiPossible()) { toast("Sign in and go online to get budget suggestions."); return; }
  const ctx = budgetHelpContext(), C = ctx.raw, answers = [];
  const figures = () => C.income > 0
    ? `<p class="bh-fig">Your pay ${eur0(eu(C.income))} − bills ${eur0(eu(C.bills))}${C.savings ? ` − savings ${eur0(eu(C.savings))}` : ""} leaves <b>${eur0(eu(C.available))}</b> a month for everyday spending.</p>`
    : `<p class="bh-fig">Koti doesn't know your pay yet, so the suggestion will follow what you've spent. <a href="#income" data-close>Add your pay</a> for a plan that fits it.</p>`;
  openSheet({ title: "Suggest budgets", left: "Cancel", body: B => {
    const fail = e => { B.innerHTML = `<p class="msg" data-state="error">${esc(e.message || e)}</p><button type="button" class="btn" data-again>Try again</button>`; $("[data-again]", B).onclick = start; };
    async function start() {
      B.innerHTML = aiWait("Looking at your month…", "Your pay, bills and what you've spent lately");
      let q; try { q = await call({ step: "questions", context: ctx.send }); } catch (e) { fail(e); return; }
      askQuestions(q);
    }
    function askQuestions(q) {
      const qs = q.questions || []; if (!qs.length) { suggest(); return; }
      B.innerHTML = `${figures()}${q.intro ? `<p class="note" style="margin:0">${esc(q.intro)}</p>` : ""}
        ${qs.map((x, i) => `<fieldset class="bq" data-q="${i}"><legend>${esc(x.text)}</legend><div class="bq-opts">${x.options.map(o => `<button type="button" class="fchip" aria-pressed="false" data-o="${esc(o)}">${esc(o)}</button>`).join("")}</div>
          <input class="inp" data-free placeholder="Or in your own words" maxlength="200" autocomplete="off" aria-label="${esc(x.text)} In your own words"></fieldset>`).join("")}
        <button type="button" class="btn primary" data-go>Suggest my budgets</button>`;
      $$(".bq", B).forEach(f => f.addEventListener("click", e => { const b = e.target.closest("[data-o]"); if (!b) return; const on = b.getAttribute("aria-pressed") !== "true"; $$("[data-o]", f).forEach(x => x.setAttribute("aria-pressed", x === b && on)); }));
      $("[data-go]", B).onclick = () => {
        answers.length = 0;
        $$(".bq", B).forEach(f => { const pick = $("[data-o][aria-pressed=true]", f), free = $("[data-free]", f).value.trim(), a = [pick && pick.dataset.o, free].filter(Boolean).join(". "); if (a) answers.push({ question: qs[f.dataset.q].text, answer: a }); });
        suggest();
      };
    }
    async function suggest() {
      B.innerHTML = aiWait("Working out your budgets…", C.income > 0 ? `Fitting them into ${eur0(eu(C.available))} a month` : "From what you've spent lately");
      let s; try { s = await call({ step: "suggest", context: ctx.send, answers }); } catch (e) { fail(e); return; }
      show(s);
    }
    function show(s) {
      const byName = new Map(C.categories.map(c => [c.name, c])), rows = (s.budgets || []).filter(b => byName.has(b.category));
      if (!rows.length) { fail(new Error("The AI didn't suggest anything. Try again.")); return; }
      B.innerHTML = `${s.note ? `<p class="note" style="margin:0">${esc(s.note)}</p>` : ""}
        <div class="grp">${rows.map(b => { const c = byName.get(b.category); return `<label class="row bh-row"><span class="rt">${esc(b.category)}<small>${esc(b.why)}</small></span><span class="bh-amt"><span aria-hidden="true">€</span><input class="inl num" inputmode="decimal" data-id="${esc(c.id)}" value="${b.amount}" aria-label="${esc(b.category)} budget, euros a month"></span></label>`; }).join("")}</div>
        <p class="bh-total" aria-live="polite"></p>
        <button type="button" class="btn primary" data-use>Use these</button>
        <button type="button" class="btn" data-again>Start again</button>
        <p class="note">You can change any budget later in Budgets → Edit.</p>`;
      const read = () => $$("[data-id]", B).map(i => ({ id: i.dataset.id, amount: parseMoney(i.value) }));
      const paintTotal = () => { const r = read(), bad = r.some(x => Number.isNaN(x.amount) || x.amount < 0), t = r.reduce((a, x) => a + (Number(x.amount) || 0), 0);
        $(".bh-total", B).innerHTML = bad ? `<span class="danger">Type each budget as a number.</span>` : C.income > 0 ? `Total <b class="num">${eur0(t)}</b> of <b class="num">${eur0(eu(C.available))}</b> left for everyday spending${t > eu(C.available) ? ` <span class="danger">(${eur0(t - eu(C.available))} more than you have)</span>` : ""}.` : `Total <b class="num">${eur0(t)}</b> a month.`;
        $("[data-use]", B).disabled = bad; };
      B.addEventListener("input", paintTotal); paintTotal();
      $("[data-again]", B).onclick = start;
      $("[data-use]", B).onclick = () => {
        const undo = applyBudgets(read().map(x => ({ id: x.id, amount: Math.round(x.amount * 100) / 100 })));
        closeSheet(); toast("Budgets set", { label: "Undo", run: undo });
      };
    }
    start();
  } });
}
