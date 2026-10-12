/**
 * Pomodoro API client — session log + stats (Phase 2F).
 */

import { api } from "@/lib/api";

export interface PomodoroSessionLogPayload {
  courseCode: string;
  courseName: string;
  duration: number;
  type: "focus";
  date: string;
  completedAt: string;
}

export interface PomodoroLogResponse {
  success: boolean;
  id: string;
}

export interface PomodoroStatsResponse {
  todaySessions: number;
  todayMinutes: number;
  currentStreak: number;
  bestDayCount: number;
  weeklyChart: Array<{ label: string; count: number; date: string }>;
  courseBreakdown: Array<{ name: string; duration: number; percentage: number }>;
  recentSessions: Array<{
    id: string;
    courseCode: string;
    courseName: string;
    duration: number;
    type: string;
    date: string;
    completedAt: string;
  }>;
  totalSessions: number;
  totalMinutes: number;
  totalHours: number;
  bestStreak: number;
}

let pomodoroTestDurationLogged = false;

/** Parsed test seconds — development only, when env var is set. */
function parsePomodoroTestFocusSeconds(): number | null {
  if (process.env.NODE_ENV !== "development") return null;
  const raw = process.env.NEXT_PUBLIC_POMODORO_TEST_SECONDS;
  if (raw === undefined || raw === "") return null;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** True when dev test focus duration is active. */
export function isPomodoroTestDurationActive(): boolean {
  return parsePomodoroTestFocusSeconds() !== null;
}

/**
 * Focus timer length in seconds. In development, NEXT_PUBLIC_POMODORO_TEST_SECONDS
 * overrides the normal minute-based duration; production uses normalMinutes only.
 */
export function getFocusDurationSeconds(normalMinutes: number): number {
  const testSec = parsePomodoroTestFocusSeconds();
  if (testSec !== null) {
    if (
      !pomodoroTestDurationLogged &&
      typeof window !== "undefined"
    ) {
      pomodoroTestDurationLogged = true;
      console.info(
        `[pomodoro] Dev test focus duration: ${testSec}s (NEXT_PUBLIC_POMODORO_TEST_SECONDS)`,
      );
    }
    return testSec;
  }
  return Math.max(1, normalMinutes) * 60;
}

/** Minutes sent in POST /api/pomodoro/log for a completed focus session. */
export function getFocusDurationMinutesForLog(normalMinutes: number): number {
  const testSec = parsePomodoroTestFocusSeconds();
  if (testSec !== null) {
    return Math.max(1, Math.ceil(testSec / 60));
  }
  return normalMinutes;
}

/** Local calendar date as YYYY-MM-DD (for session `date` field). */
export function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** POST completed focus session to backend. Throws on network / HTTP errors. */
export async function logPomodoroSession(
  payload: PomodoroSessionLogPayload,
): Promise<PomodoroLogResponse> {
  return (await api.post("/api/pomodoro/log", payload)) as PomodoroLogResponse;
}

/** GET aggregated stats (todaySessions hydrates the UI counter). */
export async function fetchPomodoroStats(): Promise<PomodoroStatsResponse> {
  return (await api.get("/api/pomodoro/stats")) as PomodoroStatsResponse;
}
