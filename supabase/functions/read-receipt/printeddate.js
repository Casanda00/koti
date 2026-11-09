// A date as it's printed on a receipt, a bill or a screen, read into YYYY-MM-DD, relative to today.
// Receipts and banking apps often leave the year out ("SU 8.11.", "Eilen 14:32", "Mon"); a day without a year is the
// most recent such day that isn't after today (tomorrow is allowed, for time zones), never today by default.
// Until 9 November 2026 a receipt whose date the AI didn't return was saved on the day it was scanned.
// supabase/functions/read-receipt/printeddate.js is a copy (tests/dates.test.mjs fails until the two are the same).
//   printedDate("08.11.2026", today)   "2026-11-08"        printedDate("8.11.", "2026-11-09")     "2026-11-08"
//   printedDate("8.11.26", today)      "2026-11-08"        printedDate("Su 14:02", "2026-11-09")  "2026-11-08"
//   printedDate("eilen", "2026-11-09") "2026-11-08"        printedDate("8 Nov", "2026-11-09")    "2026-11-08"

const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const real = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const addDays = (s, n) => new Date(Date.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const weekdayOf = s => new Date(s + "T12:00:00Z").getUTCDay();

/* Weekday words, Sunday first: English, Finnish, Swedish, long and short. */
const WEEKDAYS = [
  ["sunday", "sun", "su", "sunnuntai", "sunnuntaina", "söndag", "sön", "sö"],
  ["monday", "mon", "mo", "maanantai", "maanantaina", "ma", "måndag", "mån", "må"],
  ["tuesday", "tue", "tues", "tu", "tiistai", "tiistaina", "ti", "tisdag", "tis"],
  ["wednesday", "wed", "we", "keskiviikko", "keskiviikkona", "ke", "onsdag", "ons", "on"],
  ["thursday", "thu", "thur", "thurs", "th", "torstai", "torstaina", "to", "torsdag", "tors", "tor"],
  ["friday", "fri", "fr", "perjantai", "perjantaina", "pe", "fredag", "fre"],
  ["saturday", "sat", "sa", "lauantai", "lauantaina", "la", "lördag", "lör", "lö"],
];
const MONTHS = [
  ["jan", "january", "tammi", "tammikuu", "tammikuuta", "januari"], ["feb", "february", "helmi", "helmikuu", "helmikuuta", "februari"],
  ["mar", "march", "maalis", "maaliskuu", "maaliskuuta", "mars"], ["apr", "april", "huhti", "huhtikuu", "huhtikuuta"],
  ["may", "touko", "toukokuu", "toukokuuta", "maj"], ["jun", "june", "kesä", "kesäkuu", "kesäkuuta", "juni"],
  ["jul", "july", "heinä", "heinäkuu", "heinäkuuta", "juli"], ["aug", "august", "elo", "elokuu", "elokuuta", "augusti"],
  ["sep", "sept", "september", "syys", "syyskuu", "syyskuuta"], ["oct", "october", "loka", "lokakuu", "lokakuuta", "okt", "oktober"],
  ["nov", "november", "marras", "marraskuu", "marraskuuta"], ["dec", "december", "joulu", "joulukuu", "joulukuuta", "dek"],
];
const monthOf = w => { const k = w.toLowerCase().replace(/\.$/, ""); const i = MONTHS.findIndex(names => names.includes(k)); return i < 0 ? null : i + 1; };

/* The most recent day/month not after the latest allowed day. */
function recent(d, m, today) {
  const latest = addDays(today, 1), y = +today.slice(0, 4);
  for (const yy of [y, y - 1]) if (real(yy, m, d) && iso(yy, m, d) <= latest) return iso(yy, m, d);
  return null;
}
/* A full date, as long as it isn't after tomorrow (a date ahead on a receipt is a misreading). */
const full = (y, m, d, today) => (real(y, m, d) && iso(y, m, d) <= addDays(today, 1) && y >= 1990 ? iso(y, m, d) : null);

export function printedDate(text, today) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  let m;
  if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t))) return full(+m[1], +m[2], +m[3], today);
  if ((m = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/.exec(t))) return full(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1], today);
  if ((m = /(?:^|[^\d.:])(\d{1,2})\.(\d{1,2})\.?(?![\d])/.exec(t)) && +m[2] <= 12) return recent(+m[1], +m[2], today);
  if ((m = /\b(\d{1,2})\.?\s+([a-zäöå]{3,})\.?(?:\s+(\d{4}))?/.exec(t)) && monthOf(m[2])) return m[3] ? full(+m[3], monthOf(m[2]), +m[1], today) : recent(+m[1], monthOf(m[2]), today);
  if ((m = /\b([a-zäöå]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?/.exec(t)) && monthOf(m[1])) return m[3] ? full(+m[3], monthOf(m[1]), +m[2], today) : recent(+m[2], monthOf(m[1]), today);
  if (/\b(today|tänään|idag)\b/.test(t)) return today;
  if (/\b(yesterday|eilen|igår)\b/.test(t)) return addDays(today, -1);
  const words = t.split(/[^a-zäöå]+/).filter(Boolean);
  for (const w of words) {
    const day = WEEKDAYS.findIndex(names => names.includes(w));
    if (day >= 0) { for (let k = 0; k < 7; k++) { const d = addDays(today, -k); if (weekdayOf(d) === day) return d; } }
  }
  return null;
}

/* The date to keep: what the AI read, if it's a real day not after tomorrow; otherwise what's printed, read here. */
export function bestDate(aiDate, printed, today) {
  const ok = typeof aiDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(aiDate) && real(+aiDate.slice(0, 4), +aiDate.slice(5, 7), +aiDate.slice(8, 10)) && aiDate >= "1990-01-01" && aiDate <= addDays(today, 1);
  const fromText = printedDate(printed, today);
  // A day the AI gave that the printed text contradicts (most often a wrong year on "8.11.") loses to the text.
  if (ok && fromText && fromText.slice(5) === aiDate.slice(5)) return fromText;
  return ok ? aiDate : fromText;
}
