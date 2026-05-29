/**
 * Validation for manual study-session placement on the plan timetable.
 */

import {
  endTimeFromStartAndDuration,
  parseTimeToMinutes,
  PLAN_WEEK_DAYS,
} from "@/lib/schedule-grid";
import { taskKey, type PlanTask } from "@/store/planStore";
import type { ScheduleSlot } from "@/store/scheduleStore";

const PLAN_DAY_SET = new Set(PLAN_WEEK_DAYS);

export interface ValidatePlanTaskPlacementOptions {
  /**
   * Extra clearance around lectures (minutes). Default 0 — manual add/edit unchanged.
   * AI plan repair uses 60 on the backend only.
   */
  lectureBufferMinutes?: number;
}

export interface ValidatePlanTaskPlacementInput {
  task: PlanTask;
  lectures: ScheduleSlot[];
  existingTasks: PlanTask[];
  /** When editing, skip the task being replaced (matched by old key). */
  excludeTaskKey?: string;
  options?: ValidatePlanTaskPlacementOptions;
}

function minuteRange(
  startTime: string,
  endTime: string,
): { start: number; end: number } | null {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

function formatRangeLabel(start: string, end: string): string {
  return `${start}–${end}`;
}

/** User-facing lecture label: name → code → generic. */
function lectureConflictLabel(slot: ScheduleSlot): string {
  const name = slot.course_name?.trim();
  if (name) return name;
  const code = slot.course_code?.trim();
  if (code) return code;
  return "";
}

function lectureConflictPrefix(slot: ScheduleSlot): string {
  const label = lectureConflictLabel(slot);
  return label ? `تعارض مع محاضرة ${label}` : "تعارض مع محاضرة";
}

function lectureBufferPrefix(slot: ScheduleSlot): string {
  const label = lectureConflictLabel(slot);
  return label ? `قريب جداً من محاضرة ${label}` : "قريب جداً من محاضرة";
}

/**
 * Returns an Arabic error message suitable for toast.error(), or null if valid.
 */
export function validatePlanTaskPlacement(
  input: ValidatePlanTaskPlacementInput,
): string | null {
  const { task, lectures, existingTasks, excludeTaskKey, options } = input;
  const lectureBufferMinutes = Math.max(
    0,
    Number(options?.lectureBufferMinutes ?? 0) || 0,
  );

  const day = task.suggestedDay?.trim();
  if (!day || !PLAN_DAY_SET.has(day)) {
    return "اليوم المحدد غير صالح. اختر يوماً من أيام الأسبوع.";
  }

  const startTime = task.suggestedTime?.trim();
  const startM = startTime ? parseTimeToMinutes(startTime) : null;
  if (!startTime || startM === null) {
    return "وقت البداية غير صالح. استخدم صيغة 24 ساعة مثل 14:00.";
  }

  const durationMinutes = Number(task.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return "مدة الجلسة يجب أن تكون أكبر من صفر.";
  }

  const endTime = endTimeFromStartAndDuration(startTime, durationMinutes);
  if (!endTime) {
    return "تعذر حساب وقت نهاية الجلسة. تحقق من الوقت والمدة.";
  }

  const studyRange = minuteRange(startTime, endTime);
  if (!studyRange) {
    return "نطاق وقت الجلسة غير صالح.";
  }

  for (const slot of lectures) {
    if (String(slot.day).trim() !== day) continue;
    const lectureRange = minuteRange(slot.start_time, slot.end_time);
    if (!lectureRange) continue;
    if (rangesOverlap(studyRange, lectureRange)) {
      return `${lectureConflictPrefix(slot)} في ${day} · ${formatRangeLabel(slot.start_time, slot.end_time)}.`;
    }
    if (lectureBufferMinutes > 0) {
      const buffered: { start: number; end: number } = {
        start: Math.max(0, lectureRange.start - lectureBufferMinutes),
        end: lectureRange.end + lectureBufferMinutes,
      };
      if (rangesOverlap(studyRange, buffered)) {
        return `${lectureBufferPrefix(slot)} — يفضّل ترك ساعة قبل/بعد المحاضرة.`;
      }
    }
  }

  for (const other of existingTasks) {
    const otherKey = taskKey(other);
    if (excludeTaskKey && otherKey === excludeTaskKey) continue;
    if (other.suggestedDay?.trim() !== day) continue;

    // Two dated events on the same weekday but different calendar dates occupy
    // different weeks → never conflict. (A dated event vs a weekly recurring
    // session still conflicts, since the weekly session recurs every week.)
    if (
      task.targetDate &&
      other.targetDate &&
      task.targetDate !== other.targetDate
    ) {
      continue;
    }

    const otherStart = other.suggestedTime?.trim();
    if (!otherStart) continue;
    const otherEnd = endTimeFromStartAndDuration(
      otherStart,
      Number(other.durationMinutes),
    );
    if (!otherEnd) continue;

    const otherRange = minuteRange(otherStart, otherEnd);
    if (!otherRange) continue;

    if (rangesOverlap(studyRange, otherRange)) {
      const label = other.title?.trim() || other.courseCode || "جلسة مذاكرة";
      return `تعارض مع جلسة مذاكرة أخرى (${label}) في ${day} · ${formatRangeLabel(otherStart, otherEnd)}.`;
    }
  }

  return null;
}
