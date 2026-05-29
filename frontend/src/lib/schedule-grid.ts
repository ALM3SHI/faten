/**
 * Shared weekly timetable grid utilities.
 *
 * Used by the plan page timetable (7 days × 24 hours). The manual
 * schedule builder still uses its own local TIME_SLOTS for now.
 */

import type { PlanPriority, PlanTask } from "@/store/planStore";
import { taskKey } from "@/store/planStore";
import type { ScheduleSlot } from "@/store/scheduleStore";
import { WEEK_DAYS } from "@/store/scheduleStore";

/** Full week for study-plan timetable (Sun → Sat). */
export const PLAN_WEEK_DAYS: string[] = [
  ...WEEK_DAYS,
  "الجمعة",
  "السبت",
];

export interface GridTimeSlot {
  start: string;
  end: string;
}

/** One row per hour from 00:00 through 23:00. */
export const HOURLY_24_SLOTS: GridTimeSlot[] = Array.from({ length: 24 }, (_, hour) => {
  const start = `${String(hour).padStart(2, "0")}:00`;
  const end =
    hour === 23 ? "24:00" : `${String(hour + 1).padStart(2, "0")}:00`;
  return { start, end };
});

export const PLAN_GRID_ROW_COUNT = HOURLY_24_SLOTS.length;

/** Default row height for the plan timetable (scrollable 24h view). */
export const PLAN_CELL_HEIGHT_PX = 56;

export interface StudyGridBlock {
  taskKey: string;
  title: string;
  courseCode: string;
  courseName?: string | null;
  day: string;
  start_time: string;
  end_time: string;
  durationMinutes: number;
  priority: PlanPriority;
  done: boolean;
  /** Disambiguates React keys when taskKey collides. */
  taskIndex: number;
}

export type CellState =
  | { kind: "empty" }
  | {
      kind: "head";
      blockKind: "lecture";
      slot: ScheduleSlot;
      slotIndex: number;
      duration: number;
    }
  | {
      kind: "head";
      blockKind: "study";
      study: StudyGridBlock;
      duration: number;
    }
  | { kind: "covered" };

