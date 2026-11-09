// Settings: profile, money, scanning, reminders, appearance, data and app. Home setup things live in the project's menu.
import { store, ZONES, ZONE_ORDER, sortedLists, itemsOf, toModel, seedModel, backupJSON, todayISO, roomsOf, listOf, HOME_PROJECT } from "./data.js";
import { $, $$, esc, eur, icon, parseMoney, moneyField, relTime, openSheet, closeSheet, toast } from "./ui.js";
import { aiAllowed, openPrivacy } from "./privacy.js";
import { sync, signIn, signUp, sendReset, setPassword, signOut, refresh, pendingCount, failedChanges, retryFailed, dropFailed } from "./sync.js";
import { openCategories, openReceiptsList, openStartBalance } from "./money.js";
import { startPoint } from "./ledger.js";
import { APP_VERSION } from "./version.js";

let root = null;

const chev = icon("chev", "ic sm chev");
const days = (sel, extra = "") => extra + Array.from({ length: 28 }, (_, k) => k + 1).map(d => `<option value="${d}"${String(sel) === String(d) ? " selected" : ""}>${ord(d)}</option>`).join("");
const ord = d => d + (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");

export function mountMore(el) { root = el; renderMore(); }

/* One line for You: how many reminders of your own, and what comes next. */
function remSummary() {
  const n = store.model.reminders.filter(r => r.active).length;
  return n ? `${n} of your own, plus Koti's` : "Bills, payday, budgets and your own";
}
const COLOURS = ["#16794f", "#b55334", "#c7841a", "#3a6ea5", "#7a4f9e", "#23302b"];
const PALETTES = [["koti", "Lake", "#2442D6", "#F7F8F6"], ["clay", "Clay", "#b55334", "#faf1e8"]];
export function renderMore() {
  if (!root) return;
  if (root.contains(document.activeElement) && document.activeElement.matches("input, select, textarea")) return; // don't disturb typing
  const S = store.model.settings, pend = pendingCount(), st = startPoint(), look = window.kotiTheme ? window.kotiTheme.get() : { palette: "koti", mode: "light" };
  const name = (S.name || "").trim(), initial = name ? esc(name[0].toUpperCase()) : icon("user", "ic");
  const syncLine = !sync.configured ? "Saved on this device only" : !sync.user ? "Not signed in" : `${esc(sync.text)}${sync.lastSync && sync.status === "ok" ? ` · ${relTime(sync.lastSync)}` : ""}${pend ? ` · ${pend} waiting` : ""}`;
  const profile = sync.configured && !sync.user
    ? `<button type="button" class="prof" data-open="auth"><span class="avatar big"${S.avatarColor ? ` style="background:${esc(S.avatarColor)}"` : ""}>${initial}</span><span class="pt"><b>${name ? esc(name) : "Sign in or create account"}</b><small>Keep your phone and computer in step</small></span>${chev}</button>`
    : `<button type="button" class="prof" data-open="profile"><span class="avatar big"${S.avatarColor ? ` style="background:${esc(S.avatarColor)}"` : ""}>${initial}</span><span class="pt"><b>${name ? esc(name) : "Add your name"}</b><small>${sync.user ? esc(sync.user.email) : "This device"}</small><span class="okline" data-state="${esc(sync.status || "")}">${syncLine}</span></span>${chev}</button>`;
  const scanOpts = [["auto", "Sorted by Koti"], ["spending", "Everyday spending"], ["bill", "A bill"]];

  const keepY = window.scrollY;   // redraws must not move the page
  root.innerHTML = `
  <header class="vh"><div><a class="back" href="#now">${icon("chev", "ic sm flip")} Now</a><h1>You</h1></div></header>
  ${profile}

  ${keptAsideHTML()}
  <div class="gh"><h2>Money</h2></div>
  <div class="grp">
    <button type="button" class="row" data-open="start"><span class="ico g">${icon("wallet")}</span><span class="rt">Starting balance<small>${st.set ? `${eur(st.amount)} at the start of ${esc(new Date(st.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))} · carried each month` : "Not set: counting from €0"}</small></span>${chev}</button>
    <label class="row"><span class="ico w">${icon("clock")}</span><span class="rt">Budget month starts</span><select class="inl" data-set="monthStart">${days(S.monthStart)}</select>${chev}</label>
  </div>
  <p class="note">Categories, budgets and carry over are in Month → Budgets.</p>

  <div class="gh"><h2>Koti's AI</h2></div>
  <div class="grp">
    <button type="button" class="row" data-ask-koti><span class="ico g">${icon("spark")}</span><span class="rt">Talk to Koti<small>Ask or tell it what to add</small></span>${chev}</button>
    <button type="button" class="row" data-open="memory"><span class="ico w">${icon("note")}</span><span class="rt">What Koti remembers<small>${(S.memory || []).length ? `${(S.memory || []).length} thing${(S.memory || []).length === 1 ? "" : "s"}` : "Nothing yet"}</small></span>${chev}</button>
    <label class="row"><span class="rt">Koti answers out loud<small>When you speak to it</small></span><input type="checkbox" class="switch" data-set="kotiSpeaks" ${S.kotiSpeaks !== false ? "checked" : ""}></label>
    <button type="button" class="row" data-open="privacy"><span class="ico w">${icon("lock")}</span><span class="rt">Privacy<small>${aiAllowed() ? "AI on" : "AI off"} · no cookies</small></span>${chev}</button>
    <label class="row"><span class="rt">First choice when scanning</span><select class="inl" data-set="scanDefault">${scanOpts.map(([v, t]) => `<option value="${v}"${(S.scanDefault || "auto") === v ? " selected" : ""}>${t}</option>`).join("")}</select>${chev}</label>
    <label class="row"><span class="rt">Keep receipt photos<small>Off: receipts are read, the photo isn't stored</small></span><input type="checkbox" class="switch" data-set="keepReceipts" ${S.keepReceipts ? "checked" : ""}></label>
    <label class="row"><span class="rt">Keep bill documents<small>Off: bills are read, the document isn't stored</small></span><input type="checkbox" class="switch" data-set="keepBills" ${S.keepBills ? "checked" : ""}></label>
    <div class="row"><span class="rt">AI uses today<small>Scans, the microphone, talking to Koti and today's note together</small></span><span class="rv num" id="moAiUse">–</span></div>
  </div>
  <p class="note">With the AI on, what you share goes to OpenAI.</p>

  <div class="gh"><h2>Reminders</h2></div>
  <div class="grp"><a class="row" href="#reminders"><span class="ico g">${icon("bell")}</span><span class="rt">Reminders<small>${remSummary()}</small></span>${chev}</a></div>

  <div class="gh"><h2>Appearance</h2></div>
  <div class="swatches" role="radiogroup" aria-label="Colours">${PALETTES.map(([v, t, a, b]) => `<button type="button" class="swt" role="radio" aria-checked="${look.palette === v}" data-palette="${v}"><span class="sw2" style="background:linear-gradient(135deg,${a} 50%,${b} 50%)"></span><b>${t}</b></button>`).join("")}</div>
  <div class="seg" id="moMode" aria-label="Light or dark">${[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([v, t]) => `<button type="button" data-mode="${v}" aria-pressed="${look.mode === v}">${t}</button>`).join("")}</div>

  <div class="gh"><h2>Your data</h2></div>
  <div class="grp">
    <button type="button" class="row" data-open="receipts"><span class="rt">Receipts and bills<small>${store.model.transactions.filter(t => t.receiptPath).length + store.model.bills.reduce((a, b) => a + Object.values(b.dues || {}).filter(x => x.docPath).length, 0)} saved</small></span>${chev}</button>
    <button type="button" class="row" data-act="export"><span class="rt">Download a backup</span>${chev}</button>
    <button type="button" class="row" data-act="import"><span class="rt">Restore from a backup</span>${chev}</button>
    <button type="button" class="row" data-open="sheets"><span class="rt">Import from the old Google Sheets version</span>${chev}</button>
  </div>
  <input type="file" id="moFile" accept="application/json,.json" hidden>

  <div class="gh"><h2>App</h2></div>
  <div class="grp">
    <button type="button" class="row" data-act="update"><span class="rt">Version ${APP_VERSION}<small>Tap to check for updates</small></span><span class="rv lnk">Check</span></button>
    <button type="button" class="row" data-open="install"><span class="rt">Add Koti to your home screen</span>${chev}</button>
  </div>
  ${sync.user ? `<div class="grp" style="margin-top:14px"><button type="button" class="row" data-act="signout"><span class="rt danger">Sign out</span></button></div>` : ""}
  <p class="note">Koti · your data lives in your own Supabase project.</p>`;

  $$("[data-set]", root).forEach(inp => inp.addEventListener("change", () => {
    const k = inp.dataset.set; let v = inp.type === "checkbox" ? inp.checked : inp.value;
    if (k === "monthStart") v = Number(v);
    store.updateSettings({ [k]: v });
  }));
  $$("[data-palette]", root).forEach(b => b.onclick = () => setLook({ palette: b.dataset.palette }));
  $$("[data-mode]", root).forEach(b => b.onclick = () => setLook({ mode: b.dataset.mode }));
  aiUse().then(t => { const e = $("#moAiUse", root); if (e && t) e.textContent = t; });
  if (keepY && !root.hidden) window.scrollTo(0, keepY);
}
/* Colours and light/dark: applied on this device right away, and synced so your other devices follow. */
function setLook(patch) {
  if (patch.palette) { window.kotiTheme && window.kotiTheme.set("palette", patch.palette); $$("[data-palette]", root).forEach(b => b.setAttribute("aria-checked", b.dataset.palette === patch.palette)); }
  if (patch.mode) { window.kotiTheme && window.kotiTheme.set("mode", patch.mode); $$("[data-mode]", root).forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === patch.mode)); }
  const y = window.scrollY; store.updateSettings(patch); requestAnimationFrame(() => window.scrollTo(0, y));
}
async function aiUse() {
  if (!sync.client || !sync.user) return "Sign in to use AI";
  try { const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(new Date());   // the AI day runs on Helsinki time
    const { data, error } = await sync.client.from("ai_usage").select("count").eq("day", day); if (error) return null; let lim = 30; try { lim = Number(localStorage.getItem("koti.aiLimit")) || 30; } catch {} return `${(data && data[0] && data[0].count) || 0} of ${lim}`; } catch { return null; }
}

