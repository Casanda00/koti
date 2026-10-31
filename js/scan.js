// Scan or upload a receipt or a bill. You choose where it goes first (or let Koti decide),
// then check what Koti read before saving.
//   Everyday spending: each line goes to a category.
//   A shopping list:   lines tick off what was on the list; other lines go to a category.
//   A project:         lines tick off project items or become new items in a room; others go to a category.
//   A bill:            amount, due date, reference and account; matched to a bill you have, or a new one.
// Money is counted once: from the receipt or the bill. Items a receipt ticks don't add their price again.
import { store, todayISO, newId, listCategory, listOf, topLists, roomsOf, itemsOf, projectItems, projectSpent, projectOf } from "./data.js";
import { $, $$, esc, eur, eur0, icon, parseMoney, parseDay, fmtDay, openSheet, closeSheet, toast } from "./ui.js";
import { prepareFile, readReceipt, attach } from "./receipts.js";
import { catName } from "./money.js";
import { alignDue, occurrenceOf, markPaid, runAutopay, bindCopy, FREQ_LABEL } from "./plan.js";

const cats = () => store.model.categories.slice().sort((a, b) => a.position - b.position);
const keepDefault = kind => (kind === "bill" ? !!store.model.settings.keepBills : !!store.model.settings.keepReceipts);   // off unless switched on: storage costs
const destName = d => d.kind === "auto" ? "Let Koti decide" : d.kind === "spending" ? "Everyday spending" : d.kind === "bill" ? "Bill" : (listOf(d.id) || {}).name || "List";
const same = (a, b) => a && b && a.kind === b.kind && (a.id || null) === (b.id || null);
const money2 = n => String((Number(n) || 0).toFixed(2)).replace(".", ",");
const low = s => String(s || "").toLowerCase();
const FOOD = /grocer|eating|food|ruoka|lunch|dinner|restaurant|caf/i;

function destinations() {
  const out = [
    { kind: "auto", icon: "spark", name: "Let Koti decide", sub: "Koti reads it, then suggests where it goes" },
    { kind: "spending", icon: "money", name: "Everyday spending", sub: "Each line goes to a category" },
  ];
  topLists().forEach(l => {
    if (l.kind === "shopping") { const n = itemsOf(l.id).filter(i => !i.done).length; out.push({ kind: "list", id: l.id, icon: "list", name: l.name, sub: `List · ticks off what you bought${n ? ` · ${n} to buy` : ""}` }); }
    else if (l.kind === "project") { const left = l.budget ? l.budget - projectSpent(l.id) : null; out.push({ kind: "project", id: l.id, icon: "home", name: l.name, sub: `Project · ticks items or adds new ones${left != null ? ` · ${eur0(left)} left` : ""}` }); }
  });
  out.push({ kind: "bill", icon: "bill", name: "A bill", sub: "Amount, due date, reference and account" });
  return out;
}
/* Where you are decides the first choice: a list or project you're looking at, the bills screen, otherwise Let Koti decide. */
function contextDest() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === "bills") return { kind: "bill" };
  if (h.startsWith("list/")) { const l = listOf(h.slice(5)); if (!l) return null; const top = l.kind === "room" ? listOf(l.parentId) : l; if (top) return { kind: top.kind === "project" ? "project" : "list", id: top.id }; }
  return null;
}

/* ---------- Step 1: where should this go? ---------- */
export function openScan({ dest = null } = {}) {
  const pref = store.model.settings.scanDefault;
  const S = { dest: dest || contextDest() || { kind: ["spending", "bill"].includes(pref) ? pref : "auto" }, keep: null, keepTouched: false, file: null, r: null, suggestion: null, lines: null, linesFor: null, edits: {} };
  S.keep = keepDefault(S.dest.kind);
  pickSheet(S, false);
}