export function cellKey(day: string, rowIdx: number): string {
  return `${day}:${rowIdx}`;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse "YYYY-MM-DD" as a LOCAL calendar date (midnight local time). Using a
 * local constructor avoids the UTC-shift bug of `new Date("YYYY-MM-DD")`.
 * Returns null on malformed/out-of-range input.
 */
export function parseLocalDate(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const m = iso.trim().match(ISO_DATE_RE);
  if (!m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mon - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mon - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

/** Format a Date as local "YYYY-MM-DD". */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Arabic weekday name for a Date, aligned with PLAN_WEEK_DAYS (Sun→Sat). */
export function weekdayNameFromDate(date: Date): string {
  return PLAN_WEEK_DAYS[date.getDay()];
}

export interface WeekRange {
  /** Local Date at 00:00 on Sunday. */
  start: Date;
  /** Local Date at 00:00 on the following Sunday (exclusive end). */
  end: Date;
}

/** Sunday-anchored week containing `now` (local), matching PLAN_WEEK_DAYS. */
export function currentWeekRange(now: Date = new Date()): WeekRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay()); // rewind to Sunday
  const end = new Date(start);
  end.setDate(end.getDate() + 7); // exclusive next Sunday
  return { start, end };
}

/** True when a "YYYY-MM-DD" date falls inside [range.start, range.end). */
export function isDateInWeek(iso: string, range: WeekRange): boolean {
  const d = parseLocalDate(iso);
  if (!d) return false;
  const t = d.getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

/** Whole-day signed difference (targetDate − today) in local days; null if invalid. */
export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const d = parseLocalDate(iso);
  if (!d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((d.getTime() - today.getTime()) / MS_PER_DAY);
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Parse "HH:MM" to minutes from midnight; null if invalid. */
export function parseTimeToMinutes(time: string): number | null {
  const m = time.trim().match(TIME_RE);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 24 || min < 0 || min > 59) {
    return null;
  }
  if (h === 24 && min === 0) return 24 * 60;
  if (h === 24) return null;
  return h * 60 + min;
}

export function formatMinutesAsTime(totalMinutes: number): string {
  const capped = Math.min(24 * 60, Math.max(0, totalMinutes));
  const h = Math.floor(capped / 60);
  const m = capped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** End time from start + duration (minutes). */
export function endTimeFromStartAndDuration(
  startTime: string,
  durationMinutes: number,
): string | null {
  const startM = parseTimeToMinutes(startTime);
  if (startM === null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }
  return formatMinutesAsTime(startM + durationMinutes);
}

/** Inclusive start row index (0–23) for a time on an hourly grid. */
export function rowIndexForStart(startTime: string): number {
  const minutes = parseTimeToMinutes(startTime);
  if (minutes === null) return -1;
  return Math.min(PLAN_GRID_ROW_COUNT - 1, Math.max(0, Math.floor(minutes / 60)));
}

/**
 * Inclusive end row index for end_time. Uses ceiling on minutes so
 * partial hours (e.g. 08:00–08:50) still occupy the starting hour row.
 */
export function rowIndexForEnd(endTime: string): number {
  const minutes = parseTimeToMinutes(endTime);
  if (minutes === null) return -1;
  if (minutes <= 0) return 0;
  const row = Math.ceil(minutes / 60) - 1;
  return Math.min(PLAN_GRID_ROW_COUNT - 1, Math.max(0, row));
}

/** Number of hourly rows a block spans. */
export function rowSpanForTimeRange(startTime: string, endTime: string): number {
  const startIdx = rowIndexForStart(startTime);
  let endIdx = rowIndexForEnd(endTime);
  if (startIdx < 0) return 1;
  if (endIdx < 0) endIdx = startIdx;
  if (endIdx < startIdx) endIdx = startIdx;
  return Math.max(1, endIdx - startIdx + 1);
}

export function rowSpanForDuration(startTime: string, durationMinutes: number): number {
  const end = endTimeFromStartAndDuration(startTime, durationMinutes);
  if (!end) return 1;
  return rowSpanForTimeRange(startTime, end);
}

export interface BuildGridMapOptions {
  days?: string[];
  rowCount?: number;
  /**
   * When provided, dated events (tasks with `targetDate`) only render if their
   * date falls inside this week. Out-of-week events are skipped silently — they
   * stay saved and are NOT counted as hidden/conflicting. Normal weekly tasks
   * (no targetDate) are unaffected.
   */
  weekRange?: WeekRange;
}

/**
 * Build occupation map for lecture slots only.
 */
export function buildLectureGridMap(
  slots: ScheduleSlot[],
  options: BuildGridMapOptions = {},
): Map<string, CellState> {
  const days = options.days ?? PLAN_WEEK_DAYS;
  const rowCount = options.rowCount ?? PLAN_GRID_ROW_COUNT;
  const daySet = new Set(days);

  const map = new Map<string, CellState>();
  for (const day of days) {
    for (let i = 0; i < rowCount; i++) {
      map.set(cellKey(day, i), { kind: "empty" });
    }
  }

  slots.forEach((slot, slotIndex) => {
    const day = String(slot.day);
    if (!daySet.has(day)) return;

    const startIdx = rowIndexForStart(slot.start_time);
    if (startIdx < 0 || startIdx >= rowCount) return;

    const dur = rowSpanForTimeRange(slot.start_time, slot.end_time);
    const cappedDur = Math.min(dur, rowCount - startIdx);

    map.set(cellKey(day, startIdx), {
      kind: "head",
      blockKind: "lecture",
      slot,
      slotIndex,
      duration: cappedDur,
    });
    for (let k = 1; k < cappedDur; k++) {
      map.set(cellKey(day, startIdx + k), { kind: "covered" });
    }
  });

  return map;
}

function isRangeFree(
  map: Map<string, CellState>,
  day: string,
  startIdx: number,
  duration: number,
): boolean {
  for (let k = 0; k < duration; k++) {
    const cell = map.get(cellKey(day, startIdx + k));
    if (!cell || cell.kind !== "empty") return false;
  }
  return true;
}

export function planTaskToStudyBlock(
  task: PlanTask,
  taskIndex: number,
  done: boolean,
): StudyGridBlock | null {
  const day = task.suggestedDay?.trim();
  const start = task.suggestedTime?.trim();
  if (!day || !start) return null;

  const durationMinutes = Number(task.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;

  const end_time = endTimeFromStartAndDuration(start, durationMinutes);
  if (!end_time) return null;

  return {
    taskKey: taskKey(task),
    title: task.title,
    courseCode: task.courseCode,
    courseName: task.courseName,
    day,
    start_time: start,
    end_time,
    durationMinutes,
    priority: task.priority,
    done,
    taskIndex,
  };
}

export interface PlanTimetableGridResult {
  gridMap: Map<string, CellState>;
  hiddenStudyCount: number;
}

/**
 * Lectures first, then study tasks on free cells. Overlaps → hiddenStudyCount++.
 */
export function buildPlanTimetableGrid(
  lectures: ScheduleSlot[],
  tasks: PlanTask[],
  completedKeys: string[],
  options: BuildGridMapOptions = {},
): PlanTimetableGridResult {
  const days = options.days ?? PLAN_WEEK_DAYS;
  const rowCount = options.rowCount ?? PLAN_GRID_ROW_COUNT;
  const daySet = new Set(days);

  const gridMap = buildLectureGridMap(lectures, { days, rowCount });
  const weekRange = options.weekRange;
  let hiddenStudyCount = 0;

  tasks.forEach((task, taskIndex) => {
    // Dated events outside the displayed week are intentionally not shown
    // (still saved, still in the registered-events list) — not a conflict.
    if (task.targetDate && weekRange && !isDateInWeek(task.targetDate, weekRange)) {
      return;
    }

    const study = planTaskToStudyBlock(
      task,
      taskIndex,
      completedKeys.includes(taskKey(task)),
    );
    if (!study) {
      hiddenStudyCount += 1;
      return;
    }

    const day = study.day;
    if (!daySet.has(day)) {
      hiddenStudyCount += 1;
      return;
    }

    const startIdx = rowIndexForStart(study.start_time);
    if (startIdx < 0 || startIdx >= rowCount) {
      hiddenStudyCount += 1;
      return;
    }

    const dur = rowSpanForTimeRange(study.start_time, study.end_time);
    const cappedDur = Math.min(dur, rowCount - startIdx);

    if (!isRangeFree(gridMap, day, startIdx, cappedDur)) {
      hiddenStudyCount += 1;
      return;
    }

    gridMap.set(cellKey(day, startIdx), {
      kind: "head",
      blockKind: "study",
      study,
      duration: cappedDur,
    });
    for (let k = 1; k < cappedDur; k++) {
      gridMap.set(cellKey(day, startIdx + k), { kind: "covered" });
    }
  });

  return { gridMap, hiddenStudyCount };
}

/** @deprecated Use buildLectureGridMap — kept for single-layer callers. */
export function buildGridMap(
  slots: ScheduleSlot[],
  options: BuildGridMapOptions & { blockKind?: "lecture" | "study" } = {},
): Map<string, CellState> {
  void options.blockKind;
  return buildLectureGridMap(slots, options);
}
