/**
 * Dates as the rest of فطن writes them: Gregorian, Arabic month names,
 * Western digits — «1 أكتوبر 2026», «1 أكتوبر، 11:00 ص». Plain "ar-SA"
 * gave Arabic-Indic digits and seconds («٢٠٢٦/١٠/١، ١١:٠٠:٠٠ ص») on pages
 * where every other number is 0-9.
 */

const LOCALE = "ar-SA-u-ca-gregory-nu-latn";

const DAY = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" });
const DAY_SHORT = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });

function valid(d: Date | string | number): Date | null {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «1 أكتوبر 2026» */
export function formatDay(d: Date | string | number): string {
  const date = valid(d);
  return date ? DAY.format(date) : "";
}

/** «1 أكتوبر» */
export function formatDayShort(d: Date | string | number): string {
  const date = valid(d);
  return date ? DAY_SHORT.format(date) : "";
}

/** «11:00 ص» */
export function formatTime(d: Date | string | number): string {
  const date = valid(d);
  return date ? TIME.format(date) : "";
}

/**
 * A count with the right Arabic noun: count(4, "مادة", "مواد") → «4 مواد»,
 * count(1, …) → «مادة واحدة» is left to the caller; 1-2 and 11+ use the singular
 * («1 مادة»، «12 مادة»), 3-10 the plural («4 مواد»).
 */
export function count(n: number, singular: string, plural: string): string {
  const mod = Math.abs(n) % 100;
  return `${n} ${mod >= 3 && mod <= 10 ? plural : singular}`;
}

/** «1 أكتوبر 2026، 11:00 ص» */
export function formatDayTime(d: Date | string | number): string {
  const date = valid(d);
  return date ? `${DAY.format(date)}، ${TIME.format(date)}` : "";
}