/* ---------- Profile ---------- */
function openProfile() {
  const S = store.model.settings;
  let colour = S.avatarColor || COLOURS[0];
  openSheet({ title: "Profile", right: "Done", left: "Cancel", body: B => {
    const paint = () => {
      const n = $("#prName", B) ? $("#prName", B).value : S.name || "";
      $("#prAv", B).textContent = n.trim() ? n.trim()[0].toUpperCase() : "?"; $("#prAv", B).style.background = colour;
      $$("[data-col]", B).forEach(x => x.setAttribute("aria-checked", x.dataset.col === colour));
    };
    B.innerHTML = `<div class="avwrap"><span class="avatar huge" id="prAv"></span><div class="avcols" role="radiogroup" aria-label="Colour">${COLOURS.map(c => `<button type="button" role="radio" data-col="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join("")}</div></div>
      <div class="grp">
        <label class="row"><span class="rt">Name</span><input class="inl" id="prName" value="${esc(S.name || "")}" placeholder="Your first name" maxlength="40" autocomplete="given-name" style="max-width:60%"></label>
        ${sync.user ? `<div class="row"><span class="rt">Email</span><span class="rv">${esc(sync.user.email)}</span></div>
        <button type="button" class="row" id="prPw"><span class="rt">Change password</span>${chev}</button>` : ""}
      </div>
      <p class="note">Shown in greetings and on lists you send.</p>`;
    $("#prName", B).addEventListener("input", paint);
    $(".avcols", B).onclick = e => { const x = e.target.closest("[data-col]"); if (x) { colour = x.dataset.col; paint(); } };
    const pw = $("#prPw", B); if (pw) pw.onclick = () => { closeSheet(); setTimeout(openNewPassword, 260); };
    paint();
  }, onRight: B => { store.updateSettings({ name: $("#prName", B).value.trim().slice(0, 40), avatarColor: colour }); closeSheet(); toast("Saved"); } });
}

/* Data from before signing in, and changes the server refused: shown so nothing is lost without a choice. */
function keptAsideHTML() {
  const before = store.beforeSignIn(), failed = failedChanges();
  const count = m => [["transactions", "expense"], ["bills", "bill"], ["income", "income source"], ["goals", "goal"], ["reminders", "reminder"]].map(([k, w]) => m[k].length ? `${m[k].length} ${w}${m[k].length === 1 ? "" : "s"}` : "").filter(Boolean).join(", ");
  let h = "";
  if (before && sync.user) h += `<div class="grp kept"><div class="row"><span class="rt">From before you signed in<small>${esc(count(before) || "Lists and settings")} on this device, not in this account</small></span></div>
    <div class="row btns"><button type="button" class="pill" data-act="addBefore">Add to this account</button><button type="button" class="pill ghost" data-act="dropBefore">Remove</button></div></div>`;
  if (failed.length) h += `<div class="grp kept">${failed.map(f => `<div class="row"><span class="rt">${esc(f.obj ? (f.obj.payee || f.obj.name || f.obj.title || f.kind) : f.kind)} couldn't be saved<small>${esc(f.error)}</small></span><button type="button" class="pill" data-retry="${esc(f.kind)}|${esc(f.id)}">Try again</button><button type="button" class="pill ghost" data-dropf="${esc(f.kind)}|${esc(f.id)}">Keep here only</button></div>`).join("")}</div>`;
  return h ? `<div class="gh"><h2>Needs a decision</h2></div>${h}` : "";
}
export function bindMore() {
  document.addEventListener("click", e => {
    const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); const f = { auth: openAuth, lists: openLists, notes: openNotes, sheets: openSheetsImport, install: openInstall, categories: openCategories, receipts: openReceiptsList, profile: openProfile, start: openStartBalance, memory: () => import("./koti.js").then(m => m.openMemory()), privacy: openPrivacy }[o.dataset.open]; if (f) f(); return; }
    const rt = e.target.closest("[data-retry]"); if (rt && root && root.contains(rt)) { const [k, id] = rt.dataset.retry.split("|"); retryFailed(k, id); toast("Trying again"); renderMore(); return; }
    const df = e.target.closest("[data-dropf]"); if (df && root && root.contains(df)) { const [k, id] = df.dataset.dropf.split("|"); dropFailed(k, id); toast("Kept on this device only"); renderMore(); return; }
    const a = e.target.closest("[data-act]"); if (!a || !root || !root.contains(a)) return;
    ({ update: () => import("./update.js").then(m => m.checkForUpdate({ manual: true })), refresh: () => { toast("Checking for changes…"); refresh(); }, signout: doSignOut, export: doExport,
      addBefore: () => { const n = store.addBeforeSignIn(); toast(n ? `Added ${n} record${n === 1 ? "" : "s"} to this account` : "Nothing new to add"); renderMore(); },
      dropBefore: () => { if (!confirm("Remove what was on this device before you signed in? It isn't in this account.")) return; store.dropBeforeSignIn(); renderMore(); }, import: () => $("#moFile", root).click(), reset: doReset })[a.dataset.act]?.();
  });
  document.addEventListener("change", async e => {
    if (e.target.id !== "moFile") return; const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const m = toModel(JSON.parse(await f.text())); if (!confirm("Replace everything with this backup? Other signed-in devices will update too.")) return; store.replaceAll(m); toast("Backup restored"); }
    catch { toast("That file isn't a Koti backup."); }
  });
}

/* ---------- Account ---------- */
export function openAuth(mode = "in") {
  openSheet({
    title: mode === "up" ? "Create account" : "Sign in",
    body: B => {
      B.innerHTML = `
        <div class="field"><label for="auEmail">Email</label><input class="inp" id="auEmail" type="email" autocomplete="email" inputmode="email" spellcheck="false" autofocus></div>
        <div class="field"><label for="auPass">Password</label><input class="inp" id="auPass" type="password" autocomplete="${mode === "up" ? "new-password" : "current-password"}" minlength="8"></div>
        <p class="msg" id="auMsg" aria-live="polite">${mode === "up" ? "Use at least 8 characters. You'll get an email to confirm the address." : ""}</p>
        <div class="btns">
          <button type="button" class="btn primary" id="auGo">${mode === "up" ? "Create account" : "Sign in"}</button>
          <button type="button" class="btn" id="auSwitch">${mode === "up" ? "I already have an account" : "Create an account"}</button>
          ${mode === "in" ? `<button type="button" class="btn" id="auForgot" style="background:none;color:var(--spruce)">Forgot password?</button>` : ""}
        </div>`;
      const msg = (t, st = "") => { const m = $("#auMsg", B); m.textContent = t; m.dataset.state = st; };
      const go = async () => {
        const email = $("#auEmail", B).value.trim(), pw = $("#auPass", B).value, btn = $("#auGo", B);
        if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Type your email address.", "error");
        if (pw.length < 8) return msg("The password needs at least 8 characters.", "error");
        btn.disabled = true; msg(mode === "up" ? "Creating your account…" : "Signing in…");
        try {
          if (mode === "up") { const r = await signUp(email, pw); if (r.needsConfirm) { msg("Check your email and open the confirmation link. Then come back and sign in.", "ok"); btn.disabled = false; return; } }
          else await signIn(email, pw);
          closeSheet(); toast("Signed in. Syncing…");
        } catch (err) {
          const t = String(err.message || err);
          msg(/Invalid login/i.test(t) ? "Email or password doesn't match. Try again or reset your password." : /Email not confirmed/i.test(t) ? "Confirm your email first: open the link we sent you." : /already registered/i.test(t) ? "That email already has an account. Sign in instead." : /fetch|network/i.test(t) ? "Can't reach the server. Check your connection." : t, "error");
          btn.disabled = false;
        }
      };
      $("#auGo", B).onclick = go;
      $("#auPass", B).addEventListener("keydown", e => { if (e.key === "Enter") go(); });
      $("#auSwitch", B).onclick = () => { closeSheet(); setTimeout(() => openAuth(mode === "up" ? "in" : "up"), 260); };
      const fg = $("#auForgot", B); if (fg) fg.onclick = async () => {
        const email = $("#auEmail", B).value.trim(); if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Type your email first, then select Forgot password.", "error");
        try { await sendReset(email); msg("Check your email for a link to set a new password.", "ok"); } catch (err) { msg(String(err.message || err), "error"); }
      };
    },
  });
}
export function openNewPassword() {
  openSheet({ title: "New password", right: "Save", body: `<div class="field"><label for="npPass">New password</label><input class="inp" id="npPass" type="password" autocomplete="new-password" minlength="8" autofocus></div><p class="msg" id="npMsg" aria-live="polite">At least 8 characters.</p>`,
    onRight: async B => { const pw = $("#npPass", B).value; if (pw.length < 8) { $("#npMsg", B).dataset.state = "error"; return; }
      try { await setPassword(pw); closeSheet(); toast("Password updated"); } catch (err) { $("#npMsg", B).dataset.state = "error"; $("#npMsg", B).textContent = String(err.message || err); } } });
}
async function doSignOut() {
  const n = pendingCount();
  if (!confirm(n ? `${n} change${n === 1 ? " hasn't" : "s haven't"} reached your account yet. Sign out anyway? They stay on this device and upload when you sign back in.` : "Sign out on this device? Your data stays here, and syncs again when you sign back in.")) return;
  await signOut(); toast("Signed out");
}

/* ---------- Lists and rooms ---------- */
const roomOptions = sel => ZONE_ORDER.map(k => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(ZONES[k].name)}</option>`).join("");
export function openLists() {
  openSheet({ title: "Home setup rooms", left: "Done", body: B => {
    const draw = () => {
      B.innerHTML = `<p class="note" style="margin-top:0">Choose each list's room. Tap a name to rename it.</p>
        <div class="grp">${roomsOf(HOME_PROJECT).map(l => `<div class="row" data-l="${esc(l.id)}"><input class="inl" style="text-align:left;flex:1;max-width:none;color:var(--ink)" value="${esc(l.name)}" aria-label="List name" data-f="name" maxlength="120"><select class="inl" data-f="room" aria-label="Room for ${esc(l.name)}">${roomOptions(l.room)}</select><button type="button" class="x" data-f="del" aria-label="Delete ${esc(l.name)}" style="color:var(--muted);width:32px;height:32px">${icon("trash", "ic sm")}</button></div>`).join("")}</div>
        <div class="field" style="margin-top:6px"><label for="nlName">New list</label><input class="inp" id="nlName" placeholder="e.g. Balcony…" maxlength="120" autocomplete="off"></div>
        <div class="field"><label for="nlRoom">Room</label><select class="inp" id="nlRoom">${roomOptions("PARVEKE")}</select></div>
        <button type="button" class="btn primary" id="nlAdd">Add list</button>`;
      $$("[data-l]", B).forEach(r => {
        const id = r.dataset.l;
        $("[data-f=name]", r).addEventListener("change", e => { const v = e.target.value.trim(); if (v) store.updateList(id, { name: v }); else e.target.value = store.model.lists.find(l => l.id === id).name; });
        $("[data-f=room]", r).addEventListener("change", e => store.updateList(id, { room: e.target.value }));
        $("[data-f=del]", r).addEventListener("click", () => { const l = store.model.lists.find(x => x.id === id), n = itemsOf(id).length;
          if (n && !confirm(`Delete "${l.name}" and its ${n} items?`)) return; store.deleteList(id); draw(); });
      });
      $("#nlAdd", B).onclick = () => { const n = $("#nlName", B).value.trim(); if (!n) { $("#nlName", B).focus(); return; }
        if (roomsOf(HOME_PROJECT).some(l => l.name.toLowerCase() === n.toLowerCase())) { toast(`You already have a room list called "${n}"`); return; }
        store.addList(n, $("#nlRoom", B).value, { kind: "room", parentId: HOME_PROJECT }); toast(`Added ${n}`); draw(); };
    };
    draw();
  } });
}

/* ---------- Notes ---------- */
export function openNotes() {
  openSheet({ title: "Moving-in notes", left: "Done", body: `<textarea class="inp" id="noText" placeholder="Measurements, delivery times, things to remember…" aria-label="Moving-in notes">${esc(store.model.settings.notes || "")}</textarea><p class="note">Saved as you type and synced to your other devices.</p>`,
    onClose: () => {} });
  let t; $("#noText").addEventListener("input", e => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => store.updateSettings({ notes: v }), 500); });
}

/* ---------- Import from the earlier Google Sheets version ---------- */
function openSheetsImport() {
  let cfg = {}; try { cfg = JSON.parse(localStorage.getItem("kotiSheetsConfig") || "{}"); } catch {}
  openSheet({ title: "Import from Google Sheets", right: "Import", body: `
    <p class="note" style="margin-top:0">Replaces what's in Koti with your Google Sheet. Do it once.</p>
    <div class="field"><label for="gsUrl">Apps Script web app URL</label><input class="inp" id="gsUrl" type="url" spellcheck="false" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url || "")}"></div>
    <div class="field"><label for="gsTok">Shared secret</label><input class="inp" id="gsTok" type="password" spellcheck="false" autocomplete="off" value="${esc(cfg.token || "")}"></div>
    <p class="msg" id="gsMsg" aria-live="polite"></p>`,
    onRight: async (B, R) => {
      const url = $("#gsUrl", B).value.trim(), tok = $("#gsTok", B).value, msg = (t, s = "") => { $("#gsMsg", B).textContent = t; $("#gsMsg", B).dataset.state = s; };
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) return msg("Paste the web app URL ending in /exec.", "error");
      R.disabled = true; msg("Reading your sheet…");
      try {
        const u = new URL(url); u.searchParams.set("action", "get"); u.searchParams.set("token", tok);
        const r = await fetch(u, { redirect: "follow" }); const d = await r.json();
        if (d.ok === false) throw new Error(d.error || "Google didn't accept the request.");
        const m = toModel(d.state);
        if (!confirm(`Replace Koti's list with ${m.items.length} items from your sheet?`)) { R.disabled = false; msg(""); return; }
        store.replaceAll(m); closeSheet(); toast(`Imported ${m.items.length} items from Google Sheets`);
      } catch (err) { msg(/fetch|CORS|network/i.test(String(err)) ? "Couldn't reach your sheet. Check the URL and that the script is deployed for Anyone." : String(err.message || err), "error"); R.disabled = false; }
    } });
}

