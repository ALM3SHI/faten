/**
 * Attendance (absence) tracker — one record per course code.
 * Persisted to localStorage and synced to Firestore at
 * users/{uid}/academic_record/attendance (see lib/firebase/sync.ts).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AbsenceEntry } from "@/lib/attendance";

export interface CourseAttendance {
  entries: AbsenceEntry[];
  /** Student-entered lecture count; null = estimate from the schedule. */
  totalOverride: number | null;
}

interface AttendanceState {
  ownerUid: string | null;
  courses: Record<string, CourseAttendance>;
  lastUpdated: string | null;

  addAbsence: (code: string, date: string, excused: boolean) => void;
  removeAbsence: (code: string, id: string) => void;
  toggleExcused: (code: string, id: string) => void;
  setTotalOverride: (code: string, total: number | null) => void;
  clearAttendance: () => void;
}

const empty = (): CourseAttendance => ({ entries: [], totalOverride: null });

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const useAttendanceStore = create<AttendanceState>()(
  persist(
    (set) => ({
      ownerUid: null,
      courses: {},
      lastUpdated: null,

      addAbsence: (code, date, excused) =>
        set((s) => {
          const c = s.courses[code] ?? empty();
          const entries = [...c.entries, { id: newId(), date, excused }].sort((a, b) =>
            b.date.localeCompare(a.date),
          );
          return { courses: { ...s.courses, [code]: { ...c, entries } }, lastUpdated: new Date().toISOString() };
        }),

      removeAbsence: (code, id) =>
        set((s) => {
          const c = s.courses[code];
          if (!c) return s;
          return {
            courses: { ...s.courses, [code]: { ...c, entries: c.entries.filter((e) => e.id !== id) } },
            lastUpdated: new Date().toISOString(),
          };
        }),

      toggleExcused: (code, id) =>
        set((s) => {
          const c = s.courses[code];
          if (!c) return s;
          return {
            courses: {
              ...s.courses,
              [code]: { ...c, entries: c.entries.map((e) => (e.id === id ? { ...e, excused: !e.excused } : e)) },
            },
            lastUpdated: new Date().toISOString(),
          };
        }),

      setTotalOverride: (code, total) =>
        set((s) => {
          const c = s.courses[code] ?? empty();
          const clean = total && total > 0 ? Math.min(200, Math.round(total)) : null;
          return { courses: { ...s.courses, [code]: { ...c, totalOverride: clean } }, lastUpdated: new Date().toISOString() };
        }),

      clearAttendance: () => set({ ownerUid: null, courses: {}, lastUpdated: null }),
    }),
    {
      name: "uqu_attendance_v1",
      partialize: (s) => ({ ownerUid: s.ownerUid, courses: s.courses, lastUpdated: s.lastUpdated }),
    },
  ),
);
