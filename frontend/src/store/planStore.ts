/**
 * AI Study Plan Store — persists the Gemini-generated weekly plan.
 *
 * Source of truth for the structured StudyPlan returned by
 * `POST /api/plan/generate-ai`. Consumers:
 *   • /plan page — reads `plan`, dispatches `generatePlan(payload)`,
 *     watches `isGenerating` to drive the loading UI.
 *   • Future Pomodoro session launcher — will reuse `tasks` as the
 *     queue.
 *
 * Persistence: Zustand `persist` middleware → localStorage under
 * `uqu_ai_plan_v1`. The plan + completed-task ids survive reloads
 * without a server round-trip.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";

// ── Types (mirror backend/schemas/plan_ai.py) ─────────────────────────

export type PlanPriority = "high" | "medium" | "low";

export interface PlanTask {
  title: string;
  courseCode: string;
  courseName?: string | null;
  durationMinutes: number;
  suggestedDay: string;     // Arabic day name
  suggestedTime: string;    // HH:MM 24-hour
  priority: PlanPriority;
  reason: string;
}

export interface PlanDailySummary {
  day: string;
  summary: string;
  totalMinutes: number;
}

export interface StudyPlan {
  overview: string;
  tasks: PlanTask[];
  dailySummary: PlanDailySummary[];
}

export interface GeneratePlanPayload {
  courses: {
    code: string;
    name: string;
    creditHours: number;
    difficulty?: "easy" | "medium" | "hard" | null;
  }[];
  schedule: {
    day: string;
    start_time: string;
    end_time: string;
    course_code?: string | null;
    course_name?: string | null;
    type?: string | null;
  }[];
  preferences: {
    learningStyle: string;
    energyPeak: string;
    taskStrategy: string;
    pomodoroFocus: number;
    pomodoroShortBreak: number;
    pomodoroLongBreak: number;
    dayOff: string;
  };
  studentName?: string | null;
  currentGpa?: number | null;
  targetGpa?: number | null;
}

interface GeneratePlanApiResponse {
  plan: StudyPlan;
  model: string;
  generatedAt: string;
}

// Each task's identity for completion tracking. We don't have stable
// ids from the model so we synthesize one from the unique tuple of
// (day, time, courseCode) — the AI is instructed not to schedule the
// same course twice in the same slot, so collisions are vanishingly
// unlikely. If they happen, both rows toggle together, which is
// acceptable degradation.
export function taskKey(t: PlanTask): string {
  return `${t.suggestedDay}|${t.suggestedTime}|${t.courseCode}`;
}

// ── Store ─────────────────────────────────────────────────────────────

interface PlanState {
  plan: StudyPlan | null;
  model: string | null;
  generatedAt: string | null;
  isGenerating: boolean;
  error: string | null;
  /** Set of taskKey()s the student has marked done. */
  completed: string[];

  generatePlan: (payload: GeneratePlanPayload) => Promise<void>;
  toggleTaskDone: (key: string) => void;
  /** Bulk mark — Sprint-5 Pulse Check uses this to forgive a stretch
   *  of "no activity logged" days in one shot. Keys already present in
   *  `completed` are no-ops; unknown keys are accepted (so the caller
   *  doesn't have to validate against `plan.tasks` first). */
  markTasksDone: (keys: string[]) => void;
  /** Append a single task to the current plan (used by the chat agent's
   *  ADD_TASK client action). Creates a minimal plan shell if none exists. */
  addTask: (task: PlanTask) => void;
  /** Replace a task matched by taskKey(task) === oldKey. Migrates completion
   *  when the synthesized key changes. */
  updateTask: (oldKey: string, updatedTask: PlanTask) => void;
  /** Remove a task and its completion entry. */
  removeTask: (key: string) => void;
  clearPlan: () => void;
  clearError: () => void;
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set, get) => ({
      plan: null,
      model: null,
      generatedAt: null,
      isGenerating: false,
      error: null,
      completed: [],

      generatePlan: async (payload) => {
        // Guard rails — the page should pre-validate too, but bail out
        // here as well so we never make an empty API call.
        if (!payload.courses || payload.courses.length === 0) {
          set({
            error:
              "لا توجد مواد مسجّلة. ارفع سجلك الأكاديمي من صفحة الملف الشخصي أولاً.",
          });
          return;
        }

        // Sprint-5 Bug #14 — Smart Task Rollover.
        // Auto-derive the backlog from the EXISTING plan before we
        // overwrite it: every uncompleted task currently in the store
        // gets injected into the new-plan prompt so the LLM merges
        // last week's missing items into this week's schedule.
        // Done here (rather than at every call site) so the chat agent,
        // the /plan page, and the dashboard rollover modal all benefit.
        const cur = get();
        const completedSet = new Set(cur.completed);
        const backlog =
          (cur.plan?.tasks ?? [])
            .filter((t) => !completedSet.has(taskKey(t)))
            .map((t) => ({
              title: t.title,
              courseCode: t.courseCode,
              courseName: t.courseName ?? null,
              durationMinutes: t.durationMinutes,
              suggestedDay: t.suggestedDay,
              suggestedTime: t.suggestedTime,
              priority: t.priority,
            }));

        set({ isGenerating: true, error: null });
        try {
          const data = (await api.post("/api/plan/generate-ai", {
            ...payload,
            // Backend ignores empty arrays; safe to always send.
            backlog,
          })) as GeneratePlanApiResponse;

          if (!data?.plan || !Array.isArray(data.plan.tasks)) {
            throw new Error("استجابة غير متوقعة من الخادم.");
          }

          set({
            plan: data.plan,
            model: data.model,
            generatedAt: data.generatedAt,
            // Fresh plan → reset completions; the old task keys may
            // not match the new ones anyway.
            completed: [],
            isGenerating: false,
          });
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "فشل توليد الخطة. حاول مرة أخرى.";
          set({ error: msg, isGenerating: false });
        }
      },

      toggleTaskDone: (key) => {
        const cur = get().completed;
        set({
          completed: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
        });
      },

      markTasksDone: (keys) => {
        if (!keys || keys.length === 0) return;
        const cur = get().completed;
        // Set-union dedup; preserves existing order so the UI's
        // "newest first" semantics aren't disturbed for keys already
        // present.
        const merged = Array.from(new Set([...cur, ...keys]));
        if (merged.length === cur.length) return; // nothing new
        set({ completed: merged });
      },

      addTask: (task) => {
        const cur = get().plan;
        const nextTasks = [...(cur?.tasks ?? []), task];
        set({
          plan: {
            overview: cur?.overview ?? "خطة مبنية يدوياً عبر المساعد الذكي.",
            tasks: nextTasks,
            dailySummary: cur?.dailySummary ?? [],
          },
        });
      },

      updateTask: (oldKey, updatedTask) => {
        const cur = get().plan;
        if (!cur) return;
        const idx = cur.tasks.findIndex((t) => taskKey(t) === oldKey);
        if (idx < 0) return;
        const nextTasks = cur.tasks.slice();
        nextTasks[idx] = updatedTask;
        const newKey = taskKey(updatedTask);
        let nextCompleted = get().completed;
        if (newKey !== oldKey && nextCompleted.includes(oldKey)) {
          nextCompleted = [
            ...nextCompleted.filter((k) => k !== oldKey),
            newKey,
          ];
        }
        set({
          plan: { ...cur, tasks: nextTasks },
          completed: nextCompleted,
        });
      },

      removeTask: (key) => {
        const cur = get().plan;
        if (!cur) return;
        set({
          plan: {
            ...cur,
            tasks: cur.tasks.filter((t) => taskKey(t) !== key),
          },
          completed: get().completed.filter((k) => k !== key),
        });
      },

      clearPlan: () =>
        set({
          plan: null,
          model: null,
          generatedAt: null,
          completed: [],
          error: null,
        }),

      clearError: () => set({ error: null }),
    }),
    {
      name: "uqu_ai_plan_v1",
      partialize: (s) => ({
        plan: s.plan,
        model: s.model,
        generatedAt: s.generatedAt,
        completed: s.completed,
      }),
    },
  ),
);
