// Floor plans and charts for the Setup view.
import { store, ZONES, ZONE_ORDER, zoneStats, projectItems, listOf, HOME_PROJECT } from "./data.js";
import { svgEl as el, showTip, hideTip, esc, eur, eur0, parseDay, fmtDay } from "./ui.js";
import { todayISO } from "./data.js";

/* ---------- Full floor plan (traced from the apartment drawing; plan units) ---------- */
export function drawFullPlan(svg, wrap, tip, selected, onPick) {
  svg.innerHTML = ""; hideTip(tip);
  const stats = zoneStats(), pts = a => a.map(p => p.join(",")).join(" ");
  const defs = el("defs", {}, svg);
  const hatch = el("pattern", { id: "hatch", width: "10", height: "10", patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("rect", { width: "3", height: "10", fill: "var(--line)" }, hatch);
  el("rect", { x: 80, y: 248, width: 580, height: 592, fill: "var(--paper)" }, svg);
  el("rect", { x: 85, y: 30, width: 560, height: 175, fill: stats.PARVEKE.total ? "var(--paper)" : "url(#hatch)" }, svg);
  const groups = [];
  ZONE_ORDER.forEach(code => {
    const z = ZONES[code], s = stats[code], p = s.total ? s.done / s.total : 0;
    const xs = z.poly.map(q => q[0]), ys = z.poly.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), top = Math.min(...ys), bot = Math.max(...ys);
    const g = el("g", { class: "room" + (selected === code ? " sel" : ""), tabindex: "0", role: "button", "aria-label": `${z.name}: ${s.total ? `${s.done} of ${s.total} bought` : "no list yet"}. Show its lists.` }, svg);
    el("polygon", { points: pts(z.poly), fill: "transparent" }, g);
    if (s.total) {
      const cp = el("clipPath", { id: "clip-" + code }, defs); el("polygon", { points: pts(z.poly) }, cp);
      const lv = el("g", { "clip-path": `url(#clip-${code})` }, g), lh = (bot - top) * p, ly = bot - lh;
      el("rect", { class: "level", x: x0, y: ly, width: x1 - x0, height: lh }, lv);
      if (p > 0 && p < 1) el("line", { class: "waterline", x1: x0, x2: x1, y1: ly, y2: ly }, lv);
    }
    groups.push([g, code, z, s, p]);
  });
  const dash = { fill: "none", stroke: "var(--muted)", "stroke-width": 1.5, "stroke-dasharray": "2 6", "stroke-linecap": "round" };
  el("polyline", { points: "80,530 240,530 240,840", ...dash }, svg);
  el("polyline", { points: "240,640 425,640", ...dash }, svg);
  const fx = el("g", { fill: "none", stroke: "var(--muted)", "stroke-width": 1.2, opacity: .8 }, svg);
  el("rect", { x: 82, y: 532, width: 52, height: 282 }, fx); el("path", { d: "M82 532 L134 590 M82 590 H134" }, fx);
  [[95,647],[121,647],[95,673],[121,673]].forEach(([cx, cy]) => el("circle", { cx, cy, r: 8 }, fx));
  el("rect", { x: 88, y: 738, width: 40, height: 28, rx: 3 }, fx);
  el("rect", { x: 441, y: 577, width: 216, height: 56 }, fx); el("path", { d: "M495 577 V633 M605 577 V633" }, fx);
  el("rect", { x: 276, y: 782, width: 146, height: 56 }, fx); el("path", { d: "M366 782 V838" }, fx);
  el("ellipse", { cx: 628, cy: 766, rx: 24, ry: 16 }, fx); el("rect", { x: 508, y: 792, width: 52, height: 34, rx: 3 }, fx);
  el("rect", { x: 444, y: 768, width: 56, height: 68, "stroke-dasharray": "4 4" }, fx);
  const holes = [[80,248,345,592],[438,248,222,387],[438,648,222,192],[425,265,13,80],[425,490,13,75],[425,675,13,75],[148,840,87,20],[290,205,93,43],[135,212,150,30],[472,212,128,30]];
  let d = "M60 205 H680 V860 H60 Z M68 15 H85 V205 H68 Z M645 15 H660 V205 H645 Z";
  holes.forEach(([x, y, w, h]) => d += ` M${x} ${y} h${w} v${h} h${-w} Z`);
  el("path", { d, fill: "var(--wall)", "fill-rule": "evenodd" }, svg);
  const win = el("g", { fill: "none", stroke: "var(--wall)", "stroke-width": 1.5 }, svg);
  [[135,212,150,30],[472,212,128,30]].forEach(([x, y, w, h]) => { el("rect", { x, y, width: w, height: h }, win); el("line", { x1: x, x2: x + w, y1: y + h / 2, y2: y + h / 2 }, win); });
  el("rect", { x: 85, y: 15, width: 560, height: 14 }, win); el("rect", { x: 357, y: 33, width: 20, height: 16, fill: "var(--wall)" }, svg);
  const dr = el("g", { fill: "none", stroke: "var(--wall)", "stroke-width": 1.5 }, svg);
  el("path", { d: "M383 205 V120 A85 85 0 0 0 298 205" }, dr); el("path", { d: "M148 860 V945 A87 87 0 0 1 235 860" }, dr); el("path", { d: "M425 675 H350 A75 75 0 0 0 425 750" }, dr);
  groups.forEach(([g, code, z, s, p]) => {
    svg.appendChild(g);
    const [lx, ly] = z.lab, plate = el("rect", { class: "plate", rx: 8 }, g);
    const a = el("text", { class: "rname", x: lx, y: ly }, g); a.textContent = z.label;
    el("tspan", { class: "rcode", dx: 8 }, a).textContent = code;
    if (s.total) { el("text", { class: "rpct", x: lx, y: ly + 34 }, g).textContent = Math.round(p * 100) + "%"; el("text", { class: "rcount", x: lx, y: ly + 56 }, g).textContent = `${s.done} of ${s.total} bought`; }
    else el("text", { class: "rcount", x: lx, y: ly + 24 }, g).textContent = s.lists.length ? "No items yet" : "No list yet";
    const tb = [...g.querySelectorAll("text")].map(n => n.getBBox());
    const bx0 = Math.min(...tb.map(b => b.x)), by0 = Math.min(...tb.map(b => b.y)), bx1 = Math.max(...tb.map(b => b.x + b.width)), by1 = Math.max(...tb.map(b => b.y + b.height));
    Object.entries({ x: bx0 - 8, y: by0 - 6, width: bx1 - bx0 + 16, height: by1 - by0 + 12 }).forEach(([k, v]) => plate.setAttribute(k, v));
    const show = () => { const sc = wrap.getBoundingClientRect().width / 640;
      const html = s.total ? `<b>${esc(z.name)}</b><br>${esc(s.lists.join(", "))}<br>${s.done} of ${s.total} bought · ${s.ess ? s.ess + " essential" + (s.ess > 1 ? "s" : "") + " left" : "no essentials left"}<br>${eur(s.spent)} spent` : `<b>${esc(z.name)}</b><br>No list yet. Add one in Home setup → ⋯ → Rooms.`;
      showTip(tip, html, (bx0 + (bx1 - bx0) / 2 - 50) * sc, (by0 - 13) * sc); };
    g.addEventListener("mouseenter", show); g.addEventListener("focus", show);
    g.addEventListener("mouseleave", () => hideTip(tip)); g.addEventListener("blur", () => hideTip(tip));
    g.addEventListener("click", () => onPick(code));
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(code); } });
  });
}