/* ---------- Backup and reset ---------- */
function doExport() {
  const blob = new Blob([backupJSON()], { type: "application/json" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `koti-backup-${todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function doReset() {
  if (!confirm("Start Home setup over with the original checklist? Its ticks, prices, your own items there and your notes are cleared everywhere you're signed in. Other lists, bills, goals, income and expenses stay.")) return;
  const seed = seedModel(), cur = store.model, old = listOf(HOME_PROJECT);
  const homeIds = new Set([HOME_PROJECT, ...roomsOf(HOME_PROJECT).map(r => r.id)]);
  const seedHome = seed.lists.filter(l => l.id === HOME_PROJECT || l.parentId === HOME_PROJECT), seedHomeIds = new Set(seedHome.map(l => l.id));
  const hp = seedHome.find(l => l.id === HOME_PROJECT); if (old && hp) { hp.budget = old.budget; hp.name = old.name; }
  const keepLists = cur.lists.filter(l => !homeIds.has(l.id) && !seedHomeIds.has(l.id));
  const keepIds = new Set(keepLists.map(l => l.id));
  // Only the Home setup lists and items are replaced; categories, expenses, bills, goals and income are left out so they stay as they are.
  store.replaceAll({ version: 3, lists: [...seedHome, ...keepLists], items: [...seed.items.filter(i => seedHomeIds.has(i.listId)), ...cur.items.filter(i => keepIds.has(i.listId))], settings: { ...cur.settings, notes: "" } });
  toast("Home setup started over");
}

/* ---------- Install ---------- */
function openInstall() { import("./install.js").then(m => m.openInstall()); }   // one place decides how this device installs