function pickSheet(S, after) {
  const opts = destinations().filter(d => !(after && d.kind === "auto"));
  if (after && S.dest.kind === "auto") S.dest = { kind: "spending" };
  openSheet({
    title: after ? "Where should this go?" : "Scan or upload", left: after ? "Cancel" : "Close", right: after ? "Next" : null,
    body: B => {
      const sug = after && S.suggestion;
      B.innerHTML = `
        ${sug ? `<div class="suggest">${icon("spark", "ic")}<div><b>Koti suggests: ${esc(destName(sug.dest))}</b><small>${esc(sug.reason)}</small></div></div>` : after ? "" : `<h3 class="lead">Where should this go?</h3>`}
        <div class="grp dests" role="radiogroup" aria-label="Where should this go?">${opts.map(d => `<button type="button" class="row dest" role="radio" data-k="${d.kind}" data-id="${esc(d.id || "")}" aria-checked="${same(d, S.dest)}">
          <span class="ico ${d.kind === "bill" ? "r" : d.kind === "project" ? "a" : "g"}">${icon(d.icon)}</span><span class="rt"><span>${esc(d.name)}${sug && same(d, sug.dest) ? ` <em class="tag">Suggested</em>` : ""}</span><small>${esc(d.sub)}</small></span><span class="radio" aria-hidden="true"></span></button>`).join("")}</div>
        ${after ? `<p class="note">You can change this on the next screen too: tap its title.</p>` : `
        <div class="grp"><label class="row"><span class="rt" id="scKeepLbl">Keep photo<small id="scKeepSub"></small></span><input type="checkbox" class="switch" id="scKeep" aria-labelledby="scKeepLbl"></label></div>
        <div class="scan-btns">
          <label class="btn primary" for="scCam">${icon("cam", "ic sm")} Take photo</label><input type="file" id="scCam" accept="image/*" capture="environment" class="sr">
          <label class="btn" for="scFile">${icon("up", "ic sm")} Upload a photo or PDF</label><input type="file" id="scFile" accept="image/*,application/pdf" class="sr">
        </div>
        <div id="scState"></div>`}
        <p class="msg" id="scMsg" aria-live="polite"></p>`;
      const paintKeep = () => { const k = $("#scKeep", B); if (!k) return; k.checked = S.keep; $("#scKeepSub", B).textContent = S.keep ? (S.dest.kind === "bill" ? "Saved privately with the bill" : "Saved privately with the expense") : "Only used for reading. Not saved."; };
      paintKeep();
      $(".dests", B).addEventListener("click", e => { const b = e.target.closest(".dest"); if (!b) return;
        S.dest = { kind: b.dataset.k, id: b.dataset.id || undefined };
        $$(".dest", B).forEach(x => x.setAttribute("aria-checked", x === b));
        if (!S.keepTouched) S.keep = keepDefault(S.dest.kind);
        paintKeep(); });
      const k = $("#scKeep", B); if (k) k.onchange = () => { S.keep = k.checked; S.keepTouched = true; paintKeep(); };
      const onFile = e => { const f = e.target.files[0]; e.target.value = ""; if (f) run(S, f, B); };
      ["#scCam", "#scFile"].forEach(id => { const i = $(id, B); if (i) i.addEventListener("change", onFile); });
    },
    onRight: () => review(S),
  });
}

async function run(S, file, B) {
  const st = $("#scState", B), msg = (t, s = "error") => { const m = $("#scMsg", B); m.textContent = t; m.dataset.state = s; };
  msg("", "");
  try {
    st.innerHTML = `<div class="scan-state"><div class="scan-thumb" id="scThumb"></div><div style="flex:1"><b id="scLbl">Preparing…</b><div class="meter" style="margin-top:8px"><i id="scBar" style="width:4%"></i></div></div></div>`;
    $$("input[type=file]", B).forEach(i => i.disabled = true);
    S.file = await prepareFile(file);
    $("#scThumb", st).innerHTML = S.file.type === "application/pdf" ? `<span class="pdf">PDF</span>` : `<img alt="" src="${URL.createObjectURL(S.file.blob)}">`;
    const hint = S.dest.kind === "bill" ? "bill" : S.dest.kind === "auto" ? null : "receipt";
    S.r = await readReceipt(S.file, (p, label) => { const l = $("#scLbl", st), b = $("#scBar", st); if (l) l.textContent = label; if (b) b.style.width = Math.round(p * 100) + "%"; }, hint);
    S.lines = null;
    if (S.dest.kind === "auto") {
      S.suggestion = suggest(S.r); S.dest = S.suggestion.dest;
      if (!S.keepTouched) S.keep = keepDefault(S.dest.kind);
      pickSheet(S, true);
    } else review(S);
  } catch (err) {
    st.innerHTML = ""; $$("input[type=file]", B).forEach(i => i.disabled = false);
    msg(String(err.message || err));
  }
}

