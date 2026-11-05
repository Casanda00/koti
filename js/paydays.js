// When pay arrives. A source's payDay is a day of the month (1–31), 0 for the last day of the month,
// or -1 for the last working day: the last weekday that isn't a Finnish public holiday. A day that isn't a
// working day moves to the working day before. The rules are in js/engine.js; this gives the screens Dates.
import * as E from "./engine.js";
export const LAST_DAY = E.LAST_DAY, LAST_WORKING_DAY = E.LAST_WORKING_DAY;
const toDate = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const isWorkingDay = d => E.isWorkingDay(iso(d));
export const lastWorkingDay = (y, m) => toDate(E.payDate(LAST_WORKING_DAY, y, m));
/* The pay date in a month (m is 0-based, and may be outside 0–11). */
export const payDateFor = (payDay, y, m) => toDate(E.payDate(payDay, y, m));
export const payDayLabel = payDay => payDay === LAST_WORKING_DAY ? "Last working day of the month" : payDay === LAST_DAY ? "Last day of the month" : `Day ${payDay}`;
