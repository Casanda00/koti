// You → Reminders: what's coming, your own reminders, and Koti's built-in ones (with this phone's switch).
// Your own reminders sync like bills; the send-reminders function sends them at the hour you chose.
import { store, todayISO, REMINDER_WHEN } from "./data.js";
import { $, $$, esc, eur0, icon, parseMoney, moneyField, openSheet, closeSheet, toast } from "./ui.js";
import { nextDue } from "./plan.js";
import { payDateFor, lastWorkingDay } from "./paydays.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hh = h => `${String(h).padStart(2, "0")}:00`;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const at = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const shortDay = d => { const t = new Date(), t0 = iso(t), x = iso(d); return x === t0 ? "Today" : x === iso(addDays(t, 1)) ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); };
const ordinal = n => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

/* The biggest monthly income decides payday, as on Now. */
function mainSource() { return store.model.income.filter(s => s.active && s.frequency !== "once").sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0] || null; }
function paydayIn(y, m) { const s = mainSource(); return s ? payDateFor(s.payDay, y, m) : null; }

/* The next time a reminder of yours will come, or null. */
export function nextTime(r, from = new Date()) {
  if (!r.active || r.when === "amount") return null;   // amount reminders come when the amount is reached
  const fits = d => at(d, r.hour) >= from;
  if (r.when === "once") { if (!r.date) return null; const [y, m, d] = r.date.split("-").map(Number), t = new Date(y, m - 1, d); return fits(t) ? at(t, r.hour) : null; }
  if (r.when === "before") {
    const n = r.beforeDays || 0, cands = [];
    if (r.aboutKind === "bill") { const b = store.model.bills.find(x => x.id === r.aboutId && x.active); if (!b) return null; let due = nextDue(b, from); for (let k = 0; due && k < 3; k++) { cands.push(addDays(due, -n)); due = nextDue(b, addDays(due, 1)); } }
    for (let k = 0; k < 3; k++) {
      const y = from.getFullYear(), m = from.getMonth() + k;
      if (r.aboutKind === "payday") { const p = paydayIn(y, m); if (p) cands.push(addDays(p, -n)); }
      if (r.aboutKind === "monthend") cands.push(addDays(new Date(y, m + 1, 0), -n));
    }
    const ok = cands.filter(fits).sort((a, b) => a - b)[0]; return ok ? at(ok, r.hour) : null;
  }
  for (let k = 0; k < 400; k++) {
    const d = addDays(from, k); if (!fits(d)) continue;
    if (r.when === "weekly" && d.getDay() === r.weekday) return at(d, r.hour);
    if (r.when === "monthly") {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const hit = r.monthDay > 0 ? d.getDate() === Math.min(r.monthDay, last) : r.monthDay === -1 ? iso(d) === iso(lastWorkingDay(d.getFullYear(), d.getMonth())) : (p => p && iso(p) === iso(d))(paydayIn(d.getFullYear(), d.getMonth()));
      if (hit) return at(d, r.hour);
    }
  }
  return null;
}
const aboutName = r => r.aboutKind === "list" ? (store.model.lists.find(l => l.id === r.aboutId) || {}).name : r.aboutKind === "goal" ? (store.model.goals.find(g => g.id === r.aboutId) || {}).name : null;
export function describe(r) {
  const t = ` at ${hh(r.hour)}`, about = aboutName(r);
  if (r.when === "amount") return r.aboutKind === "category" ? `When ${((store.model.categories.find(c => c.id === r.aboutId) || { name: "a category" }).name).toLowerCase()} passes ${eur0(r.amount)} this month` : `When yours to spend falls under ${eur0(r.amount)}`;
  return base(r, t) + (about ? `, for ${about}` : "");
}
function base(r, t) {
  if (r.when === "once") return r.date ? `Once, ${new Date(r.date + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}${t}` : "Once";
  if (r.when === "weekly") return `Every ${DAYS[r.weekday]}${t}`;
  if (r.when === "monthly") return r.monthDay === -1 ? `On the last working day of the month${t}` : r.monthDay === -2 ? `On payday${t}` : `Every month on the ${ordinal(r.monthDay)}${t}`;
  const what = r.aboutKind === "bill" ? `${(store.model.bills.find(b => b.id === r.aboutId) || { name: "a bill" }).name} is due` : r.aboutKind === "payday" ? "payday" : "the month ends";
  return `${r.beforeDays === 0 ? `On the day ${what}` : `${r.beforeDays} day${r.beforeDays === 1 ? "" : "s"} before ${what}`}${t}`;
}

