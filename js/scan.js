// Scan or upload a receipt, a bill, or a screenshot of a payment. One step: take the photo (or pick the screenshot).
//   A payment on a bank, card or payment app's screen, or an order confirmation, is checked like a receipt; money that
//     came in is saved as money in; a payment of one of your bills offers to mark that bill paid.
//   A screenshot listing several payments shows each one to tick; ones already in Koti are left unticked. Koti reads every line and sorts it, then you check it.
//   Sorted by Koti (the usual): each line goes where it belongs. Food ticks off your shopping list or goes to its
//     category; a lamp or curtains become a bought item in a home project's room; the rest goes to a category.
//     A bill goes to Bills.
//   Opened from a list, a project or Bills: everything is read for that place first; the title changes it.
// Lines are shown in groups (one per category or project), and a tap on a line moves it. What you choose is
// remembered: it's sent to the reader as an example next time, and wins over what the reader suggests.
// Money is counted once: from the receipt or the bill. Items a receipt ticks don't add their price again.
import { store, todayISO, newId, listCategory, listOf, topLists, roomsOf, itemsOf, projectSpent, projectOf, BILLS_CAT } from "./data.js";
import { $, $$, esc, eur, eur0, icon, parseMoney, parseDay, fmtDay, openSheet, closeSheet, toast, spinner, kotiSays } from "./ui.js";
import { prepareFile, readReceipt, attach } from "./receipts.js";
import { catName, periodFor, totals, payAfter } from "./money.js";
import { effectiveBudgets } from "./ledger.js";
import { alignDue, occurrenceOf, markPaid, bindCopy, FREQ_LABEL, goalFor, spendFromGoal, occurrences } from "./plan.js";
import { learnFromSave } from "./learn.js";

const cats = () => store.model.categories.filter(c => c.id !== BILLS_CAT).sort((a, b) => a.position - b.position);
const keepDefault = kind => (kind === "bill" ? !!store.model.settings.keepBills : !!store.model.settings.keepReceipts);   // off unless switched on: storage costs
const destName = d => d.kind === "mix" ? "Sorted by Koti" : d.kind === "spending" ? "Everyday spending" : d.kind === "bill" ? "Bill" : (listOf(d.id) || {}).name || "List";
const same = (a, b) => a && b && a.kind === b.kind && (a.id || null) === (b.id || null);
const money2 = n => String((Number(n) || 0).toFixed(2)).replace(".", ",");
const low = s => String(s || "").toLowerCase();
const FOOD = /grocer|eating|food|ruoka|lunch|dinner|restaurant|caf/i;
const thumb = S => S.file && S.file.type === "application/pdf" ? `<span class="pdf">PDF</span>` : S.file ? `<img alt="" src="${URL.createObjectURL(S.file.blob)}">` : "";

function destinations() {
  const out = [
    { kind: "mix", icon: "spark", name: "Sorted by Koti", sub: "Each line goes where it belongs" },
    { kind: "spending", icon: "money", name: "Everyday spending", sub: "Each line goes to a category" },
  ];
  topLists().forEach(l => {
    if (l.kind === "shopping") { const n = itemsOf(l.id).filter(i => !i.done).length; out.push({ kind: "list", id: l.id, icon: "list", name: l.name, sub: `List · ticks off what you bought${n ? ` · ${n} to buy` : ""}` }); }
    else if (l.kind === "project") { const left = l.budget ? l.budget - projectSpent(l.id) : null; out.push({ kind: "project", id: l.id, icon: "home", name: l.name, sub: `Project · ticks items or adds new ones${left != null ? ` · ${eur0(left)} left` : ""}` }); }
  });
  out.push({ kind: "bill", icon: "bill", name: "A bill", sub: "Amount, due date, reference and account" });
  return out;
}
/* Where you are decides where it goes first: a list or project you're looking at, the bills screen, otherwise Koti sorts it. */
function contextDest() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === "bills") return { kind: "bill" };
  if (h.startsWith("list/")) { const l = listOf(h.slice(5)); if (!l) return null; const top = l.kind === "room" ? listOf(l.parentId) : l; if (top) return { kind: top.kind === "project" ? "project" : "list", id: top.id }; }
  return null;
}

