/**
 * Absence rules — UQU executive rules for Article 14 of the undergraduate
 * study & examination regulation:
 *
 *   «يحرم الطالب من دخول الاختبار النهائي إذا زادت نسبة غيابه بعذر عن (25%)،
 *    أو بدون عذر عن (15%) من مجموع الوحدات الدراسية…»
 *
 * We apply both limits: unexcused absences alone must stay ≤ 15%, and all
 * absences together (excused + unexcused) must stay ≤ 25%.
 */

import type { ScheduleSlot } from "@/store/scheduleStore";
import { teachingDates, weekdayIndex, type TermWindow } from "@/lib/academic-term";

export const UNEXCUSED_LIMIT = 0.15;
export const TOTAL_LIMIT = 0.25;
export const WARNING_RATIO = 0.7; // warn once 70% of the allowance is used

export interface AbsenceEntry {
  id: string;
  /** ISO yyyy-mm-dd */
  date: string;
  excused: boolean;
}

export type AbsenceLevel = "safe" | "warning" | "danger" | "deprived";

export interface AbsenceStatus {
  total: number;
  excused: number;
  unexcused: number;
  /** Largest unexcused count that is still allowed. */
  maxUnexcused: number;
  /** Largest total count that is still allowed. */
  maxTotal: number;
  /** Unexcused absences still possible before deprivation. */
  remaining: number;
  unexcusedPct: number;
  totalPct: number;
  level: AbsenceLevel;
}

export function absenceStatus(entries: AbsenceEntry[], totalSessions: number): AbsenceStatus {
  const total = Math.max(0, Math.floor(totalSessions));
  const excused = entries.filter((e) => e.excused).length;
  const unexcused = entries.length - excused;
  // "زادت عن 15%" → exactly 15% is still allowed.
  const maxUnexcused = Math.floor(total * UNEXCUSED_LIMIT + 1e-9);
  const maxTotal = Math.floor(total * TOTAL_LIMIT + 1e-9);
  const remaining = Math.max(0, Math.min(maxUnexcused - unexcused, maxTotal - (excused + unexcused)));
  const unexcusedPct = total ? unexcused / total : 0;
  const totalPct = total ? (excused + unexcused) / total : 0;

  let level: AbsenceLevel = "safe";
  if (total > 0) {
    if (unexcused > maxUnexcused || excused + unexcused > maxTotal) level = "deprived";
    else if (remaining === 0) level = "danger";
    else {
      const used = Math.max(
        maxUnexcused ? unexcused / maxUnexcused : 0,
        maxTotal ? (excused + unexcused) / maxTotal : 0,
      );
      if (used >= WARNING_RATIO) level = "warning";
    }
  }
  return { total, excused, unexcused, maxUnexcused, maxTotal, remaining, unexcusedPct, totalPct, level };
}

export interface TrackedCourse {
  code: string;
  name: string;
  /** Weekday numbers (getDay()) the course meets on, one entry per weekly session. */
  sessionsPerWeek: number;
  weekdays: number[];
}

/** Group schedule slots into courses (one entry per weekly meeting). */
export function coursesFromSchedule(slots: ScheduleSlot[]): TrackedCourse[] {
  const map = new Map<string, TrackedCourse>();
  for (const s of slots) {
    const code = (s.course_code || s.course_name || "").trim();
    if (!code) continue;
    const day = weekdayIndex(String(s.day));
    const c = map.get(code) ?? { code, name: s.course_name || code, sessionsPerWeek: 0, weekdays: [] };
    c.sessionsPerWeek += 1;
    if (day >= 0) c.weekdays.push(day);
    map.set(code, c);
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Number of lectures the course will hold this term (holidays excluded). */
export function estimateSessions(course: TrackedCourse, term: TermWindow | null): number {
  if (!term || course.weekdays.length === 0) return course.sessionsPerWeek * 15;
  // Count each weekday occurrence once per meeting on that day.
  const perDay = new Map<number, number>();
  for (const d of course.weekdays) perDay.set(d, (perDay.get(d) ?? 0) + 1);
  return teachingDates(term, [...perDay.keys()]).reduce((n, d) => n + (perDay.get(d.getDay()) ?? 0), 0);
}
