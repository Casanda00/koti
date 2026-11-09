// "Plan my month": Koti asks what decides the plan, one question to a screen, then plans the month: a monthly amount
// for each savings goal, a new goal when one would help (a buffer for surprises), and a budget for each category.
// Every question is one whose answer changes the plan (planQuestions): this month's pay and bills, whether to learn from
// past spending (offered only when there is past spending to learn from), saving, who lives with you, how you eat and
// get around, and anything big coming. Each has its own box for saying it in your words, and the last one is only
// that. Answers you'd give again (household, food, transport) are kept and offered first next time.
// The money figures come from js/engine.js (budgetContext). The suggest-budgets function checks the plan (only these
// categories and goals, rounded to €5, savings and budgets together never more than the pay left after bills).
// Nothing changes until "Use these", and Undo puts budgets and goals back as they were.
import { store, todayISO, newId } from "./data.js";
import { $, $$, esc, eur0, openSheet, closeSheet, toast, aiWait, parseMoney, icon } from "./ui.js";
import { sync } from "./sync.js";
import { aiPossible, aiOffReason } from "./receipts.js";
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

/* ---------- The questions ---------- */
/* What decides the plan, in the order Koti asks. C: budgetContext (cents). prev: the answers kept from last time.
   Each question: id, text, options [{v, label, money?}] (money: picking it opens a box for an amount), free (the box
   for your own words: true, or a placeholder), freeOnly (no options: the last question). */
export function planQuestions(C, prev = {}) {
  const q = [], money = c => eur0(eu(c));
  if (C.income > 0) q.push({ id: "pay", text: `Is your pay this month ${money(C.income)}?`, options: [{ v: "yes", label: `Yes, ${money(C.income)}` }, { v: "other", label: "It's a different amount", money: true }] });
  else q.push({ id: "pay", text: "How much pay comes in this month?", options: [{ v: "other", label: "This much", money: true }, { v: "skip", label: "I'd rather not say" }] });
  q.push(C.bills > 0
    ? { id: "bills", text: `Your bills this month come to ${money(C.bills)}. Is that all of them?`, options: [{ v: "yes", label: "That's all of them" }, { v: "more", label: "There are more", money: true }] }
    : { id: "bills", text: "Do you have bills this month: rent, electricity, phone?", options: [{ v: "more", label: "Yes, about this much", money: true }, { v: "none", label: "None this month" }] });
  if (C.monthsLookedAt > 0) q.push({ id: "basis", text: "Should Koti learn from what you've spent before?", options: [
    { v: "past", label: C.monthsLookedAt === 1 ? "Yes, from last month" : `Yes, from the last ${C.monthsLookedAt} months` }, { v: "fresh", label: "No, start from my answers" }] });
  const monthly = C.savings;
  if (C.goals.length) q.push({ id: "save", text: "How much should go to saving?", options: [
    ...(monthly > 0 ? [{ v: "keep", label: `Keep it at ${money(monthly)} a month` }] : []), { v: "more", label: "Save more" }, { v: "less", label: monthly > 0 ? "Save less" : "Just a little" },
    { v: "amount", label: "This much a month", money: true }, { v: "none", label: "Nothing this month" }] });
  else {
    q.push({ id: "buffer", text: "Do you have money set aside for surprises?", options: [{ v: "enough", label: "Yes, enough" }, { v: "some", label: "A little" }, { v: "no", label: "No" }] });
    q.push({ id: "goal", text: "Would you like to save for something?", free: "What for, like a holiday", options: [{ v: "buffer", label: "A buffer for surprises" }, { v: "thing", label: "Something I'll name" }, { v: "no", label: "Not now" }] });
  }
  q.push({ id: "home", text: "Who lives with you?", options: [{ v: "alone", label: "Just me" }, { v: "partner", label: "Me and a partner" }, { v: "kids", label: "A family with children" }, { v: "shared", label: "A shared flat" }] });
  q.push({ id: "food", text: "How do you eat most days?", options: [{ v: "cook", label: "I cook at home" }, { v: "mix", label: "A mix" }, { v: "out", label: "I eat out often" }] });
  q.push({ id: "move", text: "How do you get around?", options: [{ v: "public", label: "Public transport" }, { v: "car", label: "Car" }, { v: "bike", label: "Bike or on foot" }, { v: "mix", label: "A mix" }] });
  q.push({ id: "big", text: "Anything big coming this month?", free: "What, and about how much", options: [{ v: "no", label: "Nothing big" }, { v: "yes", label: "Yes" }] });
  q.push({ id: "more", text: "Anything else Koti should know?", freeOnly: true, free: "Optional, in your words" });
  q.forEach(x => { if (prev[x.id] && x.options && x.options.some(o => o.v === prev[x.id]) && ["home", "food", "move"].includes(x.id)) x.preset = prev[x.id]; });
  return q;
}
/* Answers that are worth offering first next time: the same next month unless life changed. */
const KEEP = ["home", "food", "move"];

