/**
 * Schedule (Timetable) Store — persists the parsed weekly schedule.
 *
 * Source of truth for the array of class slots produced by
 * `parseSchedulePDF()` in `lib/schedule-parser.ts` — a 100% client-side
 * coordinate-based geometric parser (no API, no AI quota). Consumers:
 *   • The /schedule upload page (writes after a successful parse).
 *   • The Pomodoro widget / plan generator (reads to block out times).
 *
 * Persistence: Zustand `persist` middleware → localStorage. The schedule
 * survives reloads without any backend round-trip.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ScheduleDay =
  | "الأحد"
  | "الإثنين"
  | "الثلاثاء"
  | "الأربعاء"
  | "الخميس";

export type ScheduleActivityType = "نظري" | "عملي";

export interface ScheduleSlot {
  course_code: string;
  course_name: string;
  day: ScheduleDay | string; // string fallback in case backend ever loosens the enum
  start_time: string; // "HH:MM" 24-hour
  end_time: string; // "HH:MM" 24-hour
  type: ScheduleActivityType | string;
  room?: string;
  building?: string;
}

interface ScheduleState {
  /** Firebase UID that owns this persisted snapshot; null = untrusted legacy cache. */
  ownerUid: string | null;
  schedule: ScheduleSlot[];
  /** ISO timestamp of the last successful parse — drives the "last updated" badge. */
  lastUpdated: string | null;

  setSchedule: (slots: ScheduleSlot[]) => void;
  clearSchedule: () => void;
  /** Slots for a specific weekday, sorted by start_time. */
  slotsForDay: (day: string) => ScheduleSlot[];
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      ownerUid: null,
      schedule: [],
      lastUpdated: null,

      setSchedule: (slots) =>
        set({
          schedule: slots,
          lastUpdated: new Date().toISOString(),
        }),

      clearSchedule: () =>
        set({
          ownerUid: null,
          schedule: [],
          lastUpdated: null,
        }),

      slotsForDay: (day) => {
        const all = get().schedule.filter((s) => s.day === day);
        // Sort by start_time so callers can iterate in chronological order.
        return all.slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
      },
    }),
    {
      name: "uqu_schedule_v1",
      // Only persist the data fields — derived selectors are recomputed at runtime.
      partialize: (s) => ({
        ownerUid: s.ownerUid,
        schedule: s.schedule,
        lastUpdated: s.lastUpdated,
      }),
    },
  ),
);

// Day order matches Saudi work week (Sunday → Thursday).
export const WEEK_DAYS: ScheduleDay[] = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
];
