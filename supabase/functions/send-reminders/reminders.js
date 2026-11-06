// Koti reminders: what to tell one person this hour. Plain JavaScript, so the tests run it in Node and the
// send-reminders function runs it in Deno. Every money figure comes from engine.js, a byte-for-byte copy of
// js/engine.js (tests/reminders.test.mjs fails if they differ), so a reminder and the app never disagree.
// Each person's "today" and hour are in their phone's time zone (settings.tz), Helsinki when it isn't known.
import * as E from "./engine.js";

export const HELSINKI = "Europe/Helsinki";
/* The day, hour and weekday in a time zone. */
export function local(d = new Date(), tz = HELSINKI) {
  let p;
  try { p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map(x => [x.type, x.value])); }
  catch { return local(d, HELSINKI); }
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}
const money = (lang, c) => { const n = c / 100; return new Intl.NumberFormat(lang === "fi" ? "fi-FI" : "en-FI", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n); };
const longDay = (lang, s) => new Date(s + "T12:00:00Z").toLocaleDateString(lang === "fi" ? "fi-FI" : "en-GB", lang === "fi" ? { weekday: "long", day: "numeric", month: "numeric", timeZone: "UTC" } : { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const stop = x => x.endsWith(".") ? x : x + ".";   // a Finnish date already ends with a full stop
const list = (lang, xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${lang === "fi" ? "ja" : "and"} ${xs[xs.length - 1]}`;
const more = (lang, xs, keep) => xs.length > keep + 1 ? [...xs.slice(0, keep), lang === "fi" ? `${xs.length - keep} muuta` : `${xs.length - keep} more`] : xs;
/* Late bills are mentioned on day 1, day 4, then once a week, for up to 60 days. */
export const lateDays = late => late === 1 || late === 4 || (late > 4 && late <= 60 && (late - 4) % 7 === 0);
export const DAILY_LIMIT = 3;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* The words, in Koti 2.0's voice. */
export const W = {
  en: {
    due: (n, a) => `${n}, ${a}, is due tomorrow.`,
    dueRef: (r) => `Reference ${r} is ready to copy in Koti.`,
    dueBody: "Mark it paid in Koti when it's done.",
    late: (n, a, d) => `${n}, ${a}, was due ${d}.`,
    lateBody: "Mark it paid, or not owed this time.",
    pay: (n, a) => `Did ${n}, ${a}, land?`,
    payName: (n) => String(n).toLowerCase() === "salary" ? "your salary" : `the ${n} money`,
    payBody: (d) => `It was due ${d}. Tell Koti when it's in.`,
    over: (c, a) => `${c} is ${a} over this month.`,
    low: (c, a) => `${c} is nearly used up. ${a} to go.`,
    budBody: (p, b) => `You've used ${p}% of this month's ${b}.`,
    week: "Your week",
    weekBody: (a, next) => `${a} spent this week. ${next ? `Next week: ${next}.` : "No bills next week."}`,
    testT: "Koti reminders are on", testB: "Bills, paydays and budgets will reach you like this.",
    paid: "Paid", notYet: "Not yet", iPaid: "I paid it", notOwed: "Not owed", landed: "It landed", done: "Done", tomorrow: "Tomorrow",
    dueIn: (n, a, d) => d === 0 ? `${n}, ${a}, is due today.` : `${n}, ${a}, is due in ${d} day${d === 1 ? "" : "s"}.`,
    payIn: (d) => d === 0 ? "Payday is today." : `Payday is in ${d} day${d === 1 ? "" : "s"}.`,
    endIn: (d) => d === 0 ? "The month ends today." : `The month ends in ${d} day${d === 1 ? "" : "s"}.`,
    tight: (a, d, pd) => `${a} is yours to spend for ${d} day${d === 1 ? "" : "s"}. About ${pd} a day.`,
    overNow: (a) => `You're ${a} over until payday.`,
    autoT: (n, a) => `${n}, ${a}, comes out tomorrow.`, autoB: (a) => `You have ${a} in your account.`,
    planT: "Your pay landed", planB: "Take a minute to plan the month in Koti.",
    listAdded: (items, many, l) => `${items.charAt(0).toUpperCase() + items.slice(1)} ${many ? "were" : "was"} added to ${l}.`, listBody: "Through your shared link.",
    catPassed: (c, sp, a) => `${c} is at ${sp} this month, past your ${a}.`,
    leftUnder: (a) => `${a} is yours to spend until payday.`,
    bundle: (n) => `${n} things today`,
    daily: "Today's payments",
    dailyBody: (items, total, n) => n > 1 ? `${items.charAt(0).toUpperCase() + items.slice(1)}. ${total} in total.` : `${items.charAt(0).toUpperCase() + items.slice(1)}.`,
  },
  fi: {
    due: (n, a) => `${n}, ${a}, erääntyy huomenna.`,
    dueRef: (r) => `Viite ${r} on valmiina kopioitavaksi Kotissa.`,
    dueBody: "Merkitse se maksetuksi Kotissa, kun olet maksanut.",
    late: (n, a, d) => `${n}, ${a}, erääntyi ${stop(d)}`,
    lateBody: "Merkitse se maksetuksi, tai ettei sitä tarvitse maksaa tällä kertaa.",
    pay: (n, a) => `Tuliko ${n}, ${a}?`,
    payName: (n) => String(n).toLowerCase() === "salary" ? "palkkasi" : n,
    payBody: (d) => `Sen piti tulla ${stop(d)} Kerro Kotille, kun se on tilillä.`,
    over: (c, a) => `${c}: ${a} yli tämän kuun budjetin.`,
    low: (c, a) => `${c} on melkein käytetty. ${a} jäljellä.`,
    budBody: (p, b) => `Tämän kuun ${b}:n budjetista on käytetty ${p} %.`,
    week: "Viikkosi",
    weekBody: (a, next) => `${a} kulutettu tällä viikolla. ${next ? `Ensi viikolla: ${next}.` : "Ensi viikolla ei laskuja."}`,
    testT: "Kotin muistutukset ovat päällä", testB: "Laskut, palkkapäivät ja budjetit tulevat näin.",
    paid: "Maksettu", notYet: "Ei vielä", iPaid: "Maksoin", notOwed: "Ei tarvitse", landed: "Tuli", done: "Tehty", tomorrow: "Huomenna",
    dueIn: (n, a, d) => d === 0 ? `${n}, ${a}, erääntyy tänään.` : `${n}, ${a}, erääntyy ${d} päivän päästä.`,
    payIn: (d) => d === 0 ? "Tänään on palkkapäivä." : `Palkkapäivään on ${d} päivää.`,
    endIn: (d) => d === 0 ? "Kuukausi loppuu tänään." : `Kuukausi loppuu ${d} päivän päästä.`,
    tight: (a, d, pd) => `${a} käytettävissä ${d} päiväksi. Noin ${pd} päivässä.`,
    overNow: (a) => `Olet ${a} miinuksella palkkapäivään asti.`,
    autoT: (n, a) => `${n}, ${a}, veloitetaan huomenna.`, autoB: (a) => `Tililläsi on ${a}.`,
    planT: "Palkka tuli", planB: "Käy kuukauden suunnitelma läpi Kotissa.",
    listAdded: (items, _many, l) => `${l}: lisätty ${items}.`, listBody: "Jaetun linkin kautta.",
    catPassed: (c, sp, a) => `${c}: ${sp} tässä kuussa, yli rajasi ${a}.`,
    leftUnder: (a) => `${a} käytettävissä palkkapäivään asti.`,
    bundle: (n) => `${n} asiaa tänään`,
    daily: "Tämän päivän maksut",
    dailyBody: (items, total, n) => n > 1 ? `${items.charAt(0).toUpperCase() + items.slice(1)}. Yhteensä ${total}.` : `${items.charAt(0).toUpperCase() + items.slice(1)}.`,
  },
};
export const langOf = settings => String(settings.voiceLang || "").toLowerCase().startsWith("fi") ? "fi" : "en";

/* ---------- Database rows → the app's model (the same mapping as js/sync.js) ---------- */
export function modelOf({ settings = {}, bills = [], tx = [], income = [], cats = [], goals = [], lists = [], items = [] }) {
  return {
    settings,
    bills: bills.map(r => ({ id: r.id, name: r.name, amount: Number(r.amount), frequency: r.frequency, dueDay: r.due_day, anchorMonth: r.anchor_month, autopay: !!r.autopay, active: r.active !== false,
      dueDate: r.due_date || null, startDate: r.start_date || null, endDate: r.end_date || null, reference: r.reference || null, dues: r.dues || {} })),
    transactions: tx.map(r => ({ id: r.id, date: r.date, amount: Number(r.amount), kind: r.kind, categoryId: r.category_id, payee: r.payee, billId: r.bill_id || null, billDue: r.bill_due || null,
      incomeId: r.income_id || null, incomeDue: r.income_due || null, fromPay: r.from_pay || null, lines: Array.isArray(r.lines) ? r.lines : null, updatedAt: r.updated_at })),
    income: income.map(r => ({ id: r.id, name: r.name, amount: r.amount == null ? null : Number(r.amount), frequency: r.frequency, payDay: r.pay_day, expectedDate: r.expected_date, active: r.active !== false,
      endDate: r.end_date || null, missed: Array.isArray(r.missed) ? r.missed : [] })),
    categories: cats.map(r => ({ id: r.id, name: r.name, budget: r.budget == null ? null : Number(r.budget) })),
    goals: goals.map(r => ({ id: r.id, name: r.name, target: Number(r.target), saved: Number(r.saved), monthly: r.monthly == null ? null : Number(r.monthly) })),
    lists: lists.map(r => ({ id: r.id, name: r.name, kind: r.kind || "room", parentId: r.parent_id || null })),
    items: items.map(r => ({ id: r.id, listId: r.list_id, name: r.name, done: !!r.done, price: r.price == null ? null : Number(r.price), boughtAt: r.bought_at })),
  };
}

/* ---------- Dates the engine gives ---------- */
const ym = day => ({ y: +day.slice(0, 4), m: +day.slice(5, 7) - 1 });
function billDuesAround(b, today, back, ahead) {
  const { y, m } = ym(today), out = [];
  for (let k = -back; k <= ahead; k++) { const d = E.billDue(b, y, m + k); if (d) out.push(d); }
  return out;
}
const mainSource = model => model.income.filter(s => s.active && s.frequency !== "once").sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
const mainPayDue = (model, y, m) => { const s = mainSource(model); return s ? E.payDate(s.payDay, y, m) : null; };
const owed = (model, b, due) => { const o = E.billOccurrence(model, b, due); return !o.paid && !o.skipped ? o : null; };

/* ---------- Your own reminders, at the hour you chose, quiet hours or not ---------- */
export function customFor(model, reminders, again, now) {
  const out = [], today = now.day, lang = langOf(model.settings), w = W[lang], eur = c => money(lang, c);
  const { y, m } = ym(today), d = +today.slice(8, 10), last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (const r of reminders || []) {
    if (!r.active || r.deleted || Number(r.hour) !== now.hour) continue;
    let hit = !!again && again.has(`again:cr:${r.id}:${today}`), body = r.note || "", answerTo = { k: "cr", id: r.id, due: today }, bill = false;
    if (r.schedule === "once") hit = hit || r.on_date === today;
    if (r.schedule === "weekly") hit = hit || WD[Number(r.weekday)] === now.weekday;
    if (r.schedule === "monthly") {
      const md = Number(r.month_day);
      hit = hit || (md > 0 ? d === Math.min(md, last) : md === -1 ? today === E.payDate(E.LAST_WORKING_DAY, y, m) : mainPayDue(model, y, m) === today);
    }
    if (r.schedule === "before") {
      const n = Number(r.before_days) || 0;
      if (r.about_kind === "bill") {
        const b = model.bills.find(x => x.id === r.about_id && x.active);
        const due = b && billDuesAround(b, today, 0, 2).find(x => E.addDays(x, -n) === today && owed(model, b, x));
        if (b && due) { hit = true; bill = true; body = body || w.dueIn(b.name, eur(E.billOccurrence(model, b, due).amount), n); answerTo = { k: "bill", id: b.id, due }; }
      } else if (r.about_kind === "payday") {
        if ([0, 1].map(k => mainPayDue(model, y, m + k)).find(x => x && E.addDays(x, -n) === today)) { hit = true; body = body || w.payIn(n); }
      } else if (r.about_kind === "monthend") {
        if ([E.ymd(y, m + 1, 0), E.ymd(y, m + 2, 0)].find(x => E.addDays(x, -n) === today)) { hit = true; body = body || w.endIn(n); }
      }
    }
    if (!hit) continue;
    const url = bill ? "./#bills" : r.about_kind === "list" && r.about_id ? `./#list/${encodeURIComponent(r.about_id)}` : r.about_kind === "goal" ? "./#budgets" : "./#reminders";
    out.push({ key: `cr:${r.id}:${today}`, title: r.title, body, url, answer: answerTo,
      actions: bill ? [{ action: "paid", title: w.paid }, { action: "later", title: w.notYet }] : [{ action: "done", title: w.done }, { action: "later", title: w.tomorrow }] });
  }
  return out;
}

/* ---------- Everything to tell one person this hour ---------- */
export function remindersFor(model, { reminders = [], again = new Set(), events = [] } = {}, now) {
  const S = model.settings;
  const R = { bills: true, overdue: true, payday: true, budget: true, weekly: false, tight: true, autopay: false, plan: false, lists: true, daily: true, dailyHour: 20, quietFrom: 21, quietTo: 8, billHour: 9, ...(S.reminders || {}) };
  const quiet = R.quietFrom > R.quietTo ? (now.hour >= R.quietFrom || now.hour < R.quietTo) : (now.hour >= R.quietFrom && now.hour < R.quietTo);
  const mine = R.custom === false ? [] : customFor(model, reminders, again, now);
  if (quiet) return mine;
  const out = [...mine], today = now.day, tomorrow = E.addDays(today, 1), morning = now.hour === Number(R.billHour);
  const start = S.startDate || null, lang = langOf(S), w = W[lang], eur = c => money(lang, c);
  const P = E.periodOf(today, E.monthStart(model));

  for (const b of model.bills) {
    if (!b.active) continue;
    for (const due of billDuesAround(b, today, 2, 1)) {
      const o = owed(model, b, due); if (!o) continue;
      const ref = (b.dues && b.dues[due] && b.dues[due].reference) || b.reference;
      if (R.bills && morning && due === tomorrow && !b.autopay) out.push({ key: `due:${b.id}:${due}`, title: w.due(b.name, eur(o.amount)), body: ref ? w.dueRef(ref) : w.dueBody, url: "./#bills",
        actions: [{ action: "paid", title: w.paid }, { action: "later", title: w.notYet }], answer: { k: "bill", id: b.id, due } });
      // A direct debit is reminded about only once you've said it didn't go out.
      if (R.overdue && morning && due < today && (!b.autopay || o.failed) && (!start || due >= start) && (b.startDate ? due >= b.startDate : true)) {
        if (lateDays(E.daysBetween(due, today))) out.push({ key: `od:${b.id}:${due}:${today}`, title: w.late(b.name, eur(o.amount), longDay(lang, due)), body: w.lateBody, url: "./#now",
          actions: [{ action: "paid", title: w.iPaid }, { action: "skip", title: w.notOwed }], answer: { k: "bill", id: b.id, due } });
      }
    }
  }
  if (R.payday && morning) {
    const { y, m } = ym(today);
    for (const s of model.income) {
      if (!s.active || !s.amount || s.frequency === "once") continue;
      for (const k of [-1, 0]) {
        const due = E.payDate(s.payDay, y, m + k); if (s.endDate && due > s.endDate) continue;
        const lateBy = E.daysBetween(due, today);
        const got = model.transactions.some(t => t.id === `inc:${s.id}:${due}`);
        if (lateBy < 1 || lateBy > 14 || got || (s.missed || []).includes(due) || (start && due < start)) continue;
        // The morning after payday; again on a later morning only when "Not yet" was tapped the day before.
        if (lateBy !== 1 && !again.has(`again:pay:${s.id}:${due}:${today}`)) continue;
        out.push({ key: lateBy === 1 ? `pay:${s.id}:${due}` : `pay:${s.id}:${due}:${today}`, title: w.pay(w.payName(s.name), eur(E.cents(s.amount))), body: w.payBody(longDay(lang, due)), url: "./#now",
          actions: [{ action: "landed", title: w.landed }, { action: "later", title: w.notYet }], answer: { k: "pay", id: s.id, due } });
      }
    }
  }
  const spent = E.spending(model, P.from, P.to).byCat;
  if (R.budget) {   // once a month per category, at 85 % of this month's budget (with roll over, as the app shows it)
    const B = E.budgets(model, P, today).byId;
    for (const c of model.categories) {
      const b = B[c.id] || 0, s = spent[c.id] || 0; if (b <= 0 || s < b * 0.85) continue;
      out.push({ key: `bud:${c.id}:${P.from}`, title: s > b ? w.over(c.name, eur(s - b)) : w.low(c.name, eur(b - s)), body: w.budBody(Math.round(s / b * 100), eur(b)), url: "./#month" });
    }
  }
  // Worked out here from the person's own records, not from a figure the phone saved.
  const M = E.mood(model, today), L = M.L;
  if (R.tight && L.kind === "current" && (M.mood === "tight" || M.mood === "over")) {
    if (L.left < 0) out.push({ key: `over:${P.from}`, title: w.overNow(eur(-L.left)), body: "", url: "./#now" });
    else if (M.mood === "tight" && M.days) out.push({ key: `tight:${P.from}`, title: w.tight(eur(Math.round(L.left / 100) * 100), M.days, eur(Math.round(M.perDay / 100) * 100)), body: "", url: "./#now" });
  }
  // Pays itself: an automatic bill tomorrow that the account may not cover.
  if (R.autopay && morning && L.kind === "current") for (const b of model.bills) {
    if (!b.active || !b.autopay) continue;
    for (const due of billDuesAround(b, today, 0, 1)) {
      const o = owed(model, b, due);
      if (due === tomorrow && o && L.now < o.amount) out.push({ key: `auto:${b.id}:${due}`, title: w.autoT(b.name, eur(o.amount)), body: w.autoB(eur(L.now)), url: "./#now" });
    }
  }
  // Plan the month: on the day your main pay is marked as landed.
  if (R.plan) {
    const main = mainSource(model), t = main && model.transactions.find(x => x.incomeId === main.id && x.updatedAt && Date.now() - Date.parse(x.updatedAt) < 24 * 3600e3);
    if (t) out.push({ key: `plan:${main.id}:${t.incomeDue}`, title: w.planT, body: w.planB, url: "./#month" });
  }
  // Your own amount reminders: a category passing an amount, or what's yours to spend falling under one. Once a month each.
  for (const r of reminders || []) {
    if (!r.active || r.deleted || r.schedule !== "amount" || !(Number(r.amount) > 0)) continue;
    const limit = E.cents(r.amount);
    if (r.about_kind === "category") {
      const c = model.categories.find(x => x.id === r.about_id), sp = spent[r.about_id] || 0;
      if (c && sp > limit) out.push({ key: `cr:${r.id}:${P.from}`, title: r.title, body: r.note || w.catPassed(c.name, eur(sp), eur(limit)), url: "./#month" });
    } else if (r.about_kind === "left" && L.kind === "current" && L.left < limit) {
      out.push({ key: `cr:${r.id}:${P.from}`, title: r.title, body: r.note || w.leftUnder(eur(L.left)), url: "./#now" });
    }
  }
  // List changed: things added through a shared link, one line per list.
  if (R.lists && events.length) {
    const quietLists = new Set(R.quietLists || []), byList = {};
    for (const e of events) if (!quietLists.has(e.list_id)) (byList[e.list_id] = byList[e.list_id] || []).push(e);
    for (const [lid, evs] of Object.entries(byList)) {
      const name = (model.lists.find(l => l.id === lid) || {}).name || "your list", items = evs.map(e => e.item_name);
      out.push({ key: `ls:${lid}:${Math.max(...evs.map(e => Number(e.id)))}`, title: w.listAdded(list(lang, more(lang, items, 2)), items.length > 1, name), body: w.listBody, url: `./#list/${encodeURIComponent(lid)}` });
    }
  }
  // Today's payments, in the evening: what went out today (purchases, bills paid, project purchases), and the total.
  if (R.daily && now.hour === Number(R.dailyHour)) {
    const T = E.spending(model, today, today);
    if (T.entries.length) {
      const billName = id => (model.bills.find(b => b.id === id) || {}).name, catName = id => (model.categories.find(c => c.id === id) || {}).name;
      const names = T.entries.filter(e => e.itemId || e.kind === "expense").map(e => ({ name: e.payee || (e.billId && billName(e.billId)) || catName(e.categoryId) || (lang === "fi" ? "ostos" : "a purchase"), c: e.itemId ? e.amount : E.cents(e.amount) }))
        .sort((a, b) => b.c - a.c).map(x => `${x.name} ${eur(x.c)}`);
      out.push({ key: `dy:${today}`, title: w.daily, body: w.dailyBody(list(lang, more(lang, names, 3)), eur(T.total), T.entries.length), url: "./?payments=today#now" });
    }
  }
  if (R.weekly && now.weekday === "Sun" && now.hour === 19) {
    const from = E.addDays(today, -6), T = E.spending(model, from, today), next = [], end = E.addDays(today, 7);
    for (const b of model.bills) {
      if (!b.active) continue;
      for (const due of billDuesAround(b, today, 0, 1)) { const o = due > today && due <= end && owed(model, b, due); if (o) next.push(`${b.name} ${eur(o.amount)}`); }
    }
    out.push({ key: `wk:${today}`, title: w.week, body: w.weekBody(eur(T.total - T.bills), list(lang, more(lang, next, 2))), url: "./#month" });
  }
  return out;
}

/* Several reminders at once become one notification; a single one keeps its buttons. */
export function bundle(notes, lang) {
  if (notes.length === 1) return notes[0];
  return { key: `bundle:${Date.now()}`, title: W[lang].bundle(notes.length), body: notes.map(n => n.title).join("\n"), url: "./#now" };
}
