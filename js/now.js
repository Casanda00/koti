// Now: what's yours to spend until payday, in one number on a colour that says how the month is going,
// then at most two questions Koti needs answered and a few plain sentences about what's next.
import { store, todayISO, BILLS_CAT } from "./data.js";
import { $, esc, eur, eur0, icon, parseDay, openSheet, closeSheet, toast } from "./ui.js";
import { periodFor, totals, catName, openStartBalance, openCheckBank } from "./money.js";
import { setSpendingFilter } from "./spent.js";
import { monthLedger, startPoint, effectiveBudgets, awaitingIncome } from "./ledger.js";
import { occurrences, markPaid, setSkipped, awaitingDebit, setFailed } from "./plan.js";
import { nextPay, receive } from "./income.js";
import { wantsStrip, stripHTML } from "./install.js";
import { dayShare, openPayments } from "./receipt.js";
import { rangeOf, spentBetween } from "./spent.js";

const longDay = d => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const money = v => (v < 0 ? "−" : "") + eur0(Math.abs(v));
const snoozeKey = "koti.notYet";
function snoozed() { try { return JSON.parse(localStorage.getItem(snoozeKey) || "{}"); } catch { return {}; } }
function snooze(k) { try { const s = snoozed(); s[k] = todayISO(); localStorage.setItem(snoozeKey, JSON.stringify(s)); } catch {} }
const isSnoozed = k => snoozed()[k] === todayISO();
const sourceName = src => src.name.toLowerCase() === "salary" ? "your salary" : `the ${src.name.toLowerCase()} money`;

/* How the month is going: over (spent more than there is), tight (a bill is late, or each day has much less
   than your budgets plan for a day), or calm. */
export function moodOf(L, perDay, p) {
  if (!L || L.kind !== "current") return "calm";
  if (L.left < 0) return "over";
  if (L.overdue.length) return "tight";
  const days = Math.round((p.end - p.start) / 864e5) + 1, planned = effectiveBudgets(p).total / days;
  return perDay < (planned > 0 ? planned * 0.6 : 10) ? "tight" : "calm";
}
/* What Now shows, saved with your settings so reminders can use the same numbers ("Money's tight", "Pays itself",
   "yours to spend falls under"). The server only trusts it while it's fresh; it changes only when the numbers do. */
function saveSnapshot(snap) {
  const old = store.model.settings.snapshot || {};
  if (["left", "now", "mood", "day", "period", "leftToday"].some(k => old[k] !== snap[k])) store.updateSettings({ snapshot: { ...snap, at: new Date().toISOString() } });
}
export function isSetUp() { return startPoint().set || store.model.income.length > 0; }

let root = null;
export function mountNow(el) {
  root = el;
  root.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-how]")) { openPayments("today"); return; }
    if (t.closest("[data-start-setup]")) { import("./onboarding.js").then(m => m.openOnboarding()); return; }
    if (t.closest("[data-bal]")) { openStartBalance(); return; }
    const got = t.closest("[data-got]"); if (got) { const src = store.model.income.find(x => x.id === got.dataset.got); if (src) { const tx = receive({ src, due: got.dataset.due }, src.amount); toast(`Added ${eur(tx.amount)} from ${src.name}`, { label: "Undo", run: () => store.remove("transactions", tx.id) }); } return; }
    const ny = t.closest("[data-notyet]"); if (ny) { snooze(ny.dataset.notyet); renderNow(); return; }
    const pd = t.closest("[data-paid]"); if (pd) { const o = findOverdue(pd.dataset.paid, pd.dataset.due); if (o) { const tx = markPaid(o, todayISO(), true); toast(`${o.bill.name} marked paid`, { label: "Undo", run: () => store.remove("transactions", tx.id) }); } return; }
    const db = t.closest("[data-debit]"); if (db) { const o = findOverdue(db.dataset.debit, db.dataset.due); if (o) { const tx = markPaid(o, o.due); toast(`${o.bill.name} went out`, { label: "Undo", run: () => store.remove("transactions", tx.id) }); } return; }
    const fl = t.closest("[data-failed]"); if (fl) { const o = findOverdue(fl.dataset.failed, fl.dataset.due); if (o) { setFailed(o, true); toast(`${o.bill.name} is still to pay`, { label: "Undo", run: () => setFailed(o, false) }); } return; }
    const no = t.closest("[data-notowed]"); if (no) { const o = findOverdue(no.dataset.notowed, no.dataset.due); if (o) { setSkipped(o, true); toast(`${o.bill.name} skipped this month`, { label: "Undo", run: () => setSkipped(o, false) }); } return; }
    const tr = t.closest("[data-tx]"); if (tr) { const x = store.model.transactions.find(y => y.id === tr.dataset.tx); if (x) import("./money.js").then(m => m.openExpense({ tx: x })); return; }
    const ti = t.closest("[data-item]"); if (ti) { import("./setup.js").then(m => { const it = store.model.items.find(i => i.id === ti.dataset.item); if (it) m.openItem(it); }); return; }
    const cat = t.closest("[data-catgo]"); if (cat) { setSpendingFilter(cat.dataset.catgo); location.hash = "#spending"; }
  });
}
function findOverdue(id, due) { const L = monthLedger(periodFor(new Date())); return [...(L.overdue || []), ...(L.dueThisMonth || [])].find(o => o.bill.id === id && o.due === due); }