/* Koti's own reminders that will come next (an estimate: the server decides on the day). */
function builtInsComing(from) {
  const R = { bills: true, payday: true, weekly: false, billHour: 9, ...(store.model.settings.reminders || {}) }, out = [];
  if (R.bills) store.model.bills.filter(b => b.active && !b.autopay).forEach(b => { const due = nextDue(b, addDays(from, 1)); if (due) out.push({ when: at(addDays(due, -1), R.billHour), title: `${b.name}, ${eur0((b.dues && b.dues[iso(due)] && b.dues[iso(due)].amount) || b.amount)}, is due tomorrow`, sub: "From Koti" }); });
  if (R.payday) { const s = mainSource(); if (s && s.amount) for (let k = 0; k < 2; k++) { const p = paydayIn(from.getFullYear(), from.getMonth() + k); if (p) out.push({ when: at(addDays(p, 1), R.billHour), title: `Did ${s.name.toLowerCase() === "salary" ? "your salary" : s.name} land?`, sub: "From Koti, if you haven't said yet" }); } }
  if (R.weekly) for (let k = 0; k < 8; k++) { const d = addDays(from, k); if (d.getDay() === 0) { out.push({ when: at(d, 19), title: "Your week", sub: "From Koti" }); break; } }
  return out.filter(x => x.when >= from);
}