/* The answers, as the planner reads them: the figures they change go into the context (pay, bills, and no history
   when they'd rather start fresh); everything said goes in as words. a: { id: { v, amount, free } }. */
export function planRequest(send, qs, a) {
  const ctx = JSON.parse(JSON.stringify(send)), answers = [];
  const pay = a.pay, bills = a.bills;
  if (pay && pay.v === "other" && pay.amount > 0) ctx.income = pay.amount;
  if (bills && bills.v === "more" && bills.amount > 0) ctx.bills = (send.bills || 0) + bills.amount;
  if (ctx.income > 0 && (ctx.income !== send.income || ctx.bills !== send.bills)) ctx.spendable = Math.round((ctx.income - ctx.bills) * 100) / 100;
  if (a.basis && a.basis.v === "fresh") { ctx.monthsLookedAt = 0; ctx.categories = ctx.categories.map(c => ({ ...c, average: null })); }
  for (const q of qs) {
    const x = a[q.id]; if (!x) continue;
    const o = (q.options || []).find(y => y.v === x.v);
    const said = [o && o.label, o && o.money && x.amount > 0 ? `€${x.amount}` : null, x.free].filter(Boolean).join(": ");
    if (said) answers.push({ question: q.text, answer: said });
  }
  return { context: ctx, answers };
}

