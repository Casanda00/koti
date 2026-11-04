// Reads "remind me to pay water on the 15th" (or "muistuta maksamaan vesi 15. päivä") into a reminder to check
// and save. Understands: tomorrow, on <weekday>, on the 15th / on 15 November / 15.11., in 3 days, every <weekday>,
// every month on the 15th, on payday, on the last working day, N days before <bill>, and at 18 / at 6pm / klo 18.
const WD_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD_FI = ["sunnuntai", "maanantai", "tiistai", "keskiviikko", "torstai", "perjantai", "lauantai"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const wdIndex = w => { w = w.toLowerCase(); let i = WD_EN.findIndex(x => w.startsWith(x.slice(0, 3)) && x.startsWith(w.replace(/s$/, "").slice(0, 3))); if (i < 0) i = WD_FI.findIndex(x => w.startsWith(x.slice(0, 5))); return i; };

export const isReminderPhrase = t => /^\s*(remind me|muistuta)\b/i.test(t || "");

export function parseReminder(text, { bills = [], today = new Date() } = {}) {
  let s = String(text || "").trim().replace(/^\s*(remind me( to)?|muistuta( minua)?)\s*/i, "");
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const r = { when: "once", date: iso(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + 1)), hour: 9 };
  const cut = re => { const m = s.match(re); if (m) s = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim(); return m; };

  // time: at 18, at 18:30, at 6pm, klo 18
  let m = cut(/\b(?:at|klo|kello)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i);
  if (m) { let h = Number(m[1]); if (m[3] && m[3].toLowerCase() === "pm" && h < 12) h += 12; if (m[3] && m[3].toLowerCase() === "am" && h === 12) h = 0; if (h <= 23) r.hour = h; }

  if ((m = cut(/\b(\d{1,2})\s+days?\s+before\s+(.+?)(?:\s+is\s+due)?$/i)) || (m = cut(/\b(\d{1,2})\s+päivää\s+ennen\s+(.+)$/i))) {
    const name = m[2].toLowerCase().replace(/\b(the|my)\b/g, "").trim(), b = bills.find(x => name.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(name));
    Object.assign(r, { when: "before", beforeDays: Number(m[1]), aboutKind: name.includes("payday") || name.includes("palkka") ? "payday" : name.includes("month") || name.includes("kuu") ? "monthend" : b ? "bill" : "payday", aboutId: b ? b.id : null });
  } else if (cut(/\b(?:on|every)\s+payday\b|\bpalkkapäivänä\b/i)) Object.assign(r, { when: "monthly", monthDay: -2 });
  else if (cut(/\bon the last working day(?: of the month)?\b|\bkuun viimeisenä arkipäivänä\b/i)) Object.assign(r, { when: "monthly", monthDay: -1 });
  else if ((m = cut(/\bevery\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b|\bevery\s+(\d{1,2})(?:st|nd|rd|th)\b|\bjoka kuun\s+(\d{1,2})\.?\s*(?:päivä)?\b/i))) Object.assign(r, { when: "monthly", monthDay: Math.min(31, Number(m[1] || m[2] || m[3])) });
  else if ((m = cut(/\b(?:every|joka)\s+([a-zäö]+)\b/i)) && wdIndex(m[1]) >= 0) Object.assign(r, { when: "weekly", weekday: wdIndex(m[1]) });
  else if (cut(/\btomorrow\b|\bhuomenna\b/i)) r.date = iso(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + 1));
  else if (cut(/\btoday\b|\btänään\b/i)) r.date = iso(t0);
  else if ((m = cut(/\bin\s+(\d{1,2})\s+days?\b|\b(\d{1,2})\s+päivän\s+päästä\b/i))) r.date = iso(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + Number(m[1] || m[2])));
  else if ((m = cut(/\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:of\s+)?([a-z]+))?\b|\b(\d{1,2})\.(\d{1,2})?\.?(?:\s*päivä)?(?=\s|$)/i))) {
    const day = Number(m[1] || m[3]), mon = m[2] ? MONTHS.findIndex(x => x.startsWith(m[2].toLowerCase().slice(0, 3))) : m[4] ? Number(m[4]) - 1 : -1;
    let d = new Date(t0.getFullYear(), mon >= 0 ? mon : t0.getMonth(), day);
    if (d < t0) d = mon >= 0 ? new Date(t0.getFullYear() + 1, mon, day) : new Date(t0.getFullYear(), t0.getMonth() + 1, day);
    r.date = iso(d);
  } else if ((m = cut(/\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|maanantaina|tiistaina|keskiviikkona|torstaina|perjantaina|lauantaina|sunnuntaina)\b/i))) {
    const want = wdIndex(m[1]); let d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + 1); while (d.getDay() !== want) d.setDate(d.getDate() + 1); r.date = iso(d);
  }
  s = s.replace(/\s+/g, " ").replace(/^(to|that)\s+/i, "").replace(/[\s,.]+$/, "").trim();
  r.title = s ? s.charAt(0).toUpperCase() + s.slice(1) : "Reminder";
  return r;
}
