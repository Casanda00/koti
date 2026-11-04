// Now: what's yours to spend until payday, in one number on a colour that says how the month is going,
// then at most two questions Koti needs answered and a few plain sentences about what's next.
import { store, todayISO, BILLS_CAT } from "./data.js";
import { $, esc, eur, eur0, parseDay, openSheet, closeSheet, toast } from "./ui.js";
import { periodFor, totals, catName, openStartBalance, openCheckBank } from "./money.js";
import { setSpendingFilter, quickHTML } from "./spent.js";
import { monthLedger, startPoint, effectiveBudgets, awaitingIncome } from "./ledger.js";
import { occurrences, markPaid, setSkipped } from "./plan.js";
import { nextPay, receive } from "./income.js";
import { wantsStrip, stripHTML } from "./install.js";

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
  if (["left", "now", "mood", "day", "period"].some(k => old[k] !== snap[k])) store.updateSettings({ snapshot: { ...snap, at: new Date().toISOString() } });
}
export function isSetUp() { return startPoint().set || store.model.income.length > 0; }

let root = null;
export function mountNow(el) {
  root = el;
  root.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-how]")) { openHow(); return; }
    if (t.closest("[data-start-setup]")) { import("./onboarding.js").then(m => m.openOnboarding()); return; }
    if (t.closest("[data-bal]")) { openStartBalance(); return; }
    const got = t.closest("[data-got]"); if (got) { const src = store.model.income.find(x => x.id === got.dataset.got); if (src) { const tx = receive({ src, due: got.dataset.due }, src.amount); toast(`Added ${eur(tx.amount)} from ${src.name}`, { label: "Undo", run: () => store.remove("transactions", tx.id) }); } return; }
    const ny = t.closest("[data-notyet]"); if (ny) { snooze(ny.dataset.notyet); renderNow(); return; }
    const pd = t.closest("[data-paid]"); if (pd) { const o = findOverdue(pd.dataset.paid, pd.dataset.due); if (o) { const tx = markPaid(o, todayISO(), true); toast(`${o.bill.name} marked paid`, { label: "Undo", run: () => store.remove("transactions", tx.id) }); } return; }
    const no = t.closest("[data-notowed]"); if (no) { const o = findOverdue(no.dataset.notowed, no.dataset.due); if (o) { setSkipped(o, true); toast(`${o.bill.name} skipped this month`, { label: "Undo", run: () => setSkipped(o, false) }); } return; }
    const cat = t.closest("[data-catgo]"); if (cat) { setSpendingFilter(cat.dataset.catgo); location.hash = "#spending"; }
  });
}
function findOverdue(id, due) { const L = monthLedger(periodFor(new Date())); return [...(L.overdue || []), ...(L.dueThisMonth || [])].find(o => o.bill.id === id && o.due === due); }

