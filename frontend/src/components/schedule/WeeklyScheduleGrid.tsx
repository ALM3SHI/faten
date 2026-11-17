"use client";

import { CheckCircle2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  cellKey,
  HOURLY_24_SLOTS,
  PLAN_CELL_HEIGHT_PX,
  PLAN_WEEK_DAYS,
  type CellState,
  type StudyGridBlock,
} from "@/lib/schedule-grid";
import type { PlanPriority } from "@/store/planStore";
import type { ScheduleSlot } from "@/store/scheduleStore";

/** Narrow sticky time column (px). */
const TIME_COL_WIDTH_PX = 64;
/** Minimum width per day column before horizontal scroll kicks in. */
const DAY_COL_MIN_PX = 145;

const STUDY_PRIORITY_STYLES: Record<
  PlanPriority,
  { border: string; bg: string; inner: string; chip: string; dot: string; subtext: string }
> = {
  high: {
    border: "border-danger-line ",
    bg: "bg-danger-ink ",
    inner:
      "bg-danger-ink border-danger-line text-danger-ink",
    chip: "bg-danger-soft text-danger-ink",
    dot: "bg-danger-ink ",
    subtext: "text-danger-ink ",
  },
  medium: {
    border: "border-info-line ",
    bg: "bg-info-ink ",
    inner:
      "bg-info-ink border-info-line text-info-ink",
    chip: "bg-info-soft text-info-ink",
    dot: "bg-info-ink ",
    subtext: "text-info-ink ",
  },
  low: {
    border: "border-success-line ",
    bg: "bg-success-ink ",
    inner:
      "bg-success-ink border-success-line text-success-ink",
    chip: "bg-success-soft text-success-ink",
    dot: "bg-success-ink ",
    subtext: "text-success-ink ",
  },
};

export interface WeeklyScheduleGridProps {
  gridMap: Map<string, CellState>;
  days?: string[];
  timeSlots?: { start: string; end: string }[];
  rowHeightPx?: number;
  title?: string;
  subtitle?: string;
  emptyHint?: string;
  hiddenStudyCount?: number;
  onToggleStudy?: (taskKey: string) => void;
  interactiveStudy?: boolean;
  onEditStudyBlock?: (study: StudyGridBlock) => void;
  onDeleteStudyBlock?: (study: StudyGridBlock) => void;
  /** Arabic weekday name of "today" — that column gets a subtle highlight. */
  todayColumn?: string | null;
  className?: string;
}