/* ---------- Compact plan for phones ---------- */
const MINI = { PARVEKE: [0, 0, 100, 17], OH: [0, 17, 58, 45], MH: [58, 17, 42, 45], K: [0, 62, 28, 38], ET: [28, 62, 30, 38], KPH: [58, 62, 42, 38] };
export function miniPlanHTML(selected) {
  const st = zoneStats();
  return ZONE_ORDER.map(code => {
    const [x, y, w, h] = MINI[code], s = st[code], z = ZONES[code], p = s.total ? s.done / s.total : 0;
    const label = s.total ? `${z.label}: ${s.done} of ${s.total} bought` : `${z.label}: ${s.lists.length ? "no items yet" : "no list yet"}`;
    return `<button type="button" class="z${s.total ? "" : " nolist"}" data-zone="${code}" aria-pressed="${selected === code}" aria-label="${esc(label)}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%">
      ${s.total ? `<i class="lv${p >= 1 ? " full" : ""}" style="height:${p * 100}%"></i>` : ""}
      <b>${esc(z.label)}</b>${s.total ? `<span>${Math.round(p * 100)}%</span>${code === "PARVEKE" ? "" : `<small class="num">${s.done}/${s.total}</small>`}` : `<span>${s.lists.length ? "No items yet" : "No list yet"}</span>`}</button>`;
  }).join("");
}

