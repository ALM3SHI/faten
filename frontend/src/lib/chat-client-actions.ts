/**
 * Chat Client Action Dispatcher
 * ────────────────────────────────────────────────────────────────
 * Applies structured directives the agent emits via
 * `emit_client_action` (backend) to the Zustand stores so the
 * Dashboard / GPA Planner / Pomodoro screens reflect the change
 * immediately.
 *
 * Whitelist MUST stay in sync with
 *   backend/agent/tools_executor.py :: ALLOWED_CLIENT_ACTION_TYPES
 *
 * Every dispatcher is defensive: bad payloads log and skip rather
 * than throwing — we never want a malformed agent response to
 * crash the chat UI.
 */

import { useProfileStore } from "@/store/profileStore";
import { usePlanStore, taskKey, type PlanTask, type PlanPriority } from "@/store/planStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useTranscriptStore } from "@/store/transcriptStore";

export type ClientActionType =
  | "ADD_TASK"
  | "TOGGLE_TASK_DONE"
  | "UPDATE_TARGET_GPA"
  | "UPDATE_BASIC_PROFILE"
  | "UPDATE_PREFERENCES"

  | "NAVIGATE"
  | "START_POMODORO";

export interface ClientAction {
  type: ClientActionType | string;
  payload: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────
// Type guards / coercions
// ──────────────────────────────────────────────────────────────────

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const VALID_TOOLS = new Set(["pomodoro", "gpa", "map", "dashboard", "plan"]);
const VALID_PRIORITY = new Set<PlanPriority>(["high", "medium", "low"]);

// ──────────────────────────────────────────────────────────────────
// Individual handlers
// ──────────────────────────────────────────────────────────────────

function dispatchAddTask(payload: Record<string, unknown>): boolean {
  const title = asString(payload.title);
  if (!title) return false;
  const courseCode = asString(payload.courseCode) ?? "";
  const courseName = asString(payload.courseName);
  const durationMinutes = clamp(asNumber(payload.durationMinutes) ?? 25, 15, 240);
  const suggestedDay = asString(payload.suggestedDay) ?? "الأحد";
  const suggestedTime = asString(payload.suggestedTime) ?? "20:00";
  const priorityRaw = asString(payload.priority) ?? "medium";
  const priority: PlanPriority = VALID_PRIORITY.has(priorityRaw as PlanPriority)
    ? (priorityRaw as PlanPriority)
    : "medium";
  const reason = asString(payload.reason) ?? "أُضيفت من المساعد الذكي";
  const targetDate = asString(payload.targetDate);

  const task: PlanTask = {
    title,
    courseCode,
    courseName,
    durationMinutes,
    suggestedDay,
    suggestedTime,
    targetDate: targetDate || undefined,
    priority,
    reason,
  };
  usePlanStore.getState().addTask(task);
  return true;
}

function dispatchToggleTaskDone(payload: Record<string, unknown>): boolean {
  const key = asString(payload.taskKey);
  if (!key) return false;
  usePlanStore.getState().toggleTaskDone(key);
  return true;
}

function dispatchUpdateTargetGpa(payload: Record<string, unknown>): boolean {
  const target = asNumber(payload.target);
  if (target == null) return false;
  // Hard-clamp to the UQU 4.00 scale so the agent can't accidentally push
  // a value from a stale 5.0-scale assumption into the profile store.
  useProfileStore.getState().setGoals({ targetGpa: clamp(target, 0, 4) });
  return true;
}

function dispatchUpdateBasicProfile(payload: Record<string, unknown>): boolean {
  const patch: { name?: string; major?: string; studentId?: string; totalPlanHours?: number } = {};
  const name = asString(payload.name);
  const major = asString(payload.major);
  const studentId = asString(payload.studentId);
  const totalPlanHours = asNumber(payload.totalPlanHours);
  if (name) patch.name = name;
  if (major) patch.major = major;
  if (studentId) patch.studentId = studentId;
  if (totalPlanHours && totalPlanHours > 0) patch.totalPlanHours = totalPlanHours;
  if (Object.keys(patch).length === 0) return false;
  useProfileStore.getState().setBasic(patch);
  return true;
}

function dispatchUpdatePreferences(payload: Record<string, unknown>): boolean {
  // Pass through whatever fields are present; the store's setPreferences
  // is a partial patch and silently ignores unknown keys.
  if (Object.keys(payload).length === 0) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useProfileStore.getState().setPreferences(payload as any);
  return true;
}



function dispatchNavigate(payload: Record<string, unknown>): boolean {
  // ⚠️ Intentional no-op. Auto-navigation hijacks the user's reading
  // flow — the chat must NEVER force a page change. The NAVIGATE
  // action still propagates through `response.client_actions` to the
  // chat page, which renders it as a clickable CTA button under the
  // bot message (see <NavigationCTA> in app/chat/page.tsx).
  void payload;
  return false;
}

/** Lightweight predicate the chat UI uses to split "suggested navigation"
 *  actions out of the dispatched stream. Kept here so the whitelist of
 *  navigation-style action types stays in one file. */
export function isSuggestedNavigation(action: ClientAction): boolean {
  if (!action || typeof action.type !== "string") return false;
  if (action.type !== "NAVIGATE") return false;
  const path = (action.payload as { path?: unknown } | undefined)?.path;
  return typeof path === "string"
    && path.startsWith("/")
    && !path.startsWith("//");
}

function dispatchStartPomodoro(payload: Record<string, unknown>): boolean {
  // Honor the exact duration the student asked for. Bounds match the
  // /pomodoro page's own editor (MIN_DURATION_MINUTES=1, MAX=180) so a
  // request like "دقيقتين" (2 min) is NOT silently bumped up — the old
  // floor of 5 was the cause of "2 min → 5 min". Falls back to the
  // student's saved focus length (profile preferences) only when no
  // duration is provided in the action.
  const profileFocus = useProfileStore.getState().preferences.pomodoroFocus;
  const requestedMinutes =
    asNumber(payload.focusMinutes) ?? (profileFocus > 0 ? profileFocus : 25);
  const focusMinutes = clamp(requestedMinutes, 1, 180);
  const taskTitle = asString(payload.taskTitle);
  const pomodoro = usePomodoroStore.getState();
  pomodoro.setMode("focus");
  pomodoro.setActiveTask({
    title: taskTitle ?? "جلسة تركيز",
    courseCode: asString(payload.courseCode) ?? "",
    courseName: asString(payload.courseName),
    durationMinutes: focusMinutes,
    planTaskKey: `chat-action-${Date.now()}`,
  });
  // Seed the timer so the user can just press Start.
  pomodoro.setTimeLeft(focusMinutes * 60);
  pomodoro.setTimerState("idle");
  return true;
}

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

/**
 * Apply a single client action. Returns true on success, false on
 * malformed payload (caller can use this to log analytics or render
 * a "couldn't apply" inline hint without throwing).
 */
export function dispatchClientAction(action: ClientAction): boolean {
  if (!action || typeof action.type !== "string") return false;
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  switch (action.type) {
    case "ADD_TASK":             return dispatchAddTask(payload);
    case "TOGGLE_TASK_DONE":     return dispatchToggleTaskDone(payload);
    case "UPDATE_TARGET_GPA":    return dispatchUpdateTargetGpa(payload);
    case "UPDATE_BASIC_PROFILE": return dispatchUpdateBasicProfile(payload);
    case "UPDATE_PREFERENCES":   return dispatchUpdatePreferences(payload);

    case "NAVIGATE":             return dispatchNavigate(payload);
    case "START_POMODORO":       return dispatchStartPomodoro(payload);
    default:
      console.warn("[chat] Unknown client_action type:", action.type);
      return false;
  }
}

export function dispatchClientActions(actions: ClientAction[] | undefined): number {
  if (!Array.isArray(actions) || actions.length === 0) return 0;
  let applied = 0;
  for (const a of actions) {
    try {
      if (dispatchClientAction(a)) applied += 1;
    } catch (err) {
      console.error("[chat] client_action dispatch failed:", a, err);
    }
  }
  return applied;
}

/**
 * Build the live context snapshot the chat page pushes to the backend
 * on every request. Reads the persisted Zustand stores directly so
 * we never miss an in-session edit.
 */
export interface ClientContextSnapshot {
  profile: {
    name: string;
    major: string;
    studentId: string;
    totalPlanHours: number | "";
    targetGpa: number;
    currentGpa: number;
  };
  transcript: {
    gpa: number | null;
    earnedHours: number | null;
    completedCourses: Array<{
      code: string;
      nameAr: string;
      nameEn: string;
      creditHours: number;
      grade: string | null;
      gradePoints: number | null;
      semester: string;
    }>;
    currentCourses: Array<{
      code: string;
      nameAr: string;
      nameEn: string;
      creditHours: number;
      semester: string;
    }>;
  };
  plan: {
    tasks: Array<PlanTask & { taskKey: string; done: boolean; isToday: boolean }>;
    overview: string | null;
  };
}

const AR_DAYS = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

export function buildClientContext(): ClientContextSnapshot {
  // Read via getState so this works from a plain function (no hooks).
  // Pull-once snapshots — we want a coherent view, not a live subscription.
  const profile = useProfileStore.getState();
  const transcript = useTranscriptStore.getState();
  const plan = usePlanStore.getState();

  const today = AR_DAYS[new Date().getDay()];

  const displayName =
    (profile.basic.name || transcript.name || transcript.nameEn || "").trim();

  return {
    profile: {
      name: displayName,
      major: profile.basic.major,
      studentId: profile.basic.studentId,
      totalPlanHours: profile.basic.totalPlanHours,
      targetGpa: profile.goals.targetGpa,
      currentGpa: profile.goals.currentGpa,
    },
    transcript: {
      gpa: transcript.gpa,
      earnedHours: transcript.earnedHours,
      // Trim heavy course arrays — keep the fields the agent actually uses.
      completedCourses: transcript.completedCourses.slice(0, 80).map((c) => ({
        code: c.code,
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        creditHours: c.creditHours,
        grade: c.grade,
        gradePoints: c.gradePoints,
        semester: c.semester,
      })),
      currentCourses: transcript.currentCourses.slice(0, 20).map((c) => ({
        code: c.code,
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        creditHours: c.creditHours,
        semester: c.semester,
      })),
    },
    plan: {
      overview: plan.plan?.overview ?? null,
      tasks: (plan.plan?.tasks ?? []).map((t) => {
        const k = taskKey(t);
        return {
          ...t,
          taskKey: k,
          done: plan.completed.includes(k),
          isToday: t.suggestedDay === today,
        };
      }),
    },
  };
}
