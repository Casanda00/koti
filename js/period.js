// Picking a period: one button with a down arrow ("Today ⌄"), a short list under it, and Custom dates at the end.
// Used by Spent and by the payments receipt. A period is a key ("today", "yesterday", "week", "lastweek", "month",
// "lastmonth") or a custom range { k: "custom", from, to }.
import { $, $$, esc, parseDay } from "./ui.js";
import { todayISO } from "./data.js";
import { periodFor, shift } from "./money.js";

const mid = p => new Date((p.start.getTime() + p.end.getTime()) / 2);
export const monthName = (p = periodFor(new Date())) => mid(p).toLocaleDateString("en-GB", { month: "long" });
export const OPTIONS = () => [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["lastweek", "Last week"], ["month", monthName()], ["lastmonth", monthName(shift(periodFor(new Date()), -1))]];
const short = d => parseDay(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export function labelOf(sel) {
  if (sel && sel.k === "custom") return sel.from === sel.to ? short(sel.from) : `${short(sel.from)} – ${short(sel.to)}`;
  return (OPTIONS().find(o => o[0] === sel) || OPTIONS()[0])[1];
}

/* The button. Put it where the period's name goes; call bindPicker on its container. */
export const pickerHTML = (sel, text = labelOf(sel)) => `<span class="pk"><button type="button" class="pk-b" data-pk aria-haspopup="listbox" aria-expanded="false">${esc(text)}<svg class="ic sm" aria-hidden="true"><use href="#i-chev"/></svg></button></span>`;

export function bindPicker(root, sel, onPick) {
  const btn = $("[data-pk]", root); if (!btn) return;
  const wrap = btn.parentElement;
  const close = () => { const m = $(".pk-m", wrap); if (m) m.remove(); btn.setAttribute("aria-expanded", "false"); document.removeEventListener("click", outside, true); };
  const outside = e => { if (!wrap.contains(e.target)) close(); };
  btn.onclick = e => {
    e.stopPropagation();
    if ($(".pk-m", wrap)) { close(); return; }
    const cur = sel && sel.k === "custom" ? "custom" : sel;
    wrap.insertAdjacentHTML("beforeend", `<div class="pk-m" role="listbox" aria-label="Period">${OPTIONS().map(([k, t]) => `<button type="button" role="option" data-pko="${k}" aria-selected="${k === cur}">${esc(t)}${k === cur ? `<svg class="ic sm" aria-hidden="true"><use href="#i-check"/></svg>` : ""}</button>`).join("")}<button type="button" role="option" data-pko="custom" aria-selected="${cur === "custom"}">Custom dates…</button></div>`);
    btn.setAttribute("aria-expanded", "true");
    const m = $(".pk-m", wrap);
    $$("[data-pko]", m).forEach(o => o.onclick = ev => {
      ev.stopPropagation();
      if (o.dataset.pko !== "custom") { close(); onPick(o.dataset.pko); return; }
      const t = todayISO(), f = sel && sel.k === "custom" ? sel.from : periodFor(new Date()).from, to = sel && sel.k === "custom" ? sel.to : t;
      m.innerHTML = `<div class="pk-c"><b>Custom dates</b>
        <label>From<input type="date" id="pkFrom" value="${f}" max="${t}"></label>
        <label>To<input type="date" id="pkTo" value="${to}" max="${t}"></label>
        <button type="button" class="btn primary" id="pkGo">Show</button></div>`;
      $("#pkGo", m).onclick = ev2 => { ev2.stopPropagation(); let a = $("#pkFrom", m).value, b = $("#pkTo", m).value; if (!a || !b) return; if (b < a) [a, b] = [b, a]; close(); onPick({ k: "custom", from: a, to: b }); };
    });
    setTimeout(() => document.addEventListener("click", outside, true), 0);
    const first = $("[aria-selected=true]", m) || $("[data-pko]", m); if (first) first.focus();
  };
}