/* ---------- Spending over time ---------- */
function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find(k => n <= k) * p; }
export function drawLine(svg, wrap, tip, hintEl, pid = HOME_PROJECT) {
  svg.innerHTML = ""; hideTip(tip);
  const S = store.model.settings, P = listOf(pid) || {}, extra = Number(P.extraSpend) || 0, budget = Number(P.budget) || 0;
  const buys = projectItems(pid).filter(i => i.done && i.price > 0 && i.boughtAt).sort((a, b) => a.boughtAt.localeCompare(b.boughtAt));
  if (hintEl) hintEl.textContent = extra > 0 ? `Running total of item prices, starting from ${eur0(extra)} other spending` : "Running total of item prices";
  let empty = wrap.querySelector(".empty-chart");
  if (!buys.length) { svg.style.display = "none"; if (!empty) { empty = document.createElement("div"); empty.className = "empty-chart"; wrap.appendChild(empty); } empty.textContent = "Tick an item and add its price to start your spending line."; return; }
  svg.style.display = ""; if (empty) empty.remove();
  const days = []; buys.forEach(i => { const last = days[days.length - 1]; if (last && last.key === i.boughtAt) { last.add += i.price; last.items.push(i.name); } else days.push({ key: i.boughtAt, d: parseDay(i.boughtAt), add: i.price, items: [i.name] }); });
  let run = extra; days.forEach(p => { run += p.add; p.v = run; });
  const today = parseDay(todayISO());
  let x0 = days[0].d; if (S.movedIn) { const m = parseDay(S.movedIn); if (m < x0) x0 = m; }
  const lastDay = days[days.length - 1].d > today ? days[days.length - 1].d : today;
  const x1 = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1);
  if (x1 - x0 < 864e5 * 3) x0 = new Date(x1.getFullYear(), x1.getMonth(), x1.getDate() - 3);
  const W = Math.max(280, wrap.clientWidth), H = 220, m = { l: 50, r: 70, t: 14, b: 26 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const top = niceMax(Math.max(run, budget) * 1.08);
  const X = d => m.l + (d - x0) / (x1 - x0) * (W - m.l - m.r), Y = v => H - m.b - v / top * (H - m.t - m.b);
  const grid = el("g", { class: "gridl" }, svg), axis = el("g", { class: "axis" }, svg);
  for (let k = 0; k <= 4; k++) { const v = top * k / 4; el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, grid); el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, axis).textContent = eur0(v); }
  const span = Math.round((x1 - x0) / 864e5) - 1, maxT = W < 480 ? 3 : 6, step = Math.max(1, Math.ceil(span / (maxT - 1)));
  for (let k = 0; k <= span; k += step) { const d = new Date(x0.getFullYear(), x0.getMonth(), x0.getDate() + k), tx = X(d); el("text", { x: tx, y: H - 6, "text-anchor": k === 0 ? "start" : (W - m.r - tx < 30 ? "end" : "middle") }, axis).textContent = fmtDay(d); }
  if (budget > 0) { el("line", { x1: m.l, x2: W - m.r, y1: Y(budget), y2: Y(budget), stroke: "var(--amber)", "stroke-width": 2 }, svg); el("text", { x: W - m.r + 8, y: Y(budget) + 4, style: "font:12px var(--body);fill:var(--ink-2)" }, svg).textContent = "Budget"; }
  let d = `M${X(x0)} ${Y(extra)}`; days.forEach(p => { d += ` H${X(p.d)} V${Y(p.v)}`; }); const endX = X(x1); d += ` H${endX}`;
  el("path", { d: d + ` V${Y(0)} H${X(x0)} Z`, fill: "var(--spruce)", opacity: .1 }, svg);
  el("path", { d, fill: "none", stroke: "var(--spruce)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  el("circle", { cx: endX, cy: Y(run), r: 5, fill: "var(--spruce)", stroke: "var(--paper)", "stroke-width": 2 }, svg);
  const nearB = budget > 0 && Math.abs(Y(run) - Y(budget)) < 16;
  el("text", { x: endX + 10, y: Y(run) + (nearB ? (Y(run) > Y(budget) ? 16 : -8) : 4), style: "font:600 12px var(--body);fill:var(--ink);font-variant-numeric:tabular-nums" }, svg).textContent = eur0(run);
  const cross = el("line", { y1: m.t, y2: H - m.b, stroke: "var(--muted)", "stroke-width": 1, opacity: 0 }, svg);
  const dot = el("circle", { r: 5, fill: "var(--spruce)", stroke: "var(--paper)", "stroke-width": 2, opacity: 0 }, svg);
  const hit = el("rect", { x: m.l - 10, y: 0, width: W - m.l - m.r + 20, height: H, fill: "transparent" }, svg);
  const move = cx => { const b = svg.getBoundingClientRect(), s = b.width / W, mx = (cx - b.left) / s; let best = days[0]; days.forEach(p => { if (Math.abs(X(p.d) - mx) < Math.abs(X(best.d) - mx)) best = p; });
    const px = X(best.d), py = Y(best.v); cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("opacity", .5); dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("opacity", 1);
    const list = best.items.slice(0, 3).map(esc).join(", ") + (best.items.length > 3 ? ` and ${best.items.length - 3} more` : "");
    showTip(tip, `<b>${fmtDay(best.d)}</b> · +${eur(best.add)}<br>${list}<br>Total ${eur(best.v)}${budget > 0 ? ` of ${eur0(budget)}` : ""}`, Math.min(Math.max(px * s, 90), b.width - 90), py * s); };
  hit.addEventListener("mousemove", e => move(e.clientX)); hit.addEventListener("touchstart", e => move(e.touches[0].clientX), { passive: true });
  const off = () => { hideTip(tip); cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); };
  hit.addEventListener("mouseleave", off); hit.addEventListener("touchend", () => setTimeout(off, 1500));
}

