"use client";

import { useMemo } from "react";
import { useScheduleStore } from "@/store/scheduleStore";
import { useAttendanceStore } from "@/store/attendanceStore";
import { getCurrentTerm } from "@/lib/academic-term";
import { absenceStatus, coursesFromSchedule, estimateSessions, type AbsenceLevel } from "@/lib/attendance";

const RANK: Record<AbsenceLevel, number> = { safe: 0, warning: 1, danger: 2, deprived: 3 };

/** Courses in the timetable with their absence status, the most at risk first. */
export function useAttendanceRows() {
  const schedule = useScheduleStore((s) => s.schedule);
  const records = useAttendanceStore((s) => s.courses);
  return useMemo(() => {
    const term = getCurrentTerm(new Date());
    return coursesFromSchedule(schedule)
      .map((c) => {
        const r = records[c.code];
        const st = absenceStatus(r?.entries ?? [], r?.totalOverride ?? estimateSessions(c, term));
        return { code: c.code, name: c.name, st };
      })
      .sort((a, b) => RANK[b.st.level] - RANK[a.st.level] || a.st.remaining - b.st.remaining);
  }, [schedule, records]);
}