export function openBudgetHelp() {
  if (!aiPossible()) { toast(aiOffReason("budget suggestions")); return; }
  const ctx = budgetHelpContext(), C = ctx.raw;
  const prev = store.model.settings.planAnswers || {}, qs = planQuestions(C, prev), A = {};
  let at = 0, req = null;
  qs.forEach(q => { if (q.preset) A[q.id] = { v: q.preset }; });
  openSheet({ title: "Plan my month", left: "Cancel", body: B => {
    const fail = e => { B.innerHTML = `<p class="msg" data-state="error">${esc(e.message || e)}</p><button type="button" class="btn" data-again>Try again</button>`; $("[data-again]", B).onclick = () => (req ? suggest() : ask(0)); };
    /* One question to a screen: the options, a box for your own words, Back and Next. */
    function ask(i) {
      at = i; const q = qs[i], x = A[q.id] || {}, last = i === qs.length - 1;
      const pick = q.options ? q.options.find(o => o.v === x.v) : null;
      B.innerHTML = `<div class="pw">
        <div class="pw-dots" aria-hidden="true">${qs.map((_, k) => `<i class="${k < i ? "done" : k === i ? "on" : ""}"></i>`).join("")}</div>
        <h2 class="pw-q" id="pwQ" tabindex="-1">${esc(q.text)}</h2>
        ${q.options ? `<div class="pw-opts" role="radiogroup" aria-labelledby="pwQ">${q.options.map(o => `<button type="button" class="pw-o" role="radio" data-v="${esc(o.v)}" aria-checked="${o.v === x.v}"><span>${esc(o.label)}</span>${icon("check", "ic sm")}</button>`).join("")}</div>` : ""}
        <label class="pw-money" ${pick && pick.money ? "" : "hidden"}><span aria-hidden="true">€</span><input class="num" id="pwAmt" inputmode="decimal" placeholder="0" value="${x.amount != null ? x.amount : ""}" aria-label="Amount in euros" autocomplete="off"></label>
        <label class="pw-free"><span class="sr">In your own words</span><textarea id="pwFree" rows="${q.freeOnly ? 4 : 2}" maxlength="300" placeholder="${esc(typeof q.free === "string" ? q.free : "Or tell Koti in your own words")}">${esc(x.free || "")}</textarea></label>
        <div class="pw-nav">${i > 0 ? `<button type="button" class="btn pw-back" data-back>Back</button>` : `<span></span>`}<button type="button" class="btn primary pw-next" data-next>${last ? "Plan my month" : "Next"}</button></div>
      </div>`;
      const read = () => { const cur = A[q.id] || {}; const amt = parseMoney($("#pwAmt", B).value); A[q.id] = { ...cur, amount: amt != null && !Number.isNaN(amt) && amt > 0 ? amt : null, free: $("#pwFree", B).value.trim() || null }; };
      const ready = () => { const y = A[q.id] || {}, o = q.options ? q.options.find(z => z.v === y.v) : null;
        $("[data-next]", B).disabled = !q.freeOnly && !y.v && !y.free || !!(o && o.money && !y.amount && !y.free); };
      $$(".pw-o", B).forEach(b => b.onclick = () => {
        read(); A[q.id] = { ...A[q.id], v: b.dataset.v };
        $$(".pw-o", B).forEach(z => z.setAttribute("aria-checked", z === b));
        const o = q.options.find(z => z.v === b.dataset.v), m = $(".pw-money", B); m.hidden = !o.money; if (o.money) $("#pwAmt", B).focus();
        ready();
      });
      B.oninput = () => { read(); ready(); }; B.onchange = null;   // one screen at a time: replaced, not added to
      $("[data-next]", B).onclick = () => { read(); if (last) suggest(); else ask(i + 1); };
      const back = $("[data-back]", B); if (back) back.onclick = () => { read(); ask(i - 1); };
      ready(); const h = $("#pwQ", B); if (h) h.focus({ preventScroll: true });
    }
    async function suggest() {
      B.oninput = null; B.onchange = null;
      const keep = {}; KEEP.forEach(k => { if (A[k] && A[k].v) keep[k] = A[k].v; });
      if (Object.keys(keep).length) store.updateSettings({ planAnswers: { ...prev, ...keep } });
      req = planRequest(ctx.send, qs, A);
      const spendable = req.context.spendable;
      B.innerHTML = aiWait("Planning your month…", spendable != null ? `Sharing ${eur0(spendable)} between saving and spending` : "From your answers");
      let s; try { s = await call({ step: "suggest", context: req.context, answers: req.answers }); } catch (e) { fail(e); return; }
      show(s, spendable);
    }
    function show(s, spendable) {
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
        const room = spendable != null ? spendable : null, total = save + spend;
        $(".bh-total", B).innerHTML = bad ? `<span class="danger">Type each amount as a number.</span>`
          : `Saving <b class="num">${eur0(save)}</b> and spending <b class="num">${eur0(spend)}</b>${room != null ? ` of <b class="num">${eur0(room)}</b> left after bills${total > room ? ` <span class="danger">(${eur0(total - room)} more than you have)</span>` : `, with ${eur0(room - total)} unplanned`}` : ""}.`;
        $("[data-use]", B).disabled = bad;
      };
      B.oninput = paintTotal; B.onchange = paintTotal; paintTotal();
      $("[data-again]", B).onclick = () => { req = null; ask(0); };
      $("[data-use]", B).onclick = () => {
        const r = read(), round = v => Math.round(v * 100) / 100;
        const undo = applyPlan({ budgets: r.budgets.map(x => ({ id: x.id, amount: round(x.amount) })), goals: r.goals.map(x => ({ id: x.id, monthly: round(x.monthly) })), newGoal: r.newGoal && { ...r.newGoal, monthly: round(r.newGoal.monthly) } });
        closeSheet(); toast(r.newGoal || r.goals.length ? "Budgets and savings set" : "Budgets set", { label: "Undo", run: undo });
      };
    }
    ask(0);
  } });
}
