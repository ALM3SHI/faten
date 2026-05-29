"use client";

import { CheckCircle2, Pencil, Trash2 } from "lucide-react";
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
  { border: string; bg: string; inner: string; chip: string; dot: string }
> = {
  high: {
    border: "border-rose-500/40",
    bg: "bg-rose-500/[0.06]",
    inner: "bg-rose-500/20 border-rose-500/45 text-rose-50",
    chip: "bg-rose-500/25 text-rose-200",
    dot: "bg-rose-400",
  },
  medium: {
    border: "border-violet-500/40",
    bg: "bg-violet-500/[0.06]",
    inner: "bg-violet-500/20 border-violet-500/45 text-violet-50",
    chip: "bg-violet-500/25 text-violet-200",
    dot: "bg-violet-400",
  },
  low: {
    border: "border-emerald-500/35",
    bg: "bg-emerald-500/[0.05]",
    inner: "bg-emerald-500/15 border-emerald-500/40 text-emerald-50",
    chip: "bg-emerald-500/20 text-emerald-200",
    dot: "bg-emerald-400",
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
  subtitle,
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
        "glass rounded-2xl overflow-hidden w-full py-0 gap-0 ring-0 border-0",
        className,
      )}
    >
      <div className="px-5 py-4 border-b border-foreground/10 bg-foreground/5 flex items-center justify-between gap-3 rounded-t-[inherit]">
        <h2 className="text-base font-bold">{title}</h2>
        {!hasAnyBlock && emptyHint && (
          <p className="text-xs text-amber-400/90 font-medium shrink-0">{emptyHint}</p>
        )}
      </div>

      <div className="min-w-0 overflow-x-auto">
        <div
          className="overflow-y-auto max-h-[min(78vh,1100px)] w-full"
          style={{ scrollbarGutter: "stable" }}
        >
          <table
            className="w-full border-collapse text-sm table-fixed"
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
                <th className="sticky right-0 z-30 bg-card border border-foreground/10 px-1 py-2.5 text-[11px] font-mono font-semibold text-muted-foreground text-center">
                  الوقت
                </th>
                {days.map((day) => (
                  <th
                    key={day}
                    className={cn(
                      "bg-card border border-foreground/10 p-2.5 text-sm font-bold",
                      day === todayColumn &&
                        "bg-uqu-accent/15 text-uqu-accent border-uqu-accent/40",
                    )}
                  >
                    {day}
                    {day === todayColumn && (
                      <span className="mr-1 text-[10px] font-medium text-uqu-accent/80">
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
                  <td className="sticky right-0 z-10 bg-card border border-foreground/10 px-1 py-2 text-[11px] font-mono font-semibold text-muted-foreground text-center align-top">
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
        <p className="px-5 py-3 text-xs text-amber-400/90 border-t border-foreground/10 bg-amber-500/[0.04]">
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
        "border border-foreground/10 p-1.5 align-top",
        isToday ? "bg-uqu-accent/[0.04]" : "bg-transparent",
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
          ? "border-amber-500/30 bg-amber-500/[0.06]"
          : "border-[#0066cc]/30 bg-[#0066cc]/[0.06]",
      )}
      style={{ height: duration * rowHeightPx }}
    >
      <div
        className={cn(
          "h-full w-full rounded-lg border p-3 flex flex-col gap-1.5 relative overflow-hidden",
          isLab
            ? "bg-amber-500/15 border-amber-500/40 text-amber-100"
            : "bg-[#0066cc]/15 border-[#0066cc]/40 text-foreground",
        )}
      >
        <div className="text-sm font-bold leading-snug line-clamp-3">
          {lectureDisplayName(slot)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-1 text-[10px] font-mono opacity-70">
          <span>
            {slot.start_time}–{slot.end_time}
          </span>
          <span className="px-2 py-0.5 rounded bg-black/30 shrink-0">
            {isLab ? "عملي" : "نظري"}
            {duration > 1 ? ` · ${duration}س` : ""}
          </span>
        </div>
        {slot.room && (
          <div className="text-[10px] opacity-60 truncate">
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
          "group h-full w-full rounded-lg border p-3 flex flex-col gap-2 relative overflow-hidden transition-opacity",
          p.inner,
          study.done && "opacity-55",
        )}
      >
        <div className="flex items-start justify-between gap-2 shrink-0">
          {courseLabel ? (
            <span
              className={cn(
                "text-xs font-semibold truncate flex-1 leading-snug",
                study.done && "line-through opacity-70",
              )}
            >
              {courseLabel}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <div className="flex items-center gap-2 shrink-0">
            {interactive && onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(study);
                }}
                className="w-7 h-7 rounded-md border border-violet-300/40 flex items-center justify-center text-violet-200/90 hover:bg-violet-500/25 transition-colors"
                aria-label="تعديل الجلسة"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {interactive && onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(study);
                }}
                className="w-7 h-7 rounded-md border border-rose-400/35 flex items-center justify-center text-rose-200/90 hover:bg-rose-500/20 transition-colors"
                aria-label="حذف الجلسة"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {onToggle && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(study.taskKey);
                }}
                className={cn(
                  "w-7 h-7 rounded-full border flex items-center justify-center transition-all",
                  study.done
                    ? "bg-violet-500 border-violet-400 text-white"
                    : "border-violet-300/50 hover:border-violet-300 text-violet-200/80",
                )}
                aria-label={study.done ? "إلغاء الإتمام" : "وضع علامة منجز"}
              >
                {study.done && <CheckCircle2 className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
        <div
          className={cn(
            "text-sm font-bold leading-snug line-clamp-3",
            study.done && "line-through opacity-70",
          )}
        >
          {study.title}
        </div>
        <div className="mt-auto flex items-center justify-between gap-1 text-[11px] font-mono opacity-80">
          <span>
            {study.start_time}–{study.end_time}
          </span>
          <span className={cn("px-2 py-0.5 rounded shrink-0 inline-flex items-center gap-1", p.chip)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", p.dot)} />
            {priorityLabel} · {study.durationMinutes}د
          </span>
        </div>
      </div>
    </td>
  );
}
