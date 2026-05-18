import { create } from "zustand";
import type { PlanTask } from "@/store/planStore";

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
  incrementSession: () => void;
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
  incrementSession: () => set((state) => ({ completedSessions: state.completedSessions + 1 })),
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
      timeLeft: task.durationMinutes * 60,
      timerState: "idle",
      // A task launch is always a focus session — even if the user
      // last left the timer in break mode.
      mode: "focus",
    }),
}));