/* ---------- Let Koti decide ---------- */
export function suggest(r) {
  if (r.docType === "bill") { const m = matchBill(r.bill || {}, r.parsed || {}); return { dest: { kind: "bill" }, reason: m ? `It's a bill, and it looks like your “${m.name}” bill.` : "It's a bill to pay, not a receipt." }; }
  const lines = (r.parsed && r.parsed.lines) || [];
  if (!lines.length) return { dest: { kind: "spending" }, reason: r.ai ? "No lines to match, so it goes to a category." : "Only the total could be read, so it goes to a category." };
  const tally = {};
  lines.forEach(l => { const it = l.itemId && store.model.items.find(i => i.id === l.itemId); if (!it) return; const top = projectOf(it.listId) || listOf(it.listId); if (top) tally[top.id] = (tally[top.id] || 0) + 1; });
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (best) { const l = listOf(best[0]), n = best[1]; return { dest: { kind: l.kind === "project" ? "project" : "list", id: l.id }, reason: `${n} line${n === 1 ? "" : "s"} match${n === 1 ? "es" : ""} items on ${l.name}.` }; }
  return { dest: { kind: "spending" }, reason: "Nothing on it matches your lists, so each line goes to a category." };
}

function review(S) { if (S.dest.kind === "bill") billReview(S); else receiptReview(S); }

/* Makes the sheet title a button that goes back to "Where should this go?" without scanning again. */
function titleButton(S, name) {
  const h = $("#sheetTitle"); if (!h) return;
  h.innerHTML = `<button type="button" class="dest-title" aria-label="${esc(name)}. Change where this goes">${esc(name)} <span aria-hidden="true">▾</span></button>`;
  $(".dest-title", h).onclick = () => { saveEdits(S); pickSheet(S, true); };
}
function saveEdits(S) {
  const g = id => { const e = document.getElementById(id); return e ? e.value : undefined; };
  S.edits = { ...S.edits, shop: g("rvShop") ?? S.edits.shop, date: g("rvDate") ?? S.edits.date, total: g("rvTotal") ?? S.edits.total };
  const k = document.getElementById("rvKeep"); if (k) S.keep = k.checked;
}

/* ---------- Receipt review (spending, a list or a project) ---------- */
const openOf = ids => store.model.items.filter(i => ids.has(i.listId) && !i.done);
const nameHit = (line, item) => [line.name, line.nameFi].filter(Boolean).some(n => { const a = low(n), b = low(item.name); return b.length > 2 && (a.includes(b) || b.includes(a.split(" ")[0]) && a.split(" ")[0].length > 2); });
function scopeIds(d) { return d.kind === "project" ? new Set([d.id, ...roomsOf(d.id).map(r => r.id)]) : d.kind === "list" ? new Set([d.id]) : new Set(); }
function roomsFor(pid) { const r = roomsOf(pid); return r.length ? r : [listOf(pid)]; }