let root = null;
export function mountReminders(el) {
  root = el;
  root.addEventListener("click", e => {
    if (e.target.closest("[data-rem-add]")) { openReminder(); return; }
    const sw = e.target.closest("[data-rem-on]"); if (sw) { const r = store.model.reminders.find(x => x.id === sw.dataset.remOn); if (r) { store.put("reminders", { ...r, active: sw.checked }); toast(sw.checked ? "Reminder on" : "Reminder paused"); } return; }
    const row = e.target.closest("[data-rem]"); if (row && !e.target.closest(".switch")) { const r = store.model.reminders.find(x => x.id === row.dataset.rem); if (r) openReminder(r); }
  });
}
export function renderReminders() {
  if (!root) return;
  if (root.contains(document.activeElement) && document.activeElement.matches("input, select")) return;   // don't disturb a change in progress
  const now = new Date(), mine = [...store.model.reminders].sort((a, b) => a.position - b.position);
  const coming = [...mine.map(r => ({ when: nextTime(r, now), title: r.title, sub: describe(r) })).filter(x => x.when), ...builtInsComing(now)].sort((a, b) => a.when - b.when).slice(0, 6);
  root.innerHTML = `<header class="vh"><div><a class="back" href="#settings">${icon("chev", "ic sm flip")} You</a><h1>Reminders</h1></div></header>
    <div class="mhead"><h2>Coming up</h2></div>
    ${coming.length ? `<div class="grp">${coming.map(x => `<div class="row"><span class="rchip"><b>${esc(shortDay(x.when))}</b>${hh(x.when.getHours())}</span><span class="rt">${esc(x.title)}<small>${esc(x.sub)}</small></span></div>`).join("")}</div>` : `<p class="msub">Nothing in the next few weeks.</p>`}
    <div class="mhead"><h2>Yours</h2><button type="button" class="tlink" data-rem-add>Add a reminder</button></div>
    ${mine.length ? `<div class="grp">${mine.map(r => `<div class="row tap" data-rem="${esc(r.id)}" role="button" tabindex="0"><span class="rt">${esc(r.title)}<small>${esc(describe(r))}</small></span><input type="checkbox" class="switch" data-rem-on="${esc(r.id)}" aria-label="${esc(r.title)} on" ${r.active ? "checked" : ""}></div>`).join("")}</div>`
      : `<p class="msub">Anything you'd like Koti to remind you about: a bill a few days early, the big shop every Saturday, moving money on payday.</p><button type="button" class="pill" data-rem-add>Add a reminder</button>`}
    <div id="remKoti"></div>`;
  import("./push.js").then(m => { const el = $("#remKoti", root); if (el) m.renderReminders(el); }).catch(() => {});
}

/* Make or change one of your reminders. */
export function openReminder(r = null, preset = {}) {
  const x = r || { title: "", note: "", when: "monthly", date: todayISO(), monthDay: new Date().getDate(), weekday: 6, beforeDays: 3, aboutKind: store.model.bills.length ? "bill" : "payday", aboutId: (store.model.bills[0] || {}).id || null, hour: 9, active: true, ...preset };
  let when = x.when;
  const opt = (v, t, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? " selected" : ""}>${esc(t)}</option>`;
  openSheet({ title: r ? "Reminder" : "Add a reminder", right: "Save", body: B => {
    B.innerHTML = `
      <div class="field"><label for="rmTitle">Remind me to</label><input class="inp" id="rmTitle" maxlength="120" placeholder="Pay the water bill" value="${esc(x.title)}" autocomplete="off" ${r ? "" : "autofocus"}></div>
      <div class="field"><span class="flabel">When</span><div class="seg" id="rmWhen">${REMINDER_WHEN.map(w => `<button type="button" data-w="${w}" aria-pressed="${w === when}">${{ once: "Once", monthly: "Monthly", weekly: "Weekly", before: "Before", amount: "Amount" }[w]}</button>`).join("")}</div></div>
      <div class="grp">
        <label class="row" data-for="once"><span class="rt">Day</span><input class="inl" type="date" id="rmDate" value="${esc(x.date || todayISO())}"></label>
        <label class="row" data-for="monthly"><span class="rt">On</span><select class="inl" id="rmMonthDay">${opt(-2, "Payday", x.monthDay)}${opt(-1, "Last working day", x.monthDay)}${Array.from({ length: 31 }, (_, k) => opt(k + 1, `The ${ordinal(k + 1)}`, x.monthDay)).join("")}</select></label>
        <label class="row" data-for="weekly"><span class="rt">On</span><select class="inl" id="rmWeekday">${[1, 2, 3, 4, 5, 6, 0].map(d => opt(d, DAYS[d], x.weekday)).join("")}</select></label>
        <label class="row" data-for="before"><span class="rt">How early</span><select class="inl" id="rmBefore">${opt(0, "On the day", x.beforeDays)}${Array.from({ length: 14 }, (_, k) => opt(k + 1, `${k + 1} day${k ? "s" : ""} before`, x.beforeDays)).join("")}</select></label>
        <label class="row" data-for="before"><span class="rt">Before</span><select class="inl" id="rmAbout">${store.model.bills.filter(b => b.active).map(b => opt("bill:" + b.id, `${b.name} is due`, x.aboutKind === "bill" ? "bill:" + x.aboutId : "")).join("")}${opt("payday", "Payday", x.aboutKind)}${opt("monthend", "The end of the month", x.aboutKind)}</select></label>
        <label class="row" data-for="amount"><span class="rt">Tell me when</span><select class="inl" id="rmWatch">${store.model.categories.map(c => opt("category:" + c.id, `${c.name} passes`, x.aboutKind === "category" ? "category:" + x.aboutId : "")).join("")}${opt("left", "Yours to spend falls under", x.aboutKind)}</select></label>
        <label class="row" data-for="amount"><span class="rt">Amount</span><input class="inl" id="rmAmount" inputmode="decimal" placeholder="€100" value="${esc(moneyField(x.amount))}" autocomplete="off"></label>
        <label class="row" data-for="once monthly weekly"><span class="rt">For<small>Opens it from the notification</small></span><select class="inl" id="rmFor">${opt("", "Nothing in particular", "")}${store.model.lists.filter(l => l.kind !== "room").map(l => opt("list:" + l.id, l.name, x.aboutKind === "list" ? "list:" + x.aboutId : "")).join("")}${store.model.goals.map(g => opt("goal:" + g.id, g.name, x.aboutKind === "goal" ? "goal:" + x.aboutId : "")).join("")}</select></label>
        <label class="row" data-for="once monthly weekly before"><span class="rt">At</span><select class="inl" id="rmHour">${Array.from({ length: 24 }, (_, h) => opt(h, hh(h), x.hour)).join("")}</select></label>
        <label class="row"><span class="rt">Note</span><input class="inl" id="rmNote" maxlength="300" placeholder="Optional" value="${esc(x.note || "")}" autocomplete="off" style="max-width:60%"></label>
      </div>
      <p class="note" id="rmNext"></p>
      <p class="msg" id="rmMsg" aria-live="polite"></p>
      ${r ? `<button type="button" class="btn danger" id="rmDel">${icon("trash", "ic sm")} Delete reminder</button>` : ""}`;
    const read = () => readForm(B, x, when);
    const paint = () => { $$("[data-for]", B).forEach(row => { row.hidden = !row.dataset.for.split(" ").includes(when); }); const n = nextTime(read()); $("#rmNext", B).textContent = when === "amount" ? "Sent once a month at most, the first time the amount is reached." : n ? `Next: ${shortDay(n)} at ${hh(n.getHours())}` : "This time has passed."; };
    $("#rmWhen", B).addEventListener("click", e => { const b = e.target.closest("[data-w]"); if (!b) return; when = b.dataset.w; $$("#rmWhen button", B).forEach(y => y.setAttribute("aria-pressed", y === b)); paint(); });
    B.addEventListener("change", paint); paint();
    const del = $("#rmDel", B); if (del) del.onclick = () => { closeSheet(); const copy = { ...r }; store.remove("reminders", r.id); toast("Reminder deleted", { label: "Undo", run: () => store.put("reminders", copy) }); };
  }, onRight: B => {
    const v = readForm(B, x, when);
    const msg = t => { $("#rmMsg", B).textContent = t; $("#rmMsg", B).dataset.state = "error"; };
    if (!v.title) return msg("Say what to remind you about, like “Pay the water bill”.");
    if (v.when === "amount" && !(v.amount > 0)) return msg("Type the amount, like 100.");
    if (v.when === "once" && !nextTime({ ...v, active: true })) return msg("Choose a day and time that hasn't passed.");
    const saved = store.put("reminders", { ...v, id: r ? r.id : undefined, position: r ? r.position : store.model.reminders.length });
    closeSheet(); const n = nextTime(saved);
    toast(n ? `Saved. Next: ${shortDay(n)} at ${hh(n.getHours())}` : "Saved");
  } });
}
/* What the form says, as a reminder. */
function readForm(B, x, when) {
  const pick = id => $(id, B).value, split = v => { const i = v.indexOf(":"); return i < 0 ? [v || null, null] : [v.slice(0, i), v.slice(i + 1)]; };
  const [aboutKind, aboutId] = when === "before" ? split(pick("#rmAbout")) : when === "amount" ? split(pick("#rmWatch")) : split(pick("#rmFor"));
  return { ...x, title: pick("#rmTitle").trim(), note: pick("#rmNote").trim() || null, when, date: pick("#rmDate") || null, monthDay: Number(pick("#rmMonthDay")), weekday: Number(pick("#rmWeekday")),
    beforeDays: Number(pick("#rmBefore")), aboutKind, aboutId, amount: when === "amount" ? parseMoney(pick("#rmAmount")) : null, hour: Number(pick("#rmHour")), active: x.active !== false };
}