export function renderNow() {
  if (!root) return;
  const p = periodFor(new Date()), L = monthLedger(p), pd = nextPay(), today = todayISO();
  const days = pd ? Math.max(1, pd.days) : null, perDay = days && L.left > 0 ? L.left / days : 0;
  document.body.dataset.mood = isSetUp() ? moodOf(L, perDay, p) : "calm";

  if (!isSetUp()) {
    root.innerHTML = `<section class="now-top">
      <p class="now-k">Welcome to Koti</p>
      <h1 class="now-big now-hi">Let's set up your month</h1>
      <p class="now-s">Three questions: your pay, your bills and your bank.</p>
      <button type="button" class="now-btn" data-start-setup>Start</button>
    </section>
    <section class="now-sheet"><p class="now-line">Setting up a new home? Go to <a href="#projects">Projects</a>.</p></section>`;
    return;
  }

  // Today's share and what's left of it
  const D = dayShare(), todayLeft = D && D.left != null ? D.left : null;
  if (todayLeft != null && L.left >= 0) document.body.dataset.mood = todayLeft < 0 ? "over" : D.share > 0 && todayLeft < D.share * 0.25 ? "tight" : (L.overdue || []).length ? "tight" : "calm";
  const big = todayLeft != null ? todayLeft : L.left;
  if (L.kind === "current") saveSnapshot({ left: Math.round(L.left), now: Math.round(L.now), perDay: Math.round(perDay), days, mood: document.body.dataset.mood, day: today, period: p.from, share: D && D.share != null ? Math.round(D.share) : null, leftToday: todayLeft != null ? Math.round(todayLeft) : null });

  // Questions: income that should have landed, a bill that's late, a balance never set. Two at most.
  const qs = [];
  awaitingIncome().filter(o => !isSnoozed(`inc:${o.src.id}:${o.due}`)).slice(0, 2).forEach(o => qs.push(`<div class="ask2"><p>Did ${esc(sourceName(o.src))}, ${eur0(o.src.amount)}, arrive?</p><div class="btns"><button type="button" class="pill" data-got="${esc(o.src.id)}" data-due="${o.due}">Yes</button><button type="button" class="pill ghost" data-notyet="inc:${esc(o.src.id)}:${o.due}">Not yet</button></div></div>`));
  const lateBills = [...(L.overdue || []), ...(L.dueThisMonth || []).filter(o => o.due < today || awaitingDebit(o))];
  lateBills.filter(o => !isSnoozed(`bill:${o.bill.id}:${o.due}`)).slice(0, 2).forEach(o => qs.push(awaitingDebit(o)
    ? `<div class="ask2"><p>Did ${esc(o.bill.name.toLowerCase())}, ${eur0(o.amount)}, go out?</p><div class="btns"><button type="button" class="pill" data-debit="${esc(o.bill.id)}" data-due="${o.due}">It went out</button><button type="button" class="pill ghost" data-failed="${esc(o.bill.id)}" data-due="${o.due}">It didn't</button></div></div>`
    : `<div class="ask2"><p>Did you pay ${esc(o.bill.name.toLowerCase())}, ${eur0(o.amount)}?</p><div class="btns"><button type="button" class="pill" data-paid="${esc(o.bill.id)}" data-due="${o.due}">Paid</button><button type="button" class="pill ghost" data-notowed="${esc(o.bill.id)}" data-due="${o.due}">Not owed</button></div></div>`));
  if (!startPoint().set) qs.push(`<div class="ask2"><p>How much is in your bank account?</p><div class="btns"><button type="button" class="pill" data-bal>Add it</button></div></div>`);

  // Spent today, then bills due today or tomorrow
  const tx = (D ? D.entries : []).slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const soon = occurrences(p).filter(o => !o.paid && !o.skipped && (o.due === today || o.due === tomorrow));
  const wk = rangeOf("week"), week = spentBetween(wk.from, wk.to).total;
  const rowTx = t => `<button type="button" class="trow" ${t.fromProject ? `data-item="${esc(t.itemId)}"` : `data-tx="${esc(t.id)}"`}><span>${esc(t.payee || catName(t.categoryId))}${t.payee ? `<small>${esc(catName(t.categoryId))}</small>` : ""}</span><b class="num">${t.kind === "refund" ? "+" : ""}${eur(t.amount)}</b></button>`;
  const rowBill = o => `<a class="trow" href="#bills"><span>${esc(o.bill.name)}<small>${o.due === today ? "Due today" : "Due tomorrow"}</small></span><b class="num">${eur(o.amount)}</b></a>`;

  root.innerHTML = `${wantsStrip() ? stripHTML() : ""}<section class="now-top">
      <p class="now-k">${big < 0 ? "Over today" : "Left to spend today"}</p>
      <div class="now-big num" style="--n:${money(big).length}">${money(big)}</div>
      ${D && D.share != null ? `<p class="now-s">You have spent ${eur0(D.spent)} of ${eur0(D.share)}</p>` : ""}
      <p class="now-pd">${L.left < 0 ? `${eur0(-L.left)} over until payday` : `${eur0(L.left)} left until payday`}</p>
    </section>
    <section class="now-sheet">
      ${qs.slice(0, 2).join("")}
      <div class="tlist"><div class="tl-h"><button type="button" class="tl-t" data-how>Today's payments ${icon("chev", "ic xs")}</button><a href="#spending/week">This week ${eur0(week)}</a></div>
        ${tx.map(rowTx).join("") || `<p class="tl-none">Nothing yet.</p>`}
        ${soon.map(rowBill).join("")}
      </div>
    </section>`;
}