/* Each line gets a target: "tick:<item>", "new:<room>", "cat:<category>" or "proj:<project>". */
function makeLines(d, src) {
  const scope = scopeIds(d), open = openOf(scope), used = new Set();
  const lines = (src || []).map(l => ({ name: l.name, nameFi: l.nameFi || null, qty: l.qty, price: l.price, categoryId: l.categoryId && !String(l.categoryId).startsWith("proj:") ? l.categoryId : null, aiItem: l.itemId, target: null }));
  if (d.kind === "spending") { lines.forEach(l => l.target = "cat:" + (l.categoryId || "")); return lines; }
  lines.forEach(l => {   // matched by AI, then by name
    let it = l.aiItem && open.find(i => i.id === l.aiItem && !used.has(i.id));
    if (!it) it = open.find(i => !used.has(i.id) && nameHit(l, i));
    if (it) { used.add(it.id); l.target = "tick:" + it.id; }
  });
  if (d.kind === "list") { lines.forEach(l => { if (!l.target) l.target = "cat:" + (l.categoryId || ""); }); return lines; }
  const rooms = roomsFor(d.id), count = {};
  lines.forEach(l => { if (l.target) { const it = store.model.items.find(i => "tick:" + i.id === l.target); if (it) count[it.listId] = (count[it.listId] || 0) + 1; } });
  const room = (Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [rooms[0].id])[0];
  lines.forEach(l => { if (!l.target) l.target = l.categoryId && FOOD.test(catName(l.categoryId)) ? "cat:" + l.categoryId : "new:" + room; });
  return lines;
}

function targetOptions(d, line, lines) {
  const taken = new Set(lines.filter(x => x !== line && x.target.startsWith("tick:")).map(x => x.target));
  const o = (v, t) => `<option value="${esc(v)}"${line.target === v ? " selected" : ""}${taken.has(v) ? " disabled" : ""}>${esc(t)}</option>`;
  const catGroup = label => `<optgroup label="${esc(label)}">${o("cat:", "No category")}${cats().map(c => o("cat:" + c.id, c.name)).join("")}</optgroup>`;
  if (d.kind === "spending") return catGroup("Category") + `<optgroup label="Project">${topLists().filter(l => l.kind === "project").map(p => o("proj:" + p.id, p.name)).join("")}</optgroup>`;
  const open = openOf(scopeIds(d)), cur = line.target.startsWith("tick:") ? store.model.items.find(i => "tick:" + i.id === line.target) : null;
  const items = cur && !open.includes(cur) ? [cur, ...open] : open;
  if (d.kind === "list") return `<optgroup label="Tick off on ${esc(listOf(d.id).name)}">${items.map(i => o("tick:" + i.id, "✓ " + i.name)).join("")}</optgroup>` + catGroup("Not on the list: category");
  const pr = listOf(d.id), roomName = id => (listOf(id) || {}).name || "";
  return `<optgroup label="Tick off in ${esc(pr.name)}">${items.map(i => o("tick:" + i.id, `✓ ${i.listId === pr.id ? "" : roomName(i.listId) + " · "}${i.name}`)).join("")}</optgroup>
    <optgroup label="New item in">${roomsFor(pr.id).map(r => o("new:" + r.id, r.id === pr.id ? pr.name : r.name)).join("")}</optgroup>` + catGroup(`Not for ${pr.name}: category`);
}
function lineSub(d, l) {
  const [k, v] = [l.target.slice(0, l.target.indexOf(":")), l.target.slice(l.target.indexOf(":") + 1)];
  const qty = l.qty && l.qty !== 1 ? `${String(l.qty).replace(".", ",")} × · ` : "";
  if (k === "tick") { const it = store.model.items.find(i => i.id === v); return qty + `✓ ticks “${it ? it.name : "item"}”`; }
  if (k === "new") return qty + `New item → ${(listOf(v) || {}).name || ""}`;
  if (k === "proj") return qty + `${(listOf(v) || {}).name || "Project"}`;
  return qty + (d.kind === "spending" ? (v ? catName(v) : "No category") : d.kind === "list" ? `Not on the list → ${v ? catName(v) : "no category"}` : `Not for the project → ${v ? catName(v) : "no category"}`);
}