/* ---------- Spending by room ---------- */
export function drawBars(svg, wrap, tip, pid = HOME_PROJECT) {
  svg.innerHTML = ""; hideTip(tip);
  const st = zoneStats(pid), rows = ZONE_ORDER.map(k => st[k]).filter(z => z.total).sort((a, b) => b.spent - a.spent);
  const W = Math.max(240, wrap.clientWidth), row = 34, H = rows.length * row + 4, lab = 96, valW = 64, bw = W - lab - valW, max = Math.max(...rows.map(r => r.spent), 1);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  rows.forEach((r, i) => { const y = i * row + 8, w = r.spent ? Math.max(4, r.spent / max * bw) : 0, g = el("g", {}, svg), z = ZONES[r.code];
    el("text", { x: 0, y: y + 12, style: "font:12px var(--body);fill:var(--ink-2)" }, g).textContent = z.label;
    if (w) el("path", { d: `M${lab} ${y} H${lab + w - 4} a4 4 0 0 1 4 4 V${y + 12} a4 4 0 0 1 -4 4 H${lab} Z`, fill: "var(--spruce)" }, g);
    el("text", { x: lab + w + (w ? 8 : 0), y: y + 12, style: "font:600 12px var(--body);fill:var(--ink);font-variant-numeric:tabular-nums" }, g).textContent = eur0(r.spent);
    const hit = el("rect", { x: 0, y: y - 8, width: W, height: row, fill: "transparent" }, g);
    hit.addEventListener("mousemove", () => { const s = svg.getBoundingClientRect().width / W; showTip(tip, `<b>${esc(z.name)}</b><br>${eur(r.spent)} across ${r.priced} priced item${r.priced === 1 ? "" : "s"}`, Math.max(lab + w / 2, 80) * s, y * s); });
    hit.addEventListener("mouseleave", () => hideTip(tip));
  });
  svg.setAttribute("aria-label", "Spending by room: " + rows.map(r => `${ZONES[r.code].label} ${eur0(r.spent)}`).join(", "));
}
