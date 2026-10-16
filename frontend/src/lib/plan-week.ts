/**
 * «خطة المذاكرة» — the week as numbers: how loaded each day is (lectures
 * plus study), how the study time is shared between the courses, and the
 * course colours used everywhere on the page. Pure functions over the
 * same agenda «وقتي» uses (lib/agenda.ts).
 */

import { buildAgenda, type AgendaInput, type AgendaItem } from "@/lib/agenda";
import { taskKey, type PlanTask } from "@/store/planStore";

/** One hue per course: distinct in hue and lightness, readable in both themes. */
export const COURSE_PALETTE = ["#6d5ae6", "#0f9b8e", "#d97a06", "#d9466f", "#2f80d1", "#5b9a2f", "#a855c7", "#b45309"];

/** Stable colour per course code: order of first appearance in `codes`. */
export function courseColors(codes: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  let i = 0;
  for (const c of codes) {
    const code = (c || "").trim();
    if (!code || map[code]) continue;
    map[code] = COURSE_PALETTE[i % COURSE_PALETTE.length];
    i++;
  }
  return map;
}

export interface DayLoad {
  /** Minutes in lectures that day. */
  lectureMin: number;
  /** Study sessions in time order, for the stacked column. */
  sessions: { key: string; code: string; min: number; done: boolean }[];
  studyMin: number;
  doneMin: number;
}

/** Lecture and study minutes for one day, from its agenda. */
export function dayLoad(items: AgendaItem[]): DayLoad {
  let lectureMin = 0;
  const sessions: DayLoad["sessions"] = [];
  for (const it of items) {
    if (it.kind === "lecture") lectureMin += Math.max(0, it.end - it.start);
    // Dated one-off events (an exam, a deadline) are appointments, not study time.
    if (it.kind === "task" && !it.task.targetDate) sessions.push({ key: it.key, code: it.task.courseCode, min: Math.max(0, it.task.durationMinutes || 0), done: it.done });
  }
  const studyMin = sessions.reduce((n, s) => n + s.min, 0);
  const doneMin = sessions.filter((s) => s.done).reduce((n, s) => n + s.min, 0);
  return { lectureMin, sessions, studyMin, doneMin };
}

/** The agenda and the load of each day of the week. */
export function weekPlan(days: Date[], input: AgendaInput): { items: AgendaItem[]; load: DayLoad }[] {
  return days.map((d) => {
    const items = buildAgenda(d, input);
    return { items, load: dayLoad(items) };
  });
}

export interface CourseShare {
  code: string;
  name: string;
  sessions: number;
  plannedMin: number;
  doneMin: number;
}

/**
 * Weekly study time per course: every current course (even with no
 * session, so a forgotten course shows up), then courses that only appear
 * in the plan. Dated one-off events are left out — they are appointments,
 * not study time.
 */
export function courseShares(
  courses: { code: string; name: string }[],
  tasks: PlanTask[],
  completed: string[],
): CourseShare[] {
  const done = new Set(completed);
  const rows = new Map<string, CourseShare>();
  for (const c of courses) {
    if (!c.code || rows.has(c.code)) continue;
    rows.set(c.code, { code: c.code, name: c.name || c.code, sessions: 0, plannedMin: 0, doneMin: 0 });
  }
  for (const t of tasks) {
    if (t.targetDate) continue;
    const code = (t.courseCode || "").trim() || "—";
    const row = rows.get(code) ?? { code, name: t.courseName || code, sessions: 0, plannedMin: 0, doneMin: 0 };
    const min = Math.max(0, t.durationMinutes || 0);
    row.sessions += 1;
    row.plannedMin += min;
    if (done.has(taskKey(t))) row.doneMin += min;
    rows.set(code, row);
  }
  return [...rows.values()].sort((a, b) => b.plannedMin - a.plannedMin);
}

/** 90 → "1.5 س" · 45 → "45 د" · 0 → "0 د". */
export function minutesShort(min: number): string {
  if (min < 60) return `${Math.round(min)} د`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} س`;
}