export function renderNow() {
  if (!root) return;
  const p = periodFor(new Date()), L = monthLedger(p), pd = nextPay(), today = todayISO();
  const days = pd ? Math.max(1, pd.days) : null, perDay = days && L.left > 0 ? L.left / days : 0;
  document.body.dataset.mood = isSetUp() ? moodOf(L, perDay, p) : "calm";
  if (isSetUp() && L.kind === "current") saveSnapshot({ left: Math.round(L.left), now: Math.round(L.now), perDay: Math.round(perDay), days, mood: document.body.dataset.mood, day: today, period: p.from });

  if (!isSetUp()) {
    root.innerHTML = `<section class="now-top">
      <p class="now-k">Welcome to Koti</p>
      <h1 class="now-big now-hi">Let's set up your month</h1>
      <p class="now-s">Three quick questions about your pay, your bills and your bank. Then Koti tells you what's yours to spend each day.</p>
      <button type="button" class="now-btn" data-start-setup>Start</button>
    </section>
    <section class="now-sheet"><p class="now-line">Here to set up your new home? Your lists and the floor plan are under <a href="#home">Home</a>.</p></section>`;
    return;
  }

  const when = pd ? (pd.days === 0 ? "Pay lands today." : `Pay lands ${longDay(pd.date)}.`) : "";
  const sub = L.left < 0 ? `You're ${eur0(-L.left)} over until payday. ${when}` : perDay ? `About ${eur0(perDay)} a day for ${days} day${days === 1 ? "" : "s"}. ${when}` : when;

  // Questions: income that should have landed, a bill that's late, a balance never set. Two at most.
  const qs = [];
  awaitingIncome().filter(o => !isSnoozed(`inc:${o.src.id}:${o.due}`)).slice(0, 2).forEach(o => qs.push(`<div class="ask2"><p>Did ${esc(sourceName(o.src))}, ${eur0(o.src.amount)}, land?</p><div class="btns"><button type="button" class="pill" data-got="${esc(o.src.id)}" data-due="${o.due}">It landed</button><button type="button" class="pill ghost" data-notyet="inc:${esc(o.src.id)}:${o.due}">Not yet</button></div></div>`));
  (L.overdue || []).filter(o => !isSnoozed(`bill:${o.bill.id}:${o.due}`)).slice(0, 2).forEach(o => qs.push(`<div class="ask2"><p>Did you pay ${esc(o.bill.name.toLowerCase())}? ${eur0(o.amount)} was due ${longDay(parseDay(o.due))}.</p><div class="btns"><button type="button" class="pill" data-paid="${esc(o.bill.id)}" data-due="${o.due}">I paid it</button><button type="button" class="pill ghost" data-notowed="${esc(o.bill.id)}" data-due="${o.due}">Not owed this time</button></div></div>`));
  if (!startPoint().set) qs.push(`<div class="ask2"><p>What does your bank say right now? Koti is counting from €0 until you tell it.</p><div class="btns"><button type="button" class="pill" data-bal>Tell Koti</button></div></div>`);

  // Sentences: bills, budgets that are nearly used up, pay on its way.
  const lines = [];
  const occ = occurrences(p), paidNow = occ.filter(o => o.paid).sort((a, b) => b.due.localeCompare(a.due))[0];
  const next = occ.find(o => !o.paid && !o.skipped && o.due >= today);
  if (next) lines.push(`${paidNow ? `${esc(paidNow.bill.name)} is paid. ` : ""}Next is <a href="#bills">${esc(next.bill.name.toLowerCase())}, ${eur0(next.amount)}</a> on ${longDay(parseDay(next.due))}${next.bill.autopay ? ", and it pays itself" : ""}.`);
  else if (occ.length) lines.push(`All of this month's bills are paid. Nothing else goes out before your pay.`);
  const T = totals(p), eb = effectiveBudgets(p);
  store.model.categories.filter(c => eb.byId[c.id] > 0 && c.id !== BILLS_CAT).map(c => ({ c, b: eb.byId[c.id], s: T.byCat[c.id] || 0 })).filter(x => x.s >= x.b * 0.85)
    .sort((a, b) => (b.s / b.b) - (a.s / a.b)).slice(0, 2)
    .forEach(({ c, b, s }) => lines.push(`<span class="dot ${s > b ? "over" : "low"}" aria-hidden="true"></span><span><button type="button" class="tlink" data-catgo="${esc(c.id)}">${esc(c.name)}</button> ${s > b ? `is ${eur0(s - b)} over.` : `is nearly used up. ${eur0(b - s)} to go.`}</span>`));
  (L.expected || []).slice(0, 1).forEach(o => lines.push(`${esc(o.src.name)}, ${eur0(o.src.amount)}, is on its way. It counts once it lands.`));

  root.innerHTML = `${wantsStrip() ? stripHTML() : ""}<section class="now-top">
      <p class="now-k">${L.left < 0 ? "Over until payday" : "Yours to spend until payday"}</p>
      <div class="now-big num" style="--n:${money(L.left).length}">${money(L.left)}</div>
      <p class="now-s">${esc(sub)}</p>
      <button type="button" class="now-how" data-how>How we got there</button>
    </section>
    <section class="now-sheet">
      ${quickHTML()}
      ${qs.slice(0, 2).join("")}
      ${qs.length && lines.length ? `<hr class="now-hr">` : ""}
      ${lines.map(l => `<p class="now-line${l.startsWith('<span class="dot') ? " has-dot" : ""}">${l}</p>`).join("") || (qs.length ? "" : `<p class="now-line">Nothing needs you today.</p>`)}
    </section>`;
}

/* How we got there: the sum, printed like a receipt. */
function openHow() {
  const L = monthLedger(periodFor(new Date()));
  const dueList = [...(L.overdue || []), ...(L.dueThisMonth || [])];
  const names = dueList.map(o => o.bill.name);
  openSheet({ title: "How we got there", left: "Close", body: `
    <div class="receipt num">
      <p class="rc-d">${esc(longDay(new Date()))}</p>
      <div class="rc-r"><span>In your account</span><b>${money(L.now)}</b></div>
      <div class="rc-r"><span>Bills still to come</span><b>${dueList.length ? "−" + eur0(L.due) : "€0"}</b></div>
      ${names.length ? `<p class="rc-n">${esc(names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0])}</p>` : ""}
      <div class="rc-r rc-t"><span>Yours to spend</span><b>${money(L.left)}</b></div>
      ${(L.expected || []).length ? `<p class="rc-f">${esc(L.expected.map(o => `${o.src.name} ${eur0(o.src.amount)}`).join(", "))} isn't in here yet. It counts once you say it landed.</p>` : ""}
      ${!startPoint().set ? `<p class="rc-f">Koti is counting from €0 because it doesn't know your bank balance yet.</p>` : ""}
    </div>
    <p class="now-q">Not the number your bank shows?</p>
    <button type="button" class="btn primary" id="howBank">Match it to my bank</button>`, });
  setTimeout(() => { const b = $("#howBank"); if (b) b.onclick = () => { closeSheet(); setTimeout(openCheckBank, 260); }; }, 30);
}
