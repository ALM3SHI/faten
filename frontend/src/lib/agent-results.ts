/**
 * Apply results of server-side student tools to local stores right after
 * a chat reply, so pages reflect what the agent just did.
 */

import { useAttendanceStore, type CourseAttendance } from "@/store/attendanceStore";
import { clearPendingPushTimers, setStoreSyncEnabled } from "@/lib/firebase/sync";

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

export function applyAgentResults(actions: ToolLogEntry[] | undefined): void {
  const snap = attendanceSnapshotFrom(actions);
  if (!snap) return;
  // The server already saved this document — don't echo it back.
  setStoreSyncEnabled(false);
  try {
    useAttendanceStore.setState({ courses: snap.courses, lastUpdated: snap.lastUpdated });
  } finally {
    clearPendingPushTimers();
    setStoreSyncEnabled(true);
  }
}
