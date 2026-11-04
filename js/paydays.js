// When pay arrives. A source's payDay is a day of the month (1–31), 0 for the last day of the month,
// or -1 for the last working day: the last weekday that isn't a Finnish public holiday. A day that isn't a
// working day moves to the working day before.
export const LAST_DAY = 0, LAST_WORKING_DAY = -1;

// Easter Sunday (Gregorian), the anonymous algorithm.
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const key = d => `${d.getMonth() + 1}-${d.getDate()}`;
const holidayCache = new Map();
// Finnish public holidays that can fall on a weekday. Banks are also shut on Midsummer Eve and Christmas Eve.
export function finnishHolidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const set = new Set(["1-1", "1-6", "5-1", "12-6", "12-24", "12-25", "12-26"]);
  const es = easter(y), plus = n => new Date(y, es.getMonth(), es.getDate() + n);
  [plus(-2), plus(1), plus(39)].forEach(d => set.add(key(d)));   // Good Friday, Easter Monday, Ascension Day
  for (let d = 19; d <= 25; d++) { const x = new Date(y, 5, d); if (x.getDay() === 5) set.add(key(x)); }   // Midsummer Eve
  holidayCache.set(y, set); return set;
}
export const isWorkingDay = d => d.getDay() !== 0 && d.getDay() !== 6 && !finnishHolidays(d.getFullYear()).has(key(d));

export function lastWorkingDay(y, m) {
  const d = new Date(y, m + 1, 0);
  while (!isWorkingDay(d)) d.setDate(d.getDate() - 1);
  return d;
}
/* The pay date in a month (m is 0-based, and may be outside 0–11). Pay due on a weekend or a public holiday
   arrives on the working day before, as Finnish payrolls pay it. */
export function payDateFor(payDay, y, m) {
  const first = new Date(y, m, 1); y = first.getFullYear(); m = first.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  if (payDay === LAST_WORKING_DAY) return lastWorkingDay(y, m);
  const d = new Date(y, m, payDay === LAST_DAY ? last : Math.min(payDay, last));
  while (!isWorkingDay(d)) d.setDate(d.getDate() - 1);
  return d;
}
export const payDayLabel = payDay => payDay === LAST_WORKING_DAY ? "Last working day of the month" : payDay === LAST_DAY ? "Last day of the month" : `Day ${payDay}`;
