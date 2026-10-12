import { create } from "zustand";
import type { PlanTask } from "@/store/planStore";
import { getFocusDurationSeconds } from "@/lib/pomodoro";

type SessionState = "idle" | "running" | "paused" | "saving" | "completed";

/**
 * Timer mode. Auto-cycle: after every focus session, the page switches
 * to shortBreak (or longBreak every 4th). User can also switch manually.
 */
export type PomodoroMode = "focus" | "shortBreak" | "longBreak";

/**
 * A task that's been "launched into" the Pomodoro timer. The dashboard
 * sets this when the user clicks ▶️ on a plan task; the /pomodoro page
 * reads it on mount to seed the timer duration and display the task
 * context above the clock. Stays null when running the timer in
 * free-form mode.
 */
export interface ActiveTask {
  title: string;
  courseCode: string;
  courseName?: string | null;
  durationMinutes: number;
  /** taskKey(t) from planStore — lets the page toggle the task done. */
  planTaskKey?: string;
}

interface PomodoroState {
  completedSessions: number;
  /** Consecutive days with focus sessions (from GET /api/pomodoro/stats). */
  currentStreak: number;
  incrementSession: () => void;
  /** Hydrate today's completed focus count from GET /api/pomodoro/stats. */
  setCompletedSessions: (n: number) => void;
  setCurrentStreak: (n: number) => void;
  timeLeft: number;
  setTimeLeft: (time: number | ((prev: number) => number)) => void;
  timerState: SessionState;
  setTimerState: (state: SessionState) => void;

  mode: PomodoroMode;
  setMode: (mode: PomodoroMode) => void;

  activeTask: ActiveTask | null;
  setActiveTask: (task: ActiveTask | null) => void;
  /** Convenience: pull a PlanTask in directly with its plan-store key. */
  startTaskFromPlan: (task: PlanTask, planTaskKey: string) => void;
}

export const usePomodoroStore = create<PomodoroState>((set) => ({
  completedSessions: 0,
  currentStreak: 0,
  incrementSession: () => set((state) => ({ completedSessions: state.completedSessions + 1 })),
  setCompletedSessions: (n) => set({ completedSessions: Math.max(0, n) }),
  setCurrentStreak: (n) => set({ currentStreak: Math.max(0, n) }),
  timeLeft: 25 * 60,
  setTimeLeft: (time) =>
    set((state) => ({
      timeLeft: typeof time === "function" ? time(state.timeLeft) : time,
    })),
  timerState: "idle",
  setTimerState: (state) => set({ timerState: state }),

  mode: "focus",
  setMode: (mode) => set({ mode }),

  activeTask: null,
  setActiveTask: (task) => set({ activeTask: task }),
  startTaskFromPlan: (task, planTaskKey) =>
    set({
      activeTask: {
        title: task.title,
        courseCode: task.courseCode,
        courseName: task.courseName ?? null,
        durationMinutes: task.durationMinutes,
        planTaskKey,
      },
      // Seed the timer with the task's duration so /pomodoro lands
      // ready to start. The page can still reset to the default.
      timeLeft: getFocusDurationSeconds(task.durationMinutes),
      timerState: "idle",
      // A task launch is always a focus session — even if the user
      // last left the timer in break mode.
      mode: "focus",
    }),
}));