function receiptReview(S) {
  const d = S.dest, r = S.r || {}, P = r.parsed || {};
  if (!S.lines || !same(S.linesFor, d)) { S.lines = makeLines(d, P.lines); S.linesFor = { ...d }; }
  const E = S.edits, name = destName(d);
  openSheet({ title: name, right: "Save", body: B => {
    B.innerHTML = `
      ${r.docType === "bill" ? `<div class="suggest warn">${icon("bill", "ic")}<div><b>This looks like a bill</b><small>Bills go to Bills with their due date and reference.</small></div><button type="button" class="btn sm" id="rvToBill">Add as a bill</button></div>` : ""}
      <div class="grp">
        <div class="row rc-row"><span class="scan-thumb">${S.file && S.file.type === "application/pdf" ? `<span class="pdf">PDF</span>` : S.file ? `<img alt="" src="${URL.createObjectURL(S.file.blob)}">` : ""}</span>
          <label class="rt" for="rvKeep">Keep photo<small id="rvKeepSub"></small></label><input type="checkbox" class="switch" id="rvKeep" ${S.keep ? "checked" : ""}></div>
        <label class="row"><span class="rt">Shop</span><input class="inl" id="rvShop" value="${esc(E.shop ?? P.payee ?? "")}" placeholder="Where" maxlength="120" autocomplete="off" style="max-width:60%"></label>
        <label class="row"><span class="rt">Date</span><input class="inl" id="rvDate" type="date" value="${esc(E.date ?? P.date ?? todayISO())}"></label>
        <label class="row"><span class="rt">Total</span><input class="inl num" id="rvTotal" inputmode="decimal" value="${esc(E.total ?? (P.amount != null ? money2(P.amount) : ""))}" placeholder="0,00" autocomplete="off" style="max-width:40%"></label>
      </div>
      <div id="rvLines"></div>
      <p class="msg" id="rvMsg" aria-live="polite"></p>`;
    titleButton(S, name);
    const keepSub = () => { $("#rvKeepSub", B).textContent = $("#rvKeep", B).checked ? "Saved privately with the expense" : "Only used for reading. Not saved."; };
    keepSub(); $("#rvKeep", B).onchange = keepSub;
    const tb = $("#rvToBill", B); if (tb) tb.onclick = () => { saveEdits(S); S.dest = { kind: "bill" }; if (!S.keepTouched) S.keep = true; billReview(S); };
    paintLines(S, B);
  }, onRight: B => saveReceipt(S, B) });
}

