/**
 * "اليوم" on the dashboard: the next lecture from the saved timetable and
 * where the student is in the term. Pure functions — the card supplies `now`.
 */

import { AR_WEEKDAYS, getCurrentTerm, weekdayIndex } from "@/lib/academic-term";
import { parseTimeToMinutes } from "@/lib/schedule-grid";
import type { ScheduleSlot } from "@/store/scheduleStore";

export interface NextLecture {
  slot: ScheduleSlot;
  /** 0 = today, 1 = tomorrow, … */
  dayOffset: number;
  startMin: number;
  endMin: number;
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** The lecture in progress or the next one, looking up to a week ahead. */
export function nextLecture(schedule: ScheduleSlot[], now: Date): NextLecture | null {
  const nowMin = minutesOf(now);
  for (let offset = 0; offset < 7; offset++) {
    const dow = (now.getDay() + offset) % 7;
    const slots = schedule
      .filter((s) => weekdayIndex(String(s.day ?? "")) === dow)
      .map((slot) => {
        const startMin = parseTimeToMinutes(slot.start_time ?? "");
        const endMin = parseTimeToMinutes(slot.end_time ?? "");
        return startMin === null ? null : { slot, startMin, endMin: endMin ?? startMin + 50 };
      })
      .filter((x): x is { slot: ScheduleSlot; startMin: number; endMin: number } => x !== null)
      .sort((a, b) => a.startMin - b.startMin);
    const pick = offset === 0 ? slots.find((x) => x.endMin > nowMin) : slots[0];
    if (pick) return { ...pick, dayOffset: offset };
  }
  return null;
}

/** Lectures left today, counting the one in progress. */
export function lecturesLeftToday(schedule: ScheduleSlot[], now: Date): number {
  const nowMin = minutesOf(now);
  return schedule.filter((s) => {
    if (weekdayIndex(String(s.day ?? "")) !== now.getDay()) return false;
    const end = parseTimeToMinutes(s.end_time ?? "") ?? parseTimeToMinutes(s.start_time ?? "");
    return end !== null && end > nowMin;
  }).length;
}

/** "الآن" · "بعد 25 د" · "بعد ساعة" · "10:00" · "بكرة 8:00" · "الأحد 8:00". */
export function lectureWhen(next: NextLecture, now: Date): string {
  const time = next.slot.start_time;
  if (next.dayOffset === 0) {
    const nowMin = minutesOf(now);
    if (next.startMin <= nowMin) return "الآن";
    const diff = next.startMin - nowMin;
    if (diff < 60) return `بعد ${diff} د`;
    if (diff < 120) return "بعد ساعة";
    return time;
  }
  if (next.dayOffset === 1) return `بكرة ${time}`;
  return `${AR_WEEKDAYS[(now.getDay() + next.dayOffset) % 7]} ${time}`;
}

/** Week number of the current term (1-based), or null outside teaching weeks. */
export function termWeek(now: Date): { term: string; week: number } | null {
  const term = getCurrentTerm(now);
  if (!term) return null;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day < term.start || day > term.lastTeachingDay) return null;
  const week = Math.floor((day.getTime() - term.start.getTime()) / (7 * 86_400_000)) + 1;
  return { term: term.term, week };
}