export function WeeklyScheduleGrid({
  gridMap,
  days = PLAN_WEEK_DAYS,
  timeSlots = HOURLY_24_SLOTS,
  rowHeightPx = PLAN_CELL_HEIGHT_PX,
  title = "الجدول الأسبوعي",
  emptyHint,
  hiddenStudyCount = 0,
  onToggleStudy,
  interactiveStudy = false,
  onEditStudyBlock,
  onDeleteStudyBlock,
  todayColumn = null,
  className,
}: WeeklyScheduleGridProps) {
  const hasAnyBlock = [...gridMap.values()].some((c) => c.kind === "head");
  const tableMinWidth = `calc(${TIME_COL_WIDTH_PX}px + ${days.length} * ${DAY_COL_MIN_PX}px)`;

  return (
    <Card
      className={cn(
        "border border-line bg-surface shadow-card rounded-card overflow-hidden w-full py-0 gap-0 ring-0 border-0",
        className,
      )}
    >
      <div className="px-5 py-4 border-b border-line bg-surface-sunken flex items-center justify-between gap-3 rounded-t-card">
        <h2 className="text-body font-bold">{title}</h2>
        {!hasAnyBlock && emptyHint && (
          <p className="text-caption text-warning-ink font-medium shrink-0">{emptyHint}</p>
        )}
      </div>

      <div className="min-w-0 overflow-x-auto">
        <div
          className="overflow-y-auto max-h-[min(78vh,1100px)] w-full"
          style={{ scrollbarGutter: "stable" }}
        >
          <table
            className="w-full border-collapse text-small table-fixed"
            style={{ minWidth: tableMinWidth }}
          >
            <colgroup>
              <col style={{ width: TIME_COL_WIDTH_PX }} />
              {days.map((day) => (
                <col key={day} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky right-0 z-30 bg-surface border border-line px-1 py-2.5 text-caption font-mono font-semibold text-ink-muted text-center">
                  الوقت
                </th>
                {days.map((day) => (
                  <th
                    key={day}
                    className={cn(
                      "bg-surface border border-line p-2.5 text-small font-bold",
                      day === todayColumn &&
                        "bg-info-soft text-info-ink border-info-line",
                    )}
                  >
                    {day}
                    {day === todayColumn && (
                      <span className="mr-1 text-caption font-medium text-info-ink">
                        • اليوم
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.map((time, rowIdx) => (
                <tr key={time.start}>
                  <td className="sticky right-0 z-10 bg-surface border border-line px-1 py-2 text-caption font-mono font-semibold text-ink-muted text-center align-top">
                    {time.start}
                  </td>
                  {days.map((day) => {
                    const isToday = day === todayColumn;
                    const cell: CellState =
                      gridMap.get(cellKey(day, rowIdx)) ?? { kind: "empty" };
                    if (cell.kind === "covered") return null;
                    if (cell.kind === "head") {
                      if (cell.blockKind === "lecture") {
                        return (
                          <LectureSpanningCell
                            key={`${day}-${rowIdx}-lec`}
                            slot={cell.slot}
                            duration={cell.duration}
                            rowHeightPx={rowHeightPx}
                          />
                        );
                      }
                      return (
                        <StudySpanningCell
                          key={`${day}-${rowIdx}-study-${cell.study.taskKey}-${cell.study.taskIndex}`}
                          study={cell.study}
                          duration={cell.duration}
                          rowHeightPx={rowHeightPx}
                          onToggle={onToggleStudy}
                          interactive={interactiveStudy}
                          onEdit={onEditStudyBlock}
                          onDelete={onDeleteStudyBlock}
                        />
                      );
                    }
                    return (
                      <EmptyGridCell
                        key={`${day}-${rowIdx}`}
                        rowHeightPx={rowHeightPx}
                        isToday={isToday}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {hiddenStudyCount > 0 && (
        <p className="px-5 py-3 text-caption text-warning-ink border-t border-line bg-warning-soft">
          {hiddenStudyCount} جلسة مذاكرة لم تظهر بسبب تعارض أو وقت غير معروف
        </p>
      )}
    </Card>
  );
}

function lectureDisplayName(slot: ScheduleSlot): string {
  return slot.course_name?.trim() || "محاضرة";
}

function studyCourseDisplayName(study: StudyGridBlock): string | null {
  const name = study.courseName?.trim();
  return name || null;
}

function EmptyGridCell({
  rowHeightPx,
  isToday,
}: {
  rowHeightPx: number;
  isToday?: boolean;
}) {
  return (
    <td
      className={cn(
        "border border-line p-1.5 align-top",
        isToday ? "bg-info-soft" : "bg-transparent",
      )}
      style={{ height: rowHeightPx, minHeight: rowHeightPx }}
    >
      <div className="w-full h-full" style={{ minHeight: Math.max(44, rowHeightPx - 8) }} />
    </td>
  );
}

function LectureSpanningCell({
  slot,
  duration,
  rowHeightPx,
}: {
  slot: ScheduleSlot;
  duration: number;
  rowHeightPx: number;
}) {
  const isLab = slot.type === "عملي";
  return (
    <td
      rowSpan={duration}
      className={cn(
        "border align-top p-1.5",
        isLab
          ? "border-warning-line bg-warning-soft"
          : "border-info-line bg-info-soft",
      )}
      style={{ height: duration * rowHeightPx }}
    >
      <div
        className={cn(
          "h-full w-full rounded-control border p-3 flex flex-col gap-1.5 relative overflow-hidden",
          isLab
            ? "bg-warning-soft border-warning-line text-warning-ink "
            : "bg-info-soft border-info-line text-ink",
        )}
      >
        <div className="text-small font-bold leading-snug line-clamp-3">
          {lectureDisplayName(slot)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-1 text-caption font-mono opacity-70">
          <span>
            {slot.start_time}–{slot.end_time}
          </span>
          <span className="px-2 py-0.5 rounded bg-surface-sunken shrink-0">
            {isLab ? "عملي" : "نظري"}
            {duration > 1 ? ` · ${duration}س` : ""}
          </span>
        </div>
        {slot.room && (
          <div className="text-caption opacity-60 truncate">
            {slot.building ? `${slot.building} · ` : ""}
            {slot.room}
          </div>
        )}
      </div>
    </td>
  );
}

function StudySpanningCell({
  study,
  duration,
  rowHeightPx,
  onToggle,
  interactive,
  onEdit,
  onDelete,
}: {
  study: StudyGridBlock;
  duration: number;
  rowHeightPx: number;
  onToggle?: (taskKey: string) => void;
  interactive?: boolean;
  onEdit?: (study: StudyGridBlock) => void;
  onDelete?: (study: StudyGridBlock) => void;
}) {
  const p = STUDY_PRIORITY_STYLES[study.priority] ?? STUDY_PRIORITY_STYLES.medium;
  const priorityLabel =
    study.priority === "high" ? "عالية" : study.priority === "low" ? "خفيفة" : "متوسطة";
  const courseLabel = studyCourseDisplayName(study);

  return (
    <td
      rowSpan={duration}
      className={cn("border align-top p-1.5", p.border, p.bg)}
      style={{ height: duration * rowHeightPx }}
    >
      <div
        className={cn(
          "group h-full w-full rounded-control border p-2.5 flex flex-col gap-1.5 relative overflow-hidden transition-opacity min-h-[44px]",
          p.inner,
          study.done && "opacity-55",
        )}
      >
        <div className="flex items-start justify-between gap-1.5 shrink-0 min-w-0">
          <div
            className={cn(
              "text-small font-bold leading-snug line-clamp-2 flex-1 min-w-0",
              study.done && "line-through opacity-70",
            )}
          >
            {study.title}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {interactive && onEdit && (
              <Button variant="bare"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(study);
                }}
                className="w-6 h-6 rounded-md border border-info-line flex items-center justify-center text-info-ink hover:bg-info-soft transition-colors"
                aria-label="تعديل الجلسة"
              >
                <Pencil className="w-3 h-3" />
              </Button>
            )}
            {interactive && onDelete && (
              <Button variant="bare"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(study);
                }}
                className="w-6 h-6 rounded-md border border-danger-line flex items-center justify-center text-danger-ink hover:bg-danger-soft transition-colors"
                aria-label="حذف الجلسة"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
            {onToggle && (
              <Button variant="bare"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(study.taskKey);
                }}
                className={cn(
                  "w-6 h-6 rounded-full border flex items-center justify-center transition-all shrink-0",
                  study.done
                    ? "bg-brand border-brand text-on-brand"
                    : "border-info-line text-info-ink hover:border-info-line hover:bg-info-soft",
                )}
                aria-label={study.done ? "إلغاء الإتمام" : "وضع علامة منجز"}
              >
                {study.done && <CheckCircle2 className="w-3.5 h-3.5" />}
              </Button>
            )}
          </div>
        </div>
        {courseLabel && (
          <div
            className={cn(
              "text-caption font-semibold truncate leading-tight",
              p.subtext,
              study.done && "line-through opacity-70",
            )}
          >
            {courseLabel}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between gap-1 text-caption font-mono pt-0.5">
          <span className="truncate shrink min-w-0 opacity-90">
            {study.start_time}–{study.end_time}
          </span>
          <span
            className={cn(
              "px-1.5 py-0.5 rounded shrink-0 inline-flex items-center gap-1 text-caption font-sans font-bold",
              p.chip,
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", p.dot)} />
            {priorityLabel} · {study.durationMinutes}د
          </span>
        </div>
      </div>
    </td>
  );
}
