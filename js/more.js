// More view: account, month settings, home setup settings, data tools, install help.
import { store, ZONES, ZONE_ORDER, sortedLists, itemsOf, toModel, seedModel, backupJSON, todayISO, roomsOf, listOf, HOME_PROJECT } from "./data.js";
import { $, $$, esc, eur, icon, parseMoney, moneyField, relTime, openSheet, closeSheet, toast } from "./ui.js";
import { sync, signIn, signUp, sendReset, setPassword, signOut, refresh, pendingCount } from "./sync.js";
import { openCategories, openReceiptsList } from "./money.js";
import { APP_VERSION } from "./version.js";

let root = null, installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });

const chev = icon("chev", "ic sm chev");
const days = (sel, extra = "") => extra + Array.from({ length: 28 }, (_, k) => k + 1).map(d => `<option value="${d}"${String(sel) === String(d) ? " selected" : ""}>${ord(d)}</option>`).join("");
const ord = d => d + (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");

export function mountMore(el) { root = el; renderMore(); }

export function renderMore() {
  if (!root) return;
  if (root.contains(document.activeElement) && document.activeElement.matches("input, select, textarea")) return; // don't disturb typing
  const S = store.model.settings, pend = pendingCount();
  let account;
  if (!sync.configured) account = `<div class="row"><span class="ico w">${icon("sync")}</span><span class="rt">Cloud sync is off<small>This copy of Koti saves on this device only.</small></span></div>`;
  else if (!sync.user) account = `<button type="button" class="row" data-open="auth"><span class="ico g">${icon("user")}</span><span class="rt">Sign in or create account<small>Keep your phone and computer in step</small></span>${chev}</button>`;
  else account = `<div class="row"><span class="ico g">${icon("user")}</span><span class="rt">${esc(sync.user.email)}<small>Signed in</small></span></div>
    <button type="button" class="row" data-act="refresh"><span class="ico ${sync.status === "error" ? "r" : "w"}">${icon("sync")}</span><span class="rt">${esc(sync.text)}${sync.lastSync && sync.status === "ok" ? ` · ${relTime(sync.lastSync)}` : ""}<small>${esc(sync.detail || (pend ? `${pend} change${pend === 1 ? "" : "s"} waiting to upload` : "Tap to check for changes now"))}</small></span></button>
    <button type="button" class="row" data-act="signout"><span class="rt danger">Sign out</span></button>`;

  const look = window.kotiTheme ? window.kotiTheme.get() : { palette: "koti", mode: "auto" };
  root.innerHTML = `
  <header class="vh"><div><h1>More</h1></div></header>
  <div class="gh"><h2>Account</h2></div>
  <div class="grp">${account}</div>

  <div class="gh"><h2>Your month</h2></div>
  <div class="grp">
    <label class="row"><span class="rt">Budget month starts</span><select class="inl" data-set="monthStart">${days(S.monthStart)}</select>${chev}</label>
    <label class="row"><span class="rt">Payday</span><select class="inl" data-set="payday">${days(S.payday, `<option value="last"${S.payday === "last" ? " selected" : ""}>Last day</option>`)}</select>${chev}</label>
    <a class="row" href="#income"><span class="rt">Income<small>Salary and other sources</small></span>${chev}</a>
  </div>
  <p class="note">Budgets uses these to show what's left until payday.</p>
  <div class="grp" style="margin-top:10px">
    <button type="button" class="row" data-open="categories"><span class="ico g">${icon("money")}</span><span class="rt">Categories and budgets<small>${store.model.categories.length} categories · ${eur(store.model.categories.reduce((a, c) => a + (Number(c.budget) || 0), 0)).replace(/\.00$/, "")} a month</small></span>${chev}</button>
    <label class="row"><span class="rt">Keep receipt photos<small>Off: scans are only read, the photo isn't stored</small></span><input type="checkbox" class="switch" data-set="keepReceipts" ${S.keepReceipts ? "checked" : ""}></label>
  </div>

  <div class="gh"><h2>Home setup</h2></div>
  <div class="grp">
    <a class="row" href="#list/proj-home-setup"><span class="rt">Budget and spending<small>Set on the Home setup project</small></span>${chev}</a>
    <label class="row"><span class="rt">Moved in</span><input class="inl" data-set="movedIn" type="date" value="${esc(S.movedIn || "")}"></label>
    <button type="button" class="row" data-open="lists"><span class="ico g">${icon("list")}</span><span class="rt">Home setup rooms<small>${roomsOf(HOME_PROJECT).length} room lists</small></span>${chev}</button>
    <button type="button" class="row" data-open="notes"><span class="ico a">${icon("note")}</span><span class="rt">Moving-in notes<small>${S.notes ? esc(S.notes.split("\n")[0].slice(0, 48)) : "Measurements, delivery times…"}</small></span>${chev}</button>
  </div>
  ${S.carriedSpend && (listOf(HOME_PROJECT) || {}).extraSpend ? `<p class="note warn">Your old spending total (${eur(listOf(HOME_PROJECT).extraSpend)}) is in the Home setup project's Other spending. Lower it as you add prices to items, so nothing is counted twice.</p>` : ""}

  <div class="gh"><h2>Data</h2></div>
  <div class="grp">
    <button type="button" class="row" data-open="receipts"><span class="ico a">${icon("cam")}</span><span class="rt">Receipts<small>${store.model.transactions.filter(t => t.receiptPath).length} saved</small></span>${chev}</button>
    <button type="button" class="row" data-open="sheets"><span class="ico g">${icon("table")}</span><span class="rt">Import from Google Sheets<small>Bring in your list from the earlier version</small></span>${chev}</button>
    <button type="button" class="row" data-act="export"><span class="ico w">${icon("down")}</span><span class="rt">Download backup</span></button>
    <button type="button" class="row" data-act="import"><span class="ico w">${icon("up")}</span><span class="rt">Restore from backup</span></button>
    <button type="button" class="row" data-act="reset"><span class="rt danger">Start over</span></button>
  </div>
  <input type="file" id="moFile" accept="application/json,.json" hidden>

  <div class="gh"><h2>Appearance</h2></div>
  <div class="grp">
    <label class="row"><span class="rt">Colours</span><select class="inl" data-look="palette">${[["koti", "Koti green"], ["clay", "Clay orange and peach"]].map(([v, t]) => `<option value="${v}"${look.palette === v ? " selected" : ""}>${t}</option>`).join("")}</select>${chev}</label>
    <label class="row"><span class="rt">Light or dark</span><select class="inl" data-look="mode">${[["auto", "Same as phone"], ["light", "Light"], ["dark", "Dark"]].map(([v, t]) => `<option value="${v}"${look.mode === v ? " selected" : ""}>${t}</option>`).join("")}</select>${chev}</label>
  </div>
  <p class="note">Saved on this device.</p>

  <div class="gh"><h2>App</h2></div>
  <div class="grp">
    <button type="button" class="row" data-act="update"><span class="ico w">${icon("sync")}</span><span class="rt">Check for updates<small>You're on version ${APP_VERSION}</small></span></button>
    <button type="button" class="row" data-open="install"><span class="ico g">${icon("phone")}</span><span class="rt">Add Koti to your home screen</span>${chev}</button>
  </div>
  <p class="note">Koti · version ${APP_VERSION} · your data lives in your own Supabase project.</p>`;

  $$("[data-look]", root).forEach(sel => sel.addEventListener("change", () => window.kotiTheme && window.kotiTheme.set(sel.dataset.look, sel.value)));
  $$("[data-set]", root).forEach(inp => inp.addEventListener("change", () => {
    const k = inp.dataset.set; let v = inp.type === "checkbox" ? inp.checked : inp.value;
    if (inp.dataset.money !== undefined) { v = parseMoney(v); if (Number.isNaN(v)) { toast("Type a number, like 450 or 24,90"); renderMore(); return; } }
    if (k === "monthStart") v = Number(v);
    if (k === "payday") v = v === "last" ? "last" : Number(v);
    if (k === "budget" || k === "extraSpend") v = v ?? 0;
    const patch = { [k]: v }; if (k === "extraSpend") patch.carriedSpend = false;
    store.updateSettings(patch);
  }));
}

export function bindMore() {
  document.addEventListener("click", e => {
    const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); const f = { auth: openAuth, lists: openLists, notes: openNotes, sheets: openSheetsImport, install: openInstall, categories: openCategories, receipts: openReceiptsList }[o.dataset.open]; if (f) f(); return; }
    const a = e.target.closest("[data-act]"); if (!a || !root || !root.contains(a)) return;
    ({ update: () => import("./update.js").then(m => m.checkForUpdate({ manual: true })), refresh: () => { toast("Checking for changes…"); refresh(); }, signout: doSignOut, export: doExport, import: () => $("#moFile", root).click(), reset: doReset })[a.dataset.act]?.();
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
  if (!confirm("Sign out on this device? Your list stays here, and syncs again when you sign back in.")) return;
  await signOut(); toast("Signed out");
}

/* ---------- Lists and rooms ---------- */
const roomOptions = sel => ZONE_ORDER.map(k => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(ZONES[k].name)}</option>`).join("");
function openLists() {
  openSheet({ title: "Home setup rooms", left: "Done", body: B => {
    const draw = () => {
      B.innerHTML = `<p class="note" style="margin-top:0">Choose where each list sits on your floor plan. Tap a name to rename it.</p>
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
function openNotes() {
  openSheet({ title: "Moving-in notes", left: "Done", body: `<textarea class="inp" id="noText" placeholder="Measurements, delivery times, things to remember…" aria-label="Moving-in notes">${esc(store.model.settings.notes || "")}</textarea><p class="note">Saved as you type and synced to your other devices.</p>`,
    onClose: () => {} });
  let t; $("#noText").addEventListener("input", e => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => store.updateSettings({ notes: v }), 500); });
}

/* ---------- Import from the earlier Google Sheets version ---------- */
function openSheetsImport() {
  let cfg = {}; try { cfg = JSON.parse(localStorage.getItem("kotiSheetsConfig") || "{}"); } catch {}
  openSheet({ title: "Import from Google Sheets", right: "Import", body: `
    <p class="note" style="margin-top:0">Brings in the list, prices, budget and notes from your Google Sheet. It replaces what's in Koti now, so do this once.</p>
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
function doReset() {
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
function openInstall() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  openSheet({ title: "Add to home screen", left: "Close", body: B => {
    if (standalone) { B.innerHTML = `<p class="msg">Koti is already installed on this device.</p>`; return; }
    if (installPrompt) { B.innerHTML = `<p class="msg">Install Koti so it opens full screen from its own icon and works without signal.</p><button type="button" class="btn primary" id="inGo">Install Koti</button>`;
      $("#inGo", B).onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; closeSheet(); }; return; }
    B.innerHTML = ios
      ? `<ol class="steps"><li>Open Koti in <b>Safari</b>.</li><li>Tap the <b>Share</b> button at the bottom of the screen.</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="note">Sign in once inside the installed app: it keeps its own sign-in separate from Safari.</p>`
      : `<ol class="steps"><li>Open Koti in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li></ol>`;
  } });
}
