// A list someone shared with you: see it, tick things off, add items. Updates every few seconds.
// Works only through the token in the link; nothing else of the owner's is reachable.
(function () {
  const token = decodeURIComponent(location.hash.slice(1));
  const C = window.KOTI_CONFIG, el = document.getElementById("sh");
  const client = window.supabase.createClient(C.url, C.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qty = q => (q && q !== 1 ? `${String(q).replace(".", ",")} × ` : "");
  let data = null, showDone = false, busy = 0, timer = null;
  const toast = t => { const T = document.getElementById("toast"); T.textContent = t; T.classList.add("show"); setTimeout(() => T.classList.remove("show"), 2400); };

  async function load() {
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return gone();
    const { data: d, error } = await client.rpc("koti_share_view", { t: token });
    if (error) { if (!data) el.innerHTML = `<p class="gone">Couldn't load the list. Check your connection.</p>`; return; }
    if (!d) return gone();
    if (busy) return;   // don't overwrite a tick that's on its way
    data = d; render();
  }
  function gone() { clearInterval(timer); el.innerHTML = `<div class="gone"><h1 style="font-size:24px">This list isn't shared anymore</h1><p>Ask for a new link.</p></div>`; }

  // People who open a shared list are the likeliest to want their own Koti. Hidden for a week by "Not now".
  function ownCard() {
    let later = 0; try { later = Number(localStorage.getItem("koti.shareOwnLater")) || 0; } catch {}
    if (Date.now() < later) return `<p class="foot">Made with <a href="./?install=1">Koti</a></p>`;
    return `<section class="own" aria-labelledby="ownT"><div class="own-h"><span class="own-i" aria-hidden="true"><svg class="ic"><use href="#i-home"/></svg></span><div><h2 id="ownT">Get your own Koti</h2><p>Your money and your lists, on your Home Screen. Free.</p></div></div>
      <div class="own-b"><a class="own-go" href="./?install=1">Add Koti</a><button type="button" class="own-later" id="ownLater">Not now</button></div></section>`;
  }
  function render() {
    const todo = data.items.filter(i => !i.done), done = data.items.filter(i => i.done);
    const keep = document.getElementById("shAdd"), val = keep ? keep.value : "", focused = document.activeElement === keep;
    const row = i => `<div class="row item${i.done ? " done" : ""}"><button type="button" class="cb" role="checkbox" aria-checked="${i.done}" aria-label="${esc(i.name)} bought" data-id="${esc(i.id)}"><svg class="ic xs"><use href="#i-check"/></svg></button><span class="nm">${esc(qty(i.qty) + i.name)}${i.note ? `<small>${esc(i.note)}</small>` : ""}</span></div>`;
    document.title = `${data.name} · Koti`;
    el.innerHTML = `
      <h1>${esc(data.name)}</h1>
      <p class="sub"><span class="live" aria-hidden="true"></span>${data.owner ? `Shared by ${esc(data.owner)} · ` : ""}updates live</p>
      <div class="add-line" style="margin-top:14px"><label for="shAdd" class="sr">Add an item</label><input id="shAdd" placeholder="Add an item" autocomplete="off" enterkeyhint="done" maxlength="120" value="${esc(val)}"><button type="button" class="add-btn" id="shGo" aria-label="Add"><svg class="ic sm"><use href="#i-plus"/></svg></button></div>
      ${todo.length ? `<div class="gh"><h2>To buy</h2><span class="num">${todo.length}</span></div><div class="grp">${todo.map(row).join("")}</div>` : `<div class="empty">${done.length ? "Everything's bought. Nice." : "Nothing on the list yet."}</div>`}
      ${done.length ? `<div class="gh"><button type="button" class="link" id="shDone" aria-expanded="${showDone}">Bought · ${done.length} ${showDone ? "▾" : "▸"}</button></div>${showDone ? `<div class="grp">${done.map(row).join("")}</div>` : ""}` : ""}
      <p class="foot">Tick things off as you shop; the list updates for everyone.</p>
      ${ownCard()}`;
    if (focused) { const i = document.getElementById("shAdd"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  el.addEventListener("click", async e => {
    const cb = e.target.closest("[data-id]");
    if (cb) {
      const it = data.items.find(i => i.id === cb.dataset.id); if (!it) return;
      it.done = !it.done; busy++; render(); if (navigator.vibrate) navigator.vibrate(8);
      const { data: ok, error } = await client.rpc("koti_share_tick", { t: token, item: it.id, is_done: it.done });
      busy--; if (error || !ok) { toast("Couldn't save that. Try again."); it.done = !it.done; render(); }
      return;
    }
    if (e.target.closest("#shDone")) { showDone = !showDone; render(); return; }
    if (e.target.closest("#ownLater")) { try { localStorage.setItem("koti.shareOwnLater", String(Date.now() + 7 * 864e5)); } catch {} render(); return; }
    if (e.target.closest("#shGo")) add();
  });
  el.addEventListener("keydown", e => { if (e.target.id === "shAdd" && e.key === "Enter") { e.preventDefault(); add(); } });
  async function add() {
    const i = document.getElementById("shAdd"), names = i.value.split(/,|\n/).map(s => s.trim()).filter(Boolean); if (!names.length) return;
    i.value = ""; busy++;
    for (const n of names) { const { error } = await client.rpc("koti_share_add", { t: token, item_name: n }); if (error) { toast(/full/i.test(error.message) ? "The list is full." : "Couldn't add that. Try again."); break; } }
    busy--; toast(names.length === 1 ? `Added ${names[0]}` : `Added ${names.length} items`); load();
  }

  load();
  timer = setInterval(() => { if (!document.hidden) load(); }, 4000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  window.addEventListener("hashchange", () => location.reload());
})();
