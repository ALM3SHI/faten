/**
 * Term windows derived from the official calendar (uqu-calendar-data.ts):
 * when teaching starts, when it stops (the day before final exams) and
 * which days are holidays. Used by the attendance tracker and the
 * calendar export so both agree on the same dates.
 */

import {
  UQU_CALENDAR,
  eventEnd,
  eventStart,
  parseISODate,
  type CalendarEvent,
} from "@/lib/uqu-calendar-data";

export interface TermWindow {
  term: string;
  /** First teaching day (local midnight). */
  start: Date;
  /** Last teaching day, inclusive (day before final exams). */
  lastTeachingDay: Date;
  holidays: CalendarEvent[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function getTermWindows(): TermWindow[] {
  const out: TermWindow[] = [];
  for (const t of UQU_CALENDAR) {
    const startEv = t.events.find((e) => e.title.startsWith("بداية الفصل"));
    const finals = t.events.find((e) => e.title === "الاختبارات النهائية");
    if (!startEv || !finals) continue;
    out.push({
      term: t.term,
      start: parseISODate(startEv.start),
      lastTeachingDay: addDays(parseISODate(finals.start), -1),
      holidays: t.events.filter((e) => e.type === "holiday"),
    });
  }
  return out;
}

/** The term in progress on `on`, else the next one, else the last one. */
export function getCurrentTerm(on: Date = new Date()): TermWindow | null {
  const terms = getTermWindows();
  const day = startOfDay(on);
  return (
    terms.find((t) => day >= t.start && day <= t.lastTeachingDay) ??
    terms.find((t) => day < t.start) ??
    terms[terms.length - 1] ??
    null
  );
}

export function isHoliday(day: Date, term: TermWindow): boolean {
  const d = startOfDay(day);
  return term.holidays.some((h) => d >= eventStart(h) && d <= eventEnd(h));
}

/** Arabic weekday names in JS getDay() order (0 = Sunday). */
export const AR_WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function weekdayIndex(arDay: string): number {
  return AR_WEEKDAYS.indexOf(arDay.trim());
}

/** Every teaching date in the term that falls on one of `weekdays` (getDay() numbers). */
export function teachingDates(term: TermWindow, weekdays: number[]): Date[] {
  const wanted = new Set(weekdays);
  const dates: Date[] = [];
  const days = Math.round((term.lastTeachingDay.getTime() - term.start.getTime()) / DAY_MS);
  for (let i = 0; i <= days; i++) {
    const d = addDays(term.start, i);
    if (wanted.has(d.getDay()) && !isHoliday(d, term)) dates.push(d);
  }
  return dates;
}