function paintLines(S, B) {
  const d = S.dest, L = $("#rvLines", B), lines = S.lines, r = S.r || {};
  const ticks = lines.filter(l => l.target.startsWith("tick:")).length, news = lines.filter(l => l.target.startsWith("new:")).length, outs = lines.filter(l => l.target.startsWith("cat:")).length;
  let note = r.ai ? `Read by AI${r.limit ? ` · ${r.used} of ${r.limit} scans today` : ""}` : r.aiError ? `Read on this device: total only. AI: ${r.aiError.message}` : "Read on this device: total only.";
  if (d.kind === "list") { const left = openOf(scopeIds(d)).length - ticks; note = `${ticks} list item${ticks === 1 ? "" : "s"} bought · ${Math.max(0, left)} still to buy`; }
  if (d.kind === "project") note = [`${ticks} item${ticks === 1 ? "" : "s"} ticked`, news ? `${news} new item${news === 1 ? "" : "s"}` : "", outs ? `${outs} line${outs === 1 ? "" : "s"} kept as everyday spending` : ""].filter(Boolean).join(" · ");
  if (!lines.length) { L.innerHTML = `<p class="note ai-note">${esc(note)}</p>${d.kind !== "spending" ? `<p class="note">No lines were read, so nothing gets ticked. The total goes to ${d.kind === "project" ? esc(listOf(d.id).name) : "a category"}.</p>` : ""}`; return; }
  const by = {};
  lines.forEach(l => { const k = bucket(d, l); by[k] = (by[k] || 0) + l.price; });
  const pr = d.kind === "project" ? listOf(d.id) : null;
  L.innerHTML = `<p class="note ai-note">${icon("check", "ic xs")} ${esc(note)}</p>
    <div class="gh" style="margin-top:4px"><h3>${lines.length} line${lines.length === 1 ? "" : "s"}</h3><span class="num">${eur(lines.reduce((a, l) => a + l.price, 0))}</span></div>
    <div class="grp lines">${lines.map((l, k) => `<div class="row li" data-line="${k}"><span class="rt">${esc(l.name)}<small>${l.nameFi && low(l.nameFi) !== low(l.name) ? `<i class="fi" lang="fi">${esc(l.nameFi)}</i> · ` : ""}${esc(lineSub(d, l))}</small>
      <select class="line-cat" aria-label="Where ${esc(l.name)} goes">${targetOptions(d, l, lines)}</select></span><span class="rv">${eur(l.price)}</span><button type="button" class="x" data-del-line aria-label="Remove ${esc(l.name)}">×</button></div>`).join("")}</div>
    <div class="splits">${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span><i style="background:var(${k.startsWith("proj:") ? "--amber" : "--spruce"})"></i>${esc(k === "none" ? "No category" : catName(k))} <b class="num">${eur(v)}</b>${pr && k === "proj:" + pr.id && pr.budget ? ` · ${eur0(pr.budget - projectSpent(pr.id) - v)} left` : ""}</span>`).join("")}</div>`;
  $$("[data-line]", L).forEach(row => { const k = Number(row.dataset.line);
    $(".line-cat", row).onchange = e => { lines[k].target = e.target.value; paintLines(S, B); };
    $("[data-del-line]", row).onclick = () => { lines.splice(k, 1); paintLines(S, B); }; });
}
/* Which total a line counts in. */
function bucket(d, l) {
  const [k, v] = [l.target.slice(0, l.target.indexOf(":")), l.target.slice(l.target.indexOf(":") + 1)];
  if (k === "proj") return "proj:" + v;
  if (d.kind === "project" && (k === "tick" || k === "new")) return "proj:" + d.id;
  if (k === "tick") { const lc = d.kind === "list" ? listCategory(listOf(d.id)) : null; return (lc && lc.id) || l.categoryId || "none"; }
  return v || "none";
}

async function saveReceipt(S, B) {
  const d = S.dest, msg = t => { const m = $("#rvMsg", B); m.textContent = t; m.dataset.state = "error"; };
  if (S.busy) return;
  const total = parseMoney($("#rvTotal", B).value), date = $("#rvDate", B).value || todayISO(), shop = $("#rvShop", B).value.trim(), keep = $("#rvKeep", B).checked;
  if (total == null || Number.isNaN(total) || total <= 0) return msg("Type the total, like 24,90.");
  if (d.kind !== "spending" && !listOf(d.id)) return msg("That list was deleted. Tap the title to choose another place.");
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
  const tx = store.put("transactions", { id, date, amount: total, kind: "expense", categoryId: main, payee: shop || null, note: null, source: "receipt", receiptPath, lines: txLines.length ? txLines : null });
  closeSheet(); S.busy = false;
  const ticks = before.length, news = created.length;
  const extra = [ticks ? `${ticks} ticked` : "", news ? `${news} new item${news === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  toast(`Saved ${eur(tx.amount)} to ${destName(d)}${extra ? " · " + extra : ""}`, { label: "Undo", run: () => {
    store.remove("transactions", tx.id);
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
      B.innerHTML = `
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
          <div class="grp"><label class="row"><span class="rt">Paid automatically<small>Direct debit or e-invoice: Koti marks it paid on the due date</small></span><input type="checkbox" class="switch" id="bvAuto" ${W.autopay ? "checked" : ""}></label></div>`}
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
  if (bill.autopay) runAutopay();
  closeSheet(); S.busy = false;
  toast(`Added as a bill · ${bill.name} ${eur(W.amount)} ${W.paid ? "paid" : "due " + fmtDay(due)}`, { label: "Open", run: () => { location.hash = "#bills"; } });
}