/* ---------- Step 1: the photo ---------- */
export function openScan({ dest = null, file = null } = {}) {
  const pref = store.model.settings.scanDefault;
  const S = { dest: dest || contextDest() || { kind: ["spending", "bill"].includes(pref) ? pref : "mix" }, keep: null, keepTouched: false, file: null, r: null, lines: null, linesFor: null, edits: {} };
  S.keep = keepDefault(S.dest.kind);
  const d = S.dest, where = d.kind === "bill" ? "a bill" : d.kind === "list" || d.kind === "project" ? esc(destName(d)) : null;
  openSheet({ title: "Scan", left: "Close", body: B => {
    B.innerHTML = `<h2 class="sc-h">${d.kind === "bill" ? "Take a photo of the bill" : "A receipt, a bill or a screenshot"}</h2>
      <p class="sc-p">${d.kind === "bill" ? "Koti reads the amount, due date and reference." : where ? `Koti ticks off what's on ${where}.` : "Koti reads it and sorts it. You check before saving."}</p>
      <div id="scState"><div class="sc-frame" aria-hidden="true">${icon("cam", "ic")}<span>${d.kind === "bill" ? "The whole page, in good light" : "Flat and in good light"}</span></div></div>
      <div class="scan-btns">
        <label class="btn primary sc-go" for="scCam">${icon("cam", "ic sm")} Take photo</label><input type="file" id="scCam" accept="image/*" capture="environment" class="sr">
        <label class="btn sc-up" for="scFile">${icon("up", "ic sm")} Upload a screenshot, photo or PDF</label><input type="file" id="scFile" accept="image/*,application/pdf" class="sr">
      </div>
      <label class="sc-keep"><span id="scKeepLbl">Keep the photo with it<small id="scKeepSub"></small></span><input type="checkbox" class="switch" id="scKeep" aria-labelledby="scKeepLbl"></label>
      <p class="msg" id="scMsg" aria-live="polite"></p>`;
    const k = $("#scKeep", B), paintKeep = () => { k.checked = S.keep; $("#scKeepSub", B).textContent = S.keep ? "Saved privately, only you can see it" : "Only used for reading. Not saved."; };
    paintKeep(); k.onchange = () => { S.keep = k.checked; S.keepTouched = true; paintKeep(); };
    const onFile = e => { const f = e.target.files[0]; e.target.value = ""; if (f) run(S, f, B); };
    ["#scCam", "#scFile"].forEach(id => $(id, B).addEventListener("change", onFile));
    if (file) run(S, file, B);   // given already: a screenshot shared to Koti, or picked in a conversation
  } });
}

/* Changing where it goes, after reading. */
function pickSheet(S) {
  openSheet({ title: "Where should this go?", left: "Back", body: B => {
    B.innerHTML = `<div class="grp dests" role="radiogroup" aria-label="Where should this go?">${destinations().map(d => `<button type="button" class="row dest" role="radio" data-k="${d.kind}" data-id="${esc(d.id || "")}" aria-checked="${same(d, S.dest)}">
        <span class="ico ${d.kind === "bill" ? "r" : d.kind === "project" ? "a" : "g"}">${icon(d.icon)}</span><span class="rt"><span>${esc(d.name)}</span><small>${esc(d.sub)}</small></span><span class="radio" aria-hidden="true"></span></button>`).join("")}</div>`;
    $(".dests", B).addEventListener("click", e => { const b = e.target.closest(".dest"); if (!b) return;
      S.dest = { kind: b.dataset.k, id: b.dataset.id || undefined }; if (!S.keepTouched) S.keep = keepDefault(S.dest.kind); review(S); });
  }, onClose: null });
  const back = $("#sheet [data-close]"); if (back) back.onclick = e => { e.stopPropagation(); review(S); };
}

async function run(S, file, B) {
  const st = $("#scState", B), msg = (t, s = "error") => { const m = $("#scMsg", B); m.textContent = t; m.dataset.state = s; };
  msg("", "");
  try {
    st.innerHTML = `<div class="scan-state"><div class="scan-thumb" id="scThumb"></div><div style="flex:1"><div class="sc-lbl">${spinner("Reading the receipt", "sm")}<b id="scLbl">Preparing…</b></div><div class="meter" style="margin-top:8px"><i id="scBar" style="width:4%"></i></div></div></div>`;
    $$("input[type=file]", B).forEach(i => i.disabled = true);
    S.file = await prepareFile(file);
    $("#scThumb", st).innerHTML = thumb(S);
    const hint = S.dest.kind === "bill" ? "bill" : S.dest.kind === "mix" ? null : "receipt";
    S.r = await readReceipt(S.file, (p, label) => { const l = $("#scLbl", st), b = $("#scBar", st); if (l) l.textContent = label; if (b) b.style.width = Math.round(p * 100) + "%"; }, hint);
    S.lines = null;
    if (S.dest.kind === "mix" && S.r.docType === "bill") { S.dest = { kind: "bill" }; if (!S.keepTouched) S.keep = keepDefault("bill"); }
    if (S.r.docType === "payments" && S.r.payments && S.r.payments.length) { paymentsReview(S); return; }
    if (S.r.docType === "payment") { S.moneyIn = !!(S.r.parsed && S.r.parsed.moneyIn); S.billPay = billPaymentFor(S.r); }
    review(S);
  } catch (err) {
    st.innerHTML = ""; $$("input[type=file]", B).forEach(i => i.disabled = false);
    msg(String(err.message || err));
  }
}

/* A photo added in a chat with Koti, already read: the same "Check it" screen as a scan, from that reading. */
export function openReading({ r, file = null }) {
  const pref = store.model.settings.scanDefault;
  const dest = r.docType === "bill" ? { kind: "bill" } : { kind: pref === "spending" ? "spending" : "mix" };
  const S = { dest, keep: file ? keepDefault(dest.kind) : false, keepTouched: !file, file, r, lines: null, linesFor: null, edits: {} };
  if (r.docType === "payments" && r.payments && r.payments.length) { paymentsReview(S); return; }
  if (r.docType === "payment") { S.moneyIn = !!(r.parsed && r.parsed.moneyIn); S.billPay = billPaymentFor(r); }
  review(S);
}

/* What the microphone heard, when it's several things ("Prisma 86, the lamp was 35 of it"): the same "Check it"
   screen as a receipt, without a photo. */
export function openParsed(parsed) {
  const S = { dest: { kind: "mix" }, keep: false, keepTouched: true, file: null, r: { ai: true, heard: true, docType: "receipt", parsed }, lines: null, linesFor: null, edits: {} };
  receiptReview(S);
}

function review(S) { if (S.dest.kind === "bill") billReview(S); else receiptReview(S); }

/* Makes the sheet title a button that goes back to "Where should this go?" without scanning again. */
function titleButton(S, name) {
  const h = $("#sheetTitle"); if (!h) return;
  h.innerHTML = `<button type="button" class="dest-title" aria-label="${esc(name)}. Change where this goes">${esc(name)} <span aria-hidden="true">▾</span></button>`;
  $(".dest-title", h).onclick = () => { saveEdits(S); pickSheet(S); };
}
function saveEdits(S) {
  const g = id => { const e = document.getElementById(id); return e ? e.value : undefined; };
  S.edits = { ...S.edits, shop: g("rvShop") ?? S.edits.shop, date: g("rvDate") ?? S.edits.date, total: g("rvTotal") ?? S.edits.total };
  const k = document.getElementById("rvKeep"); if (k) S.keep = k.checked;
}

/* ---------- Receipt review ---------- */
const allOpen = () => store.model.items.filter(i => !i.done && listOf(i.listId));
const openOf = ids => store.model.items.filter(i => ids.has(i.listId) && !i.done);
const nameHit = (line, item) => [line.name, line.nameFi].filter(Boolean).some(n => { const a = low(n), b = low(item.name); return b.length > 2 && (a.includes(b) || b.includes(a.split(" ")[0]) && a.split(" ")[0].length > 2); });
function scopeIds(d) {
  if (d.kind === "mix") return new Set(store.model.lists.map(l => l.id));
  return d.kind === "project" ? new Set([d.id, ...roomsOf(d.id).map(r => r.id)]) : d.kind === "list" ? new Set([d.id]) : new Set();
}
function roomsFor(pid) { const r = roomsOf(pid); return r.length ? r : [listOf(pid)]; }
const projects = () => topLists().filter(l => l.kind === "project");
const shoppingIds = () => new Set(topLists().filter(l => l.kind === "shopping").map(l => l.id));

/* Each line gets a target: "tick:<item>", "new:<room or project>", "cat:<category>" or "proj:<project>". */
function makeLines(d, src) {
  const scope = scopeIds(d), open = openOf(scope), used = new Set();
  const lines = (src || []).map(l => ({ name: l.name, nameFi: l.nameFi || null, qty: l.qty, price: l.price, categoryId: l.categoryId && !String(l.categoryId).startsWith("proj:") ? l.categoryId : null, placeId: l.placeId && listOf(l.placeId) ? l.placeId : null, aiItem: l.itemId, target: null }));
  if (d.kind === "spending") { lines.forEach(l => l.target = l.placeId ? "proj:" + projectOf(l.placeId).id : "cat:" + (l.categoryId || "")); return lines; }
  const byName = d.kind === "mix" ? open.filter(i => shoppingIds().has(i.listId)) : open;   // sorting everything: only shopping lists are matched by name
  lines.forEach(l => {   // matched by AI, then by name
    let it = l.aiItem && open.find(i => i.id === l.aiItem && !used.has(i.id));
    if (it && d.kind === "mix" && !shoppingIds().has(it.listId)) { const s = byName.find(i => !used.has(i.id) && low(i.name) === low(it.name)); if (s) it = s; }   // the same thing on a shopping list wins
    if (!it) it = byName.find(i => !used.has(i.id) && nameHit(l, i));
    if (!it && l.placeId && d.kind === "mix") { const pr = projectOf(l.placeId); if (pr) { const ids = scopeIds({ kind: "project", id: pr.id }); it = open.find(i => ids.has(i.listId) && !used.has(i.id) && nameHit(l, i)); } }   // a lamp already planned in the project
    if (it) { used.add(it.id); l.target = "tick:" + it.id; }
  });
  if (d.kind === "mix") { lines.forEach(l => { if (!l.target) l.target = l.placeId ? "new:" + l.placeId : "cat:" + (l.categoryId || ""); }); return lines; }
  if (d.kind === "list") { lines.forEach(l => { if (!l.target) l.target = "cat:" + (l.categoryId || ""); }); return lines; }
  const rooms = roomsFor(d.id), count = {};
  lines.forEach(l => { if (l.target) { const it = store.model.items.find(i => "tick:" + i.id === l.target); if (it) count[it.listId] = (count[it.listId] || 0) + 1; } });
  const room = (Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [rooms[0].id])[0];
  lines.forEach(l => { if (!l.target) l.target = l.placeId && projectOf(l.placeId) && projectOf(l.placeId).id === d.id ? "new:" + l.placeId : l.categoryId && FOOD.test(catName(l.categoryId)) ? "cat:" + l.categoryId : "new:" + room; });
  return lines;
}
const split = t => [t.slice(0, t.indexOf(":")), t.slice(t.indexOf(":") + 1)];
const placeLabel = id => { const l = listOf(id); if (!l) return ""; const p = projectOf(id); return p && p.id !== l.id ? `${p.name} · ${l.name}` : l.name; };

/* Where a line can go, in groups, for the picker. */
function targetGroups(d, line, lines) {
  const taken = new Set(lines.filter(x => x !== line && x.target.startsWith("tick:")).map(x => x.target));
  const catOpts = () => cats().map(c => ["cat:" + c.id, c.name]).concat([["cat:", "No category"]]);
  const items = list => list.filter(i => !taken.has("tick:" + i.id)).map(i => ["tick:" + i.id, `✓ ${i.name}`, placeLabel(i.listId)]);
  const cur = line.target.startsWith("tick:") ? store.model.items.find(i => "tick:" + i.id === line.target) : null;
  if (d.kind === "spending") return [{ label: "A category: everyday spending", opts: catOpts() }, { label: "A project", opts: projects().map(p => ["proj:" + p.id, p.name]) }];
  if (d.kind === "mix") {
    // things you were going to buy: your shopping lists, plus project items with a similar name (a project can hold hundreds)
    const sh = shoppingIds(), open = allOpen().filter(i => sh.has(i.listId) || nameHit(line, i)).slice(0, 30), list = cur && !open.includes(cur) ? [cur, ...open] : open;
    const places = projects().flatMap(p => { const r = roomsOf(p.id); return r.length ? r.map(x => ["new:" + x.id, `${p.name} · ${x.name}`]) : [["new:" + p.id, p.name]]; });
    return [{ label: "Tick off something you were going to buy", opts: items(list) }, { label: "A project: it becomes a bought item there", opts: places }, { label: "A category: everyday spending", opts: catOpts() }].filter(g => g.opts.length);
  }
  const open = openOf(scopeIds(d)), list = cur && !open.includes(cur) ? [cur, ...open] : open;
  if (d.kind === "list") return [{ label: `Tick off on ${listOf(d.id).name}`, opts: items(list) }, { label: "Not on the list: a category", opts: catOpts() }].filter(g => g.opts.length);
  const pr = listOf(d.id);
  return [{ label: `Tick off in ${pr.name}`, opts: items(list) }, { label: "A new item in", opts: roomsFor(pr.id).map(r => ["new:" + r.id, r.id === pr.id ? pr.name : r.name]) }, { label: `Not for ${pr.name}: a category`, opts: catOpts() }].filter(g => g.opts.length);
}
function lineSub(d, l) {
  const [k, v] = split(l.target);
  const qty = l.qty && l.qty !== 1 ? `${String(l.qty).replace(".", ",")} × · ` : "";
  if (k === "tick") { const it = store.model.items.find(i => i.id === v); return qty + `✓ Ticks off ${it ? `“${it.name}”` : "an item"}${it && d.kind === "mix" ? ` on ${placeLabel(it.listId)}` : ""}`; }
  if (k === "new") return qty + `New in ${placeLabel(v)}`;
  if (k === "proj") return qty + ((listOf(v) || {}).name || "Project");
  return qty + (v ? catName(v) : "No category");
}
/* Which total a line counts in: a category id, "proj:<project>" or "none". */
function bucket(d, l) {
  const [k, v] = split(l.target);
  if (k === "proj") return "proj:" + v;
  if (k === "new") { const p = projectOf(v); return p ? "proj:" + p.id : (d.kind === "project" ? "proj:" + d.id : "none"); }
  if (k === "tick") {
    const it = store.model.items.find(i => i.id === v), p = it && projectOf(it.listId);
    if (p && (d.kind === "mix" || d.kind === "project")) return "proj:" + p.id;
    const lc = it ? listCategory(listOf(it.listId)) : null; return (lc && lc.id) || l.categoryId || "none";
  }
  return v || "none";
}
/* The small note beside a group's total: what's left in that budget or project after this receipt. */
function groupExtra(k, v) {
  if (k.startsWith("proj:")) { const p = listOf(k.slice(5)); return p && p.budget ? `${eur0(p.budget - projectSpent(p.id) - v)} left` : ""; }
  if (k === "none") return "";
  const p = periodFor(new Date()), b = effectiveBudgets(p).byId[k]; if (b == null) return "";
  const left = b - (totals(p).byCat[k] || 0) - v; return left >= 0 ? `${eur0(left)} to go` : `${eur0(-left)} over`;
}
const groupColor = k => k.startsWith("proj:") ? "var(--amber)" : k === "none" ? "var(--muted)" : "var(--spruce)";

function receiptReview(S) {
  const d = S.dest, r = S.r || {}, P = r.parsed || {};
  if (!S.lines || !same(S.linesFor, d)) { S.lines = makeLines(d, P.lines); S.linesFor = { ...d }; }
  const E = S.edits, name = destName(d);
  openSheet({ title: name, left: "Cancel", right: "Save", body: B => {
    const total = E.total ?? (P.amount != null ? money2(P.amount) : "");
    B.innerHTML = `
      ${kotiSays(r.reply || P.reply)}
      ${r.docType === "bill" ? `<div class="suggest warn">${icon("bill", "ic")}<div><b>This looks like a bill</b><small>Bills go to Bills with their due date and reference.</small></div><button type="button" class="btn sm" id="rvToBill">Add as a bill</button></div>` : ""}
      ${S.billPay && !S.moneyIn ? `<div class="suggest">${icon("bill", "ic")}<div><b>Your ${esc(S.billPay.bill.name)} payment?</b><small>Due ${esc(fmtDay(parseDay(S.billPay.due)))}, ${esc(eur(S.billPay.amount))}.</small></div><button type="button" class="btn sm" id="rvBillPaid">Mark paid</button></div>` : ""}
      ${r.docType === "payment" ? `<div class="seg" id="rvDir" role="group" aria-label="Money out or in"><button type="button" data-in="0" aria-pressed="${!S.moneyIn}">I paid</button><button type="button" data-in="1" aria-pressed="${!!S.moneyIn}">I received</button></div>` : ""}
      ${P.currency && P.currency !== "EUR" ? `<div class="suggest warn">${icon("alert", "ic")}<div><b>This receipt is in ${esc(P.currency)}</b><small>Koti counts in euros. Change the total to what your bank charged.</small></div></div>` : ""}
      ${E.date || P.date ? "" : whenHTML()}
      <div class="rv-top"><div class="rv-big num" id="rvBig"></div>${S.file ? `<span class="scan-thumb">${thumb(S)}</span>` : ""}</div>
      <p class="rv-s" id="rvS"></p>
      <details class="rv-more"${total ? "" : " open"}><summary>Shop, date and total</summary>
      <div class="grp">
        <label class="row"><span class="rt">${S.moneyIn ? "From" : r.docType === "payment" ? "Paid to" : "Shop"}</span><input class="inl" id="rvShop" value="${esc(E.shop ?? P.payee ?? "")}" placeholder="${S.moneyIn ? "Who" : "Where"}" maxlength="120" autocomplete="off" style="max-width:60%"></label>
        <label class="row"><span class="rt">Date</span><input class="inl" id="rvDate" type="date" max="${todayISO()}" value="${esc(E.date ?? P.date ?? "")}"></label>
        <label class="row"><span class="rt">Total</span><input class="inl num" id="rvTotal" inputmode="decimal" value="${esc(total)}" placeholder="0,00" autocomplete="off" style="max-width:40%"></label>
        <label class="row"${S.file ? "" : " hidden"}><span class="rt" id="rvKeepLbl">Keep the photo<small id="rvKeepSub"></small></span><input type="checkbox" class="switch" id="rvKeep" aria-labelledby="rvKeepLbl" ${S.keep ? "checked" : ""}></label>
      </div></details>
      <div id="rvLines"></div>
      <p class="msg" id="rvMsg" aria-live="polite"></p>`;
    titleButton(S, name);
    const keepSub = () => { $("#rvKeepSub", B).textContent = $("#rvKeep", B).checked ? "Saved privately with the expense" : "Only used for reading. Not saved."; };
    keepSub(); $("#rvKeep", B).onchange = keepSub;
    ["#rvShop", "#rvDate", "#rvTotal"].forEach(id => $(id, B).addEventListener("input", () => { saveEdits(S); paintHead(S, B); }));
    const tb = $("#rvToBill", B); if (tb) tb.onclick = () => { saveEdits(S); S.dest = { kind: "bill" }; if (!S.keepTouched) S.keep = true; billReview(S); };
    const wh = $(".when", B); if (wh) wh.onclick = e => { const b = e.target.closest("[data-day]"); if (!b) return;
      if (b.dataset.day === "pick") { $(".rv-more", B).open = true; $("#rvDate", B).focus(); try { $("#rvDate", B).showPicker(); } catch {} return; }
      $("#rvDate", B).value = b.dataset.day; saveEdits(S); receiptReview(S); };
    const dir = $("#rvDir", B); if (dir) dir.onclick = e => { const x = e.target.closest("[data-in]"); if (!x) return; saveEdits(S); S.moneyIn = x.dataset.in === "1"; receiptReview(S); };
    const bp = $("#rvBillPaid", B); if (bp) bp.onclick = () => { saveEdits(S); const o = S.billPay, date = $("#rvDate", B).value || todayISO(), tx = markPaid(o, date > todayISO() ? todayISO() : date, true);
      closeSheet(); toast(`${o.bill.name} marked paid`, { label: "Undo", run: () => store.remove("transactions", tx.id) }); };
    paintHead(S, B); paintLines(S, B);
  }, onRight: B => saveReceipt(S, B) });
}

function groupsOf(S) {
  const by = new Map();
  S.lines.forEach((l, k) => { const b = bucket(S.dest, l); if (!by.has(b)) by.set(b, { k: b, total: 0, lines: [] }); const g = by.get(b); g.total += l.price; g.lines.push(k); });
  return [...by.values()].sort((a, b) => b.total - a.total);
}
function paintHead(S, B) {
  const t = $("#rvTotal", B).value, shop = $("#rvShop", B).value.trim(), date = $("#rvDate", B).value;
  const tv = parseMoney(t); $("#rvBig", B).textContent = eur(tv && !Number.isNaN(tv) ? tv : 0);
  const day = !date ? "day not known yet" : date === todayISO() ? "today" : parseDay(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const n = S.lines.length, g = groupsOf(S).length;
  const noDate = false;   // a date that couldn't be read is asked for (whenHTML), not shown as today
  $("#rvS", B).innerHTML = `${shop ? `at <b>${esc(shop)}</b>, ` : ""}${esc(day)}${noDate ? " (the date couldn't be read)" : ""}.${n ? ` ${n} line${n === 1 ? "" : "s"}${g > 1 ? `, sorted ${g === 2 ? "two" : g === 3 ? "three" : g} ways` : ""}.` : ""}`;
}
function paintLines(S, B) {
  const d = S.dest, L = $("#rvLines", B), lines = S.lines, r = S.r || {};
  const how = r.heard ? "Heard by AI. Check it, then Save." : r.ai ? `Read by AI${r.limit ? ` · ${r.used} of ${r.limit} scans today` : ""}` : r.aiError ? `Read on this device, total only. AI: ${r.aiError.message}` : "Read on this device, total only.";
  if (S.moneyIn) { L.innerHTML = `<p class="note ai-note">${esc(how)}</p><p class="note">Saved as money in.</p>`; paintHead(S, B); return; }
  if (!lines.length) { L.innerHTML = `<p class="note ai-note">${esc(how)}</p><p class="note">No lines read: the total goes to ${d.kind === "project" ? esc(listOf(d.id).name) : "one category"}.</p>`; paintHead(S, B); return; }
  const G = groupsOf(S), sum = lines.reduce((a, l) => a + l.price, 0);
  L.innerHTML = `${G.length > 1 ? `<div class="rv-bar" role="img" aria-label="${esc(G.map(g => `${g.k === "none" ? "No category" : catName(g.k)} ${eur(g.total)}`).join(", "))}">${G.map(g => `<i style="flex:${Math.max(0.01, g.total)};background:${groupColor(g.k)}"></i>`).join("")}</div>` : ""}
    ${G.map(g => `<section class="rv-g"><div class="rv-gh"><i style="background:${groupColor(g.k)}" aria-hidden="true"></i><b>${esc(g.k === "none" ? "No category" : catName(g.k))}</b><small>${esc(groupExtra(g.k, g.total))}</small><b class="num">${eur(g.total)}</b></div>
      ${g.lines.map(k => { const l = lines[k]; return `<button type="button" class="rv-line" data-line="${k}" aria-label="${esc(l.name)}, ${esc(eur(l.price))}, ${esc(lineSub(d, l))}. Move it"><span class="rt"><b>${esc(l.name)}</b><small>${esc(lineSub(d, l))}</small></span><span class="num">${eur(l.price)}</span>${icon("chev", "ic xs")}</button>`; }).join("")}</section>`).join("")}
    <p class="note ai-note">${esc(how)}${Math.abs(sum - (parseMoney($("#rvTotal", B).value) || 0)) >= 0.01 && parseMoney($("#rvTotal", B).value) ? ` · Lines add up to ${eur(sum)}` : ""}</p>
    <p class="note">Tap a line to move it. Koti remembers.</p>`;
  $$("[data-line]", L).forEach(b => b.onclick = () => { saveEdits(S); movePicker(S, Number(b.dataset.line)); });
  paintHead(S, B);
}
/* "Where does the floor lamp go?" */
function movePicker(S, k) {
  const l = S.lines[k], G = targetGroups(S.dest, l, S.lines);
  openSheet({ title: l.name, left: "Back", body: B => {
    B.innerHTML = `<h2 class="sc-h">Where does “${esc(l.name)}” go?</h2>
      <p class="sc-p">${eur(l.price)}${S.edits.shop ? ` on the ${esc(S.edits.shop)} receipt` : ""}</p>
      <div class="mv">${G.map(g => `<p class="mv-h">${esc(g.label)}</p>${g.opts.map(([v, t, sub]) => `<button type="button" class="mv-o" data-v="${esc(v)}" aria-pressed="${l.target === v}"><span>${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>${l.target === v ? icon("check", "ic sm") : ""}</button>`).join("")}`).join("")}</div>
      <button type="button" class="btn danger" id="mvDel">${icon("trash", "ic sm")} Not on this receipt: remove the line</button>`;
    $$(".mv-o", B).forEach(b => b.onclick = () => { l.target = b.dataset.v; receiptReview(S); });
    $("#mvDel", B).onclick = () => { S.lines.splice(k, 1); receiptReview(S); };
  } });
  const back = $("#sheet [data-close]"); if (back) back.onclick = e => { e.stopPropagation(); receiptReview(S); };
}

async function saveReceipt(S, B) {
  const d = S.dest, msg = t => { const m = $("#rvMsg", B); m.textContent = t; m.dataset.state = "error"; };
  if (S.busy) return;
  const total = parseMoney($("#rvTotal", B).value), date = $("#rvDate", B).value, shop = $("#rvShop", B).value.trim(), keep = $("#rvKeep", B).checked;
  if (total == null || Number.isNaN(total) || total <= 0) return msg("Type the total, like 24,90.");
  if (!date) return msg("When was this? Pick the day.");
  if (["list", "project"].includes(d.kind) && !listOf(d.id)) return msg("That list was deleted. Tap the title to choose another place.");
  if (date > todayISO()) return msg("That date is in the future. Check the date.");
  // The same receipt twice: same day, same total, same shop (or no shop)
  const twin = twinOf({ date, amount: total, payee: shop, kind: S.moneyIn ? "income" : "expense" });
  if (twin && !S.twinOk) { S.twinOk = true; return msg(`You already have ${twin.payee || (S.moneyIn ? "money in" : "an expense")}, ${eur(twin.amount)}, on this day. Tap Save again to keep both.`); }
  if (S.moneyIn) {   // money received, from a screenshot: income, no lines
    S.busy = true;
    let receiptPath = null; const id = newId("tx");
    if (keep && S.file) { try { receiptPath = await attach(id, S.file); } catch (e) { S.busy = false; return msg("Couldn't keep the picture on this device: " + (e.message || e)); } }
    const tx = store.put("transactions", { id, date, amount: total, kind: "income", categoryId: null, payee: shop || null, note: null, source: "receipt", receiptPath });
    if (S.r && S.r.ai) learnFromSave({ read: { payee: S.r.parsed.payee, date: S.r.parsed.date, amount: S.r.parsed.amount }, saved: { payee: shop, date, amount: total } });
    closeSheet(); S.busy = false;
    toast(`Saved ${eur(tx.amount)} in${shop ? ` from ${shop}` : ""}`, { label: "Undo", run: () => store.remove("transactions", tx.id) });
    return;
  }
  S.busy = true;
  const id = newId("tx"), unit = l => Math.round(l.price / (l.qty && l.qty > 0 && Number.isInteger(l.qty) ? l.qty : 1) * 100) / 100;
  const before = [], created = [], txLines = [];
  for (const l of S.lines) {
    const k = l.target.slice(0, l.target.indexOf(":")), v = l.target.slice(l.target.indexOf(":") + 1);
    let itemId = null;
    if (k === "tick") { const it = store.model.items.find(i => i.id === v); if (it && !before.some(b => b.id === it.id)) { before.push({ ...it }); store.updateItem(it.id, { done: true, price: unit(l), boughtAt: date }); itemId = it.id; } }
    if (k === "new" && listOf(v)) { const it = store.addItem(v, l.name, "Soon", { qty: Number.isInteger(l.qty) && l.qty > 1 ? l.qty : null, done: true, price: unit(l), boughtAt: date }); created.push(it.id); itemId = it.id; }
    const b = bucket(d, l);
    txLines.push({ name: l.name, nameFi: l.nameFi, qty: l.qty, price: l.price, categoryId: b === "none" ? null : b, itemId });
  }
  const sums = {}; txLines.forEach(l => { const c = l.categoryId || "none"; sums[c] = (sums[c] || 0) + l.price; });
  const main = (Object.entries(sums).filter(([c]) => c !== "none").sort((a, b) => b[1] - a[1])[0] || [])[0]
    || (d.kind === "project" ? "proj:" + d.id : (S.r && S.r.parsed && S.r.parsed.categoryId) || null);
  let receiptPath = null;
  if (keep && S.file) { try { receiptPath = await attach(id, S.file); } catch (e) { S.busy = false; return msg("Couldn't keep the photo on this device: " + (e.message || e)); } }
  const fromPay = S.r && S.r.parsed && S.r.parsed.fromNextPay ? (payAfter(date) || {}).date || null : null;   // "from my next pay", said with several things
  const tx = store.put("transactions", { id, date, amount: total, kind: "expense", fromPay, categoryId: main, payee: shop || null, note: null, source: "receipt", receiptPath, lines: txLines.length ? txLines : null });
  // What you corrected of what Koti read: the shop's name, its category, a misread date or total (js/learn.js).
  if (S.r && (S.r.ai || S.r.heard)) { const R0 = S.r.parsed || {}; learnFromSave({ read: { payee: R0.payee, categoryId: txLines.length > 1 ? null : R0.categoryId, date: R0.date, amount: R0.amount }, saved: { payee: shop, categoryId: main, date, amount: total } }); }
  const P0 = (S.r && S.r.parsed) || {}, goal = !fromPay && P0.fromSavings ? goalFor(P0.goal) : null, out = goal ? spendFromGoal(goal, tx) : null;   // "from my savings"
  closeSheet(); S.busy = false;
  const ticks = before.length, news = created.length;
  const extra = [ticks ? `${ticks} ticked` : "", news ? `${news} new item${news === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  toast(`Saved ${eur(tx.amount)}${d.kind === "mix" ? (shop ? ` at ${shop}` : "") : ` to ${destName(d)}`}${extra ? " · " + extra : ""}`, { label: "Undo", run: () => {
    store.remove("transactions", tx.id); if (out) store.remove("transactions", out.id);
    before.forEach(it => store.updateItem(it.id, { done: it.done, price: it.price, boughtAt: it.boughtAt }));
    created.forEach(i => store.deleteItem(i));
  } });
}

/* ---------- Bill review ---------- */
const normIban = s => String(s || "").replace(/\s+/g, "").toUpperCase();
export function matchBill(b, P = {}) {
  const bills = store.model.bills;
  if (b.match) { const m = bills.find(x => low(x.name) === low(b.match)); if (m) return m; }
  if (b.iban) { const m = bills.find(x => x.iban && normIban(x.iban) === normIban(b.iban)); if (m) return m; }
  const co = low(b.company || P.payee);
  if (co) { const m = bills.find(x => (x.payee && (co.includes(low(x.payee)) || low(x.payee).includes(co))) || co.includes(low(x.name))); if (m) return m; }
  return null;
}

function billReview(S) {
  const r = S.r || {}, P = r.parsed || {}, b = r.bill || {}, E = S.edits;
  if (!S.bill) {
    const m = matchBill(b, P);
    S.bill = { sel: m ? m.id : "new", name: b.period && !b.company ? b.period : (b.company || P.payee || "").replace(/\s+(oy|oyj|ab)$/i, ""), freq: "monthly", autopay: false, paid: false, usual: false,
      amount: b.amount ?? P.amount ?? null, due: b.due_date || null, reference: b.reference || "", iban: b.iban || "" };
  }
  const W = S.bill;
  if (E.total != null && W.amountTouched == null) { W.amount = parseMoney(E.total); W.amountTouched = true; }
  openSheet({ title: "Bill", right: "Save", body: B => {
    const paint = () => {
      const m = W.sel !== "new" ? store.model.bills.find(x => x.id === W.sel) : null;
      const due = W.due ? parseDay(W.due) : null;
      B.innerHTML = `${kotiSays(r.reply)}
        <div class="billcard"><div class="bc-top"><span class="ico r">${icon("bill")}</span><div class="rt"><b>${esc(b.company || P.payee || "Bill")}</b><small>${esc([b.period, b.invoice_number ? "Invoice " + b.invoice_number : ""].filter(Boolean).join(" · ") || (r.ai ? "Read by AI" : "Fill in from the bill"))}</small></div>
          <span class="chip ${m ? "ok" : ""}">${m ? `Your bill “${esc(m.name)}”` : "New bill"}</span></div></div>
        <div class="grp">
          <label class="row"><span class="rt">Which bill</span><select class="inl" id="bvSel">${store.model.bills.map(x => `<option value="${esc(x.id)}"${x.id === W.sel ? " selected" : ""}>${esc(x.name)}</option>`).join("")}<option value="new"${W.sel === "new" ? " selected" : ""}>+ New bill</option></select></label>
          ${m ? "" : `<label class="row"><span class="rt">Name</span><input class="inl" id="bvName" value="${esc(W.name)}" placeholder="e.g. Electricity" maxlength="80" autocomplete="off" style="max-width:60%"></label>`}
          <label class="row"><span class="rt">Amount</span><input class="inl num" id="bvAmt" inputmode="decimal" value="${W.amount != null && !Number.isNaN(W.amount) ? money2(W.amount) : ""}" placeholder="0,00" autocomplete="off" style="max-width:40%"></label>
          <label class="row"><span class="rt">Due</span><input class="inl" id="bvDue" type="date" value="${esc(W.due || "")}"></label>
          <label class="row"><span class="rt">Reference</span><input class="inl mono" id="bvRef" value="${esc(W.reference)}" placeholder="Viitenumero" maxlength="60" autocomplete="off" style="max-width:66%"></label>
          <label class="row"><span class="rt">Pay to</span><input class="inl mono" id="bvIban" value="${esc(W.iban)}" placeholder="IBAN" maxlength="40" autocomplete="off" style="max-width:72%"></label>
          ${W.reference || W.iban ? `<div class="row copy-row">${W.reference ? `<button type="button" class="link" data-copy="${esc(W.reference)}">${icon("copy", "ic xs")} Copy reference</button>` : ""}${W.iban ? `<button type="button" class="link" data-copy="${esc(normIban(W.iban))}">${icon("copy", "ic xs")} Copy IBAN</button>` : ""}</div>` : ""}
        </div>
        ${m ? (W.amount && Math.abs(W.amount - m.amount) >= 0.005 ? `<div class="grp"><label class="row"><span class="rt">Make ${eur(W.amount)} the usual amount<small>Now ${eur(m.amount)}. Off: only this month's bill is ${eur(W.amount)}.</small></span><input type="checkbox" class="switch" id="bvUsual" ${W.usual ? "checked" : ""}></label></div>` : "")
          : `<div class="field"><span class="flabel">Repeats</span><div class="seg" id="bvFreq">${["monthly", "quarterly", "yearly", "once"].map(f => `<button type="button" data-f="${f}" aria-pressed="${f === W.freq}">${FREQ_LABEL[f]}</button>`).join("")}</div></div>
          <div class="grp"><label class="row"><span class="rt">Paid automatically<small>Direct debit or e-invoice: on the due date Koti asks if it went out</small></span><input type="checkbox" class="switch" id="bvAuto" ${W.autopay ? "checked" : ""}></label></div>`}
        <div class="seg big" id="bvPaid"><button type="button" data-p="0" aria-pressed="${!W.paid}">${due ? `To pay by ${esc(fmtDay(due))}` : "To pay"}</button><button type="button" data-p="1" aria-pressed="${W.paid}">Already paid</button></div>
        <div class="grp"><div class="row rc-row"><span class="scan-thumb">${S.file && S.file.type === "application/pdf" ? `<span class="pdf">PDF</span>` : S.file ? `<img alt="" src="${URL.createObjectURL(S.file.blob)}">` : ""}</span>
          <label class="rt" for="rvKeep">Keep the bill<small>${S.keep ? "Saved privately with this month's bill" : "Only used for reading. Not saved."}</small></label><input type="checkbox" class="switch" id="rvKeep" ${S.keep ? "checked" : ""}></div></div>
        <p class="note">Koti doesn't pay bills. Copy the reference and account into your bank app${W.paid ? "" : ", then mark it paid in Bills"}.</p>
        <p class="msg" id="bvMsg" aria-live="polite"></p>`;
      titleButton(S, "Bill");
      const read = () => { const v = id => $(id, B) && $(id, B).value;
        if ($("#bvName", B)) W.name = v("#bvName"); const a = parseMoney(v("#bvAmt")); W.amount = a; W.due = v("#bvDue") || null; W.reference = v("#bvRef").trim(); W.iban = v("#bvIban").trim();
        if ($("#bvUsual", B)) W.usual = $("#bvUsual", B).checked; if ($("#bvAuto", B)) W.autopay = $("#bvAuto", B).checked; S.keep = $("#rvKeep", B).checked; };
      W.read = read;
      $("#bvSel", B).onchange = e => { read(); W.sel = e.target.value; paint(); };
      ["#bvAmt", "#bvDue", "#bvRef", "#bvIban"].forEach(id => $(id, B).addEventListener("change", () => { read(); paint(); }));
      $("#rvKeep", B).onchange = () => { read(); S.keepTouched = true; paint(); };
      const fq = $("#bvFreq", B); if (fq) fq.onclick = e => { const x = e.target.closest("[data-f]"); if (!x) return; read(); W.freq = x.dataset.f; paint(); };
      $("#bvPaid", B).onclick = e => { const x = e.target.closest("[data-p]"); if (!x) return; read(); W.paid = x.dataset.p === "1"; paint(); };
    };
    paint(); bindCopy(B);
  }, onRight: B => saveBill(S, B) });
}

async function saveBill(S, B) {
  const W = S.bill, msg = t => { const m = $("#bvMsg", B); m.textContent = t; m.dataset.state = "error"; };
  if (S.busy) return; W.read();
  if (!W.amount || Number.isNaN(W.amount)) return msg("Type the amount, like 45,60.");
  if (!W.due) return msg("Pick the due date.");
  let bill = W.sel !== "new" ? store.model.bills.find(x => x.id === W.sel) : null;
  if (!bill && !W.name.trim()) return msg("Give the bill a name, like Electricity.");
  S.busy = true;
  const due = parseDay(W.due), company = (S.r && S.r.bill && S.r.bill.company) || (S.r && S.r.parsed && S.r.parsed.payee) || null;
  if (!bill) bill = store.put("bills", { name: W.name.trim().slice(0, 80), amount: W.amount, frequency: W.freq, dueDay: due.getDate(), anchorMonth: due.getMonth() + 1, dueDate: W.freq === "once" ? W.due : null, startDate: W.freq === "once" ? null : W.due.slice(0, 8) + "01",
    autopay: W.autopay, active: true, payee: company, reference: W.reference || null, iban: W.iban || null, position: store.model.bills.length });
  const key = alignDue(bill, W.due), prev = (bill.dues || {})[key] || {};
  let docPath = prev.docPath || null;
  if (S.keep && S.file) { try { docPath = await attach(`billdoc-${bill.id}-${key}`, S.file); } catch (e) { S.busy = false; return msg("Couldn't keep the bill on this device: " + (e.message || e)); } }
  bill = store.put("bills", { ...bill, amount: W.usual ? W.amount : bill.amount, payee: bill.payee || company, reference: W.reference || bill.reference || null, iban: W.iban || bill.iban || null,
    dues: { ...(bill.dues || {}), [key]: { amount: W.amount, reference: W.reference || null, docPath } } });
  const o = occurrenceOf(bill, key);
  if (W.paid) markPaid(o);
  else if (o.paid && Math.abs(o.paid.amount - W.amount) >= 0.005) store.put("transactions", { ...o.paid, amount: W.amount });
  closeSheet(); S.busy = false;
  toast(`Added as a bill · ${bill.name} ${eur(W.amount)} ${W.paid ? "paid" : "due " + fmtDay(due)}`, { label: "Open", run: () => { location.hash = "#bills"; } });
}

/* ---------- Payments on a screen ---------- */
/* The same payment already in Koti: same day, same amount, same direction, and the same payee when both have one.
   A screenshot of a bank app is often taken again a day later; the second one shouldn't count twice. */
export function twinOf({ date, amount, payee, kind = "expense" }) {
  const p = low(payee).replace(/\s+(oy|oyj|ab)$/, "").trim();
  return store.model.transactions.find(t => t.date === date && Math.abs(t.amount - amount) < 0.005 && (kind === "income" ? t.kind === "income" : t.kind === "expense")
    && (!p || !t.payee || low(t.payee).includes(p) || p.includes(low(t.payee)))) || null;
}

/* A payment of one of your bills: the bill the reader named, or one whose payee or name matches, with an unpaid due date
   within three weeks of the payment. */
export function billPaymentFor(r) {
  const P = (r && r.parsed) || {}; if (!P.amount || P.moneyIn) return null;
  const bill = matchBill({ match: r.bill && r.bill.match, company: P.payee }, P); if (!bill) return null;
  const day = P.date || todayISO(), d = parseDay(day), near = o => Math.abs(parseDay(o.due) - d) <= 21 * 864e5;
  const from = periodFor(new Date(d.getFullYear(), d.getMonth() - 1, d.getDate())), to = periodFor(new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  const all = [...occurrences(from), ...occurrences(periodFor(d)), ...occurrences(to)].filter((o, i, xs) => o.bill.id === bill.id && !o.paid && !o.skipped && near(o) && xs.findIndex(x => x.bill.id === o.bill.id && x.due === o.due) === i);
  return all.sort((a, b) => Math.abs(a.amount - P.amount) - Math.abs(b.amount - P.amount) || Math.abs(parseDay(a.due) - d) - Math.abs(parseDay(b.due) - d))[0] || null;
}

/* Saves the payments ticked from a screenshot. Returns what was saved, for Undo. */
export function savePayments(list) {
  return list.map(p => store.put("transactions", { id: newId("tx"), date: p.date || todayISO(), amount: p.amount, kind: p.kind === "income" ? "income" : "expense",
    categoryId: p.kind === "income" ? null : p.categoryId || null, payee: p.payee || null, note: p.note || null, source: "receipt" }));
}

/* Several payments on one screenshot: each one to tick, with its category; ones already in Koti start unticked. */
function paymentsReview(S) {
  const r = S.r;
  // A payment whose day couldn't be read gets a day to pick on its row; it isn't saved as today.
  if (!S.pay) S.pay = r.payments.map(p => { const twin = p.date ? twinOf(p) : null; return { ...p, twin, on: !twin && (!p.date || p.date <= todayISO()) }; });
  openSheet({ title: "Payments", left: "Cancel", right: "Save", body: B => {
    const paint = () => {
      const on = S.pay.filter(p => p.on), out = on.filter(p => p.kind !== "income").reduce((a, p) => a + p.amount, 0), inn = on.filter(p => p.kind === "income").reduce((a, p) => a + p.amount, 0);
      B.innerHTML = `${kotiSays(r.reply)}
        <div class="rv-top"><div class="rv-big num">${eur(out)}</div>${S.file ? `<span class="scan-thumb">${thumb(S)}</span>` : ""}</div>
        <p class="rv-s">${on.length} of ${S.pay.length} payment${S.pay.length === 1 ? "" : "s"} ticked${inn ? ` · ${esc(eur(inn))} in` : ""}.</p>
        <div class="grp pays">${S.pay.map((p, k) => `<div class="row pay-row">
            <input type="checkbox" class="pay-on" data-k="${k}" ${p.on ? "checked" : ""} aria-label="${esc(`${p.payee || "Payment"}, ${eur(p.amount)}`)}">
            <span class="rt"><b>${esc(p.payee || (p.kind === "income" ? "Money in" : "Payment"))}</b><small>${p.date ? esc(fmtDay(parseDay(p.date))) : `<input type="date" class="inl pay-day" data-k="${k}" max="${todayISO()}" aria-label="When was this?">`}${p.note ? ` · ${esc(p.note)}` : ""}${p.twin ? " · already in Koti" : ""}${p.date > todayISO() ? " · not yet" : ""}</small>
              ${p.kind === "income" ? "" : `<select class="inl pay-cat" data-k="${k}" aria-label="Category">${cats().map(c => `<option value="${esc(c.id)}"${c.id === p.categoryId ? " selected" : ""}>${esc(c.name)}</option>`).join("")}<option value=""${p.categoryId ? "" : " selected"}>No category</option></select>`}</span>
            <b class="num">${p.kind === "income" ? "+" : ""}${eur(p.amount)}</b></div>`).join("")}</div>
        <p class="note ai-note">Read by AI${r.limit ? ` · ${r.used} of ${r.limit} scans today` : ""}. Untick any you don't want.</p>
        <p class="msg" id="pyMsg" aria-live="polite"></p>`;
    };
    B.addEventListener("change", e => { const k = Number(e.target.dataset.k); if (Number.isNaN(k)) return;
      if (e.target.classList.contains("pay-day")) { S.pay[k].date = e.target.value || null; if (S.pay[k].date) S.pay[k].twin = twinOf(S.pay[k]); }
      else if (e.target.classList.contains("pay-on")) S.pay[k].on = e.target.checked; else if (e.target.classList.contains("pay-cat")) S.pay[k].categoryId = e.target.value || null; paint(); });
    paint();
  }, onRight: B => {
    const on = S.pay.filter(p => p.on);
    if (!on.length) { const m = $("#pyMsg", B); m.textContent = "Tick at least one payment."; m.dataset.state = "error"; return; }
    if (on.some(p => !p.date)) { const m = $("#pyMsg", B); m.textContent = "Pick the day for each ticked payment."; m.dataset.state = "error"; return; }
    if (on.some(p => p.date > todayISO())) { const m = $("#pyMsg", B); m.textContent = "A payment dated after today can't be saved yet. Untick it."; m.dataset.state = "error"; return; }
    const saved = savePayments(on); closeSheet();
    on.forEach(p => { if (p.kind !== "income") learnFromSave({ read: { payee: p.payee, categoryId: p.readCategoryId }, saved: { payee: p.payee, categoryId: p.categoryId } }); });
    toast(`Saved ${saved.length} payment${saved.length === 1 ? "" : "s"}`, { label: "Undo", run: () => saved.forEach(t => store.remove("transactions", t.id)) });
  } });
}

/* "When was this?": the last week as days to tap, and a calendar. Shown when the day couldn't be read. */
function whenHTML(now = todayISO()) {
  const days = Array.from({ length: 7 }, (_, k) => { const d = new Date(parseDay(now)); d.setDate(d.getDate() - k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const label = (d, k) => k === 0 ? "Today" : k === 1 ? "Yesterday" : parseDay(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  return `<div class="when" role="group" aria-labelledby="whenQ"><p class="when-q" id="whenQ">When was this?</p>
    <div class="chips">${days.map((d, k) => `<button type="button" class="fchip" data-day="${d}">${esc(label(d, k))}</button>`).join("")}<button type="button" class="fchip" data-day="pick">Other day</button></div></div>`;
}
