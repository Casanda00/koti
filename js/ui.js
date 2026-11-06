// Small UI helpers shared by all views: formatting, icons, sheets and toasts.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const eur = (n, d = 2) => new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0);
export const eur0 = n => eur(Math.round(Number(n) || 0), 0);
export const parseDay = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const fmtDay = d => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
/* The AI is working: a spinner (announced to screen readers), or a whole sheet's worth with what it's doing. */
export const spinner = (label = "Working…", cls = "") => `<span class="spinner ${cls}" role="status" aria-label="${esc(label)}"></span>`;
export const aiWait = (what, sub = "") => `<div class="ai-wait">${spinner(what, "lg")}<b>${esc(what)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
/* Koti speaking: the AI's own words about what it understood or found (or, without the AI, a sentence made from
   what the phone read). Shown in place of a fixed heading. */
export const kotiSays = text => text ? `<div class="ai-says" role="status"><span class="ai-mark" aria-hidden="true"><svg class="ic sm"><use href="#i-spark"/></svg></span><p>${esc(text)}</p></div>` : "";
export const icon = (name, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export function parseMoney(v) {
  let s = String(v ?? "").replace(/[€\s\u00a0]/g, "");
  if (s === "") return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");          // 1,234.50
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");          // 1,234
  else s = s.replace(",", ".");                                             // 24,90
  const n = Number(s); return isNaN(n) ? NaN : Math.max(0, Math.round(n * 100) / 100);
}
export const moneyField = n => (n == null || n === "" ? "" : "€" + (Number.isInteger(Number(n)) ? Number(n) : Number(n).toFixed(2)));
export function relTime(d) { if (!d) return ""; const s = Math.round((Date.now() - d) / 1000); if (s < 45) return "just now"; const m = Math.round(s / 60); if (m < 60) return m + " min ago"; const h = Math.round(m / 60); return h < 24 ? h + " h ago" : fmtDay(d); }
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Sheets ---------- */
let lastFocus = null, onCloseCb = null;
const layer = () => document.getElementById("layer");
export function openSheet({ title, left = "Cancel", right = null, rightDisabled = false, body, onRight, onClose }) {
  const L = layer(), S = document.getElementById("sheet");
  lastFocus = document.activeElement; onCloseCb = onClose || null;
  S.innerHTML = `<span class="grab" aria-hidden="true"></span>
    <div class="sh-head"><button type="button" class="l" data-close>${esc(left)}</button><h2 id="sheetTitle">${esc(title)}</h2>${right ? `<button type="button" class="r" ${rightDisabled ? "disabled" : ""}>${esc(right)}</button>` : "<span></span>"}</div>
    <div class="sh-body" style="display:grid;gap:12px"></div>`;
  const B = S.querySelector(".sh-body");
  if (typeof body === "string") B.innerHTML = body; else if (body) body(B);
  const R = S.querySelector(".sh-head .r");
  // One tap saves once: the button is held while saving, and freed again only if the sheet stays open (a
  // message to fix something). A second tap during that time does nothing.
  if (R && onRight) R.addEventListener("click", async () => {
    if (R.dataset.busy) return; R.dataset.busy = "1"; R.setAttribute("aria-disabled", "true");
    try { await onRight(B, R); } finally { setTimeout(() => { if (R.isConnected) { delete R.dataset.busy; R.removeAttribute("aria-disabled"); } }, 400); }
  });
  document.getElementById("toast").classList.remove("show");
  L.hidden = false; requestAnimationFrame(() => L.classList.add("open"));
  const f = B.querySelector("[autofocus]") || S.querySelector("button, input, select, textarea");
  setTimeout(() => f && f.focus({ preventScroll: true }), 60);
  return { body: B, right: R };
}
export function closeSheet() {
  const L = layer(); if (L.hidden) return;
  L.classList.remove("open");
  setTimeout(() => { L.hidden = true; document.getElementById("sheet").innerHTML = ""; if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }, reduceMotion() ? 0 : 230);
  const cb = onCloseCb; onCloseCb = null; if (cb) cb();
}
export function initSheets() {
  const L = layer();
  L.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", e => {
    if (L.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); }
    if (e.key === "Tab") { // keep focus inside the sheet
      const f = $$("button:not([disabled]), input, select, textarea, [tabindex='0']", document.getElementById("sheet")).filter(x => x.offsetParent !== null);
      if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // drag the grab handle down to close (phones)
  const S = document.getElementById("sheet"); let y0 = null;
  S.addEventListener("touchstart", e => { if (S.scrollTop <= 0 && e.target.closest(".grab, .sh-head")) y0 = e.touches[0].clientY; }, { passive: true });
  S.addEventListener("touchmove", e => { if (y0 == null) return; const dy = Math.max(0, e.touches[0].clientY - y0); S.style.transform = `translateY(${dy}px)`; }, { passive: true });
  S.addEventListener("touchend", e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; S.style.transform = ""; y0 = null; if (dy > 90) closeSheet(); });
}

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(msg, action) {
  const T = document.getElementById("toast");
  T.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  if (action) T.querySelector("button").onclick = () => { T.classList.remove("show"); action.run(); };
  T.classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => T.classList.remove("show"), action ? 6000 : 2600);
}

/* ---------- SVG ---------- */
const NS = "http://www.w3.org/2000/svg";
export function svgEl(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
export function showTip(t, html, x, y) { t.innerHTML = html; t.style.left = x + "px"; t.style.top = y + "px"; t.style.opacity = 1; }
export function hideTip(t) { if (t) t.style.opacity = 0; }
