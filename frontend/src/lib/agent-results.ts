/**
 * Apply results of server-side student tools to local stores right after
 * a chat reply, so pages reflect what the agent just did.
 */

import { useAttendanceStore, type CourseAttendance } from "@/store/attendanceStore";
import { clearPendingPushTimers, setStoreSyncEnabled } from "@/lib/firebase/sync";
import { useExamsStore } from "@/store/examsStore";
import { normalizeExam, type Exam } from "@/lib/exams";

interface ToolLogEntry {
  tool?: string;
  result?: unknown;
}

interface AttendanceSnapshot {
  courses: Record<string, CourseAttendance>;
  lastUpdated: string;
}

/** Latest attendance snapshot returned by record_absence, if any. */
export function attendanceSnapshotFrom(actions: ToolLogEntry[] | undefined): AttendanceSnapshot | null {
  if (!Array.isArray(actions)) return null;
  let snap: AttendanceSnapshot | null = null;
  for (const a of actions) {
    if (a?.tool !== "record_absence") continue;
    const r = a.result as { success?: boolean; attendance?: AttendanceSnapshot } | null;
    if (r?.success && r.attendance && typeof r.attendance.courses === "object") snap = r.attendance;
  }
  return snap;
}

/** Exams the agent saved with add_upcoming_exam in this reply. */
export function examsAddedBy(actions: ToolLogEntry[] | undefined): Exam[] {
  if (!Array.isArray(actions)) return [];
  const out: Exam[] = [];
  for (const a of actions) {
    if (a?.tool !== "add_upcoming_exam") continue;
    const r = a.result as { success?: boolean; exam?: Record<string, unknown> & { id?: string } } | null;
    const exam = r?.success && r.exam?.id ? normalizeExam(String(r.exam.id), r.exam) : null;
    if (exam) out.push(exam);
  }
  return out;
}

export function applyAgentResults(actions: ToolLogEntry[] | undefined): void {
  const snap = attendanceSnapshotFrom(actions);
  const exams = examsAddedBy(actions);
  if (!snap && exams.length === 0) return;
  // The server already saved these documents — don't echo them back.
  setStoreSyncEnabled(false);
  try {
    if (snap) useAttendanceStore.setState({ courses: snap.courses, lastUpdated: snap.lastUpdated });
    if (exams.length) {
      useExamsStore.setState((s) => ({
        exams: [...s.exams.filter((e) => !exams.some((x) => x.id === e.id)), ...exams],
      }));
    }
  } finally {
    clearPendingPushTimers();
    setStoreSyncEnabled(true);
  }
}
