"use client";

import { useMemo } from "react";
import { CalendarClock, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  daysUntil,
  parseLocalDate,
  weekdayNameFromDate,
} from "@/lib/schedule-grid";
import {
  isDatedEvent,
  type PlanPriority,
  type PlanTask,
  type PlanTaskType,
} from "@/store/planStore";

export interface RegisteredEventsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: PlanTask[];
  onEdit: (task: PlanTask) => void;
  onDelete: (task: PlanTask) => void;
}

const PRIORITY_LABEL: Record<PlanPriority, string> = {
  high: "عالية",
  medium: "متوسطة",
  low: "خفيفة",
};

const PRIORITY_CHIP: Record<PlanPriority, string> = {
  high: "bg-rose-500/20 text-rose-700 dark:text-rose-200 border-rose-500/40",
  medium: "bg-violet-500/20 text-violet-700 dark:text-violet-200 border-violet-500/40",
  low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-500/40",
};

const TASK_TYPE_LABEL: Record<PlanTaskType, string> = {
  study: "مذاكرة",
  exam: "اختبار",
  quiz: "كويز",
  assignment: "واجب",
  project: "مشروع",
  other: "أخرى",
};

/** "اليوم" / "غداً" / "بعد N يوم" / "متأخر N يوم". */
function remainingLabel(iso: string): string {
  const n = daysUntil(iso);
  if (n === null) return "";
  if (n === 0) return "اليوم";
  if (n === 1) return "غداً";
  if (n === -1) return "متأخر يوم";
  if (n > 1) return `بعد ${n} يوم`;
  return `متأخر ${Math.abs(n)} يوم`;
}

function remainingTone(iso: string): string {
  const n = daysUntil(iso);
  if (n === null) return "text-muted-foreground";
  if (n < 0) return "text-rose-700 dark:text-rose-300";
  if (n === 0) return "text-amber-800 dark:text-amber-300";
  if (n <= 3) return "text-amber-800 dark:text-amber-200/90";
  return "text-emerald-700 dark:text-emerald-200/90";
}

function formatDate(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return iso;
  const weekday = weekdayNameFromDate(d);
  return `${weekday} · ${iso}`;
}

export function RegisteredEventsDialog({
  open,
  onOpenChange,
  tasks,
  onEdit,
  onDelete,
}: RegisteredEventsDialogProps) {
  const events = useMemo(
    () =>
      tasks
        .filter(isDatedEvent)
        .slice()
        .sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? "")),
    [tasks],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-lg gap-0 p-0 overflow-hidden rounded-2xl",
          "bg-card border border-border shadow-2xl backdrop-blur-xl",
          "[&_[data-slot=dialog-close]]:text-muted-foreground [&_[data-slot=dialog-close]]:hover:text-foreground",
        )}
        dir="rtl"
      >
        <DialogHeader className="px-6 pt-6 pb-2 text-right space-y-1">
          <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-uqu-accent" />
            الأحداث المسجلة
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            المهام والأحداث المرتبطة بتاريخ محدد. تظهر في الجدول فقط ضمن أسبوعها،
            وتبقى محفوظة دائماً هنا.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 pt-2 space-y-2.5 max-h-[min(60vh,480px)] overflow-y-auto">
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-secondary/50 dark:border-white/10 dark:bg-white/[0.02] px-4 py-10 text-center text-sm text-muted-foreground">
              لا توجد أحداث مسجلة بعد. أضف جلسة وحدّد لها تاريخاً لتظهر هنا.
            </div>
          ) : (
            events.map((task) => {
              const iso = task.targetDate as string;
              const courseLabel =
                task.courseName?.trim() || task.courseCode || "—";
              const typeLabel = task.taskType
                ? TASK_TYPE_LABEL[task.taskType]
                : null;
              return (
                <div
                  key={`${iso}-${task.suggestedTime}-${task.courseCode}-${task.title}`}
                  className="rounded-xl border border-border bg-secondary/80 dark:border-white/10 dark:bg-[#1c1c1c] p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-foreground truncate">
                          {task.title}
                        </h4>
                        {typeLabel && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-foreground/5 border border-border text-muted-foreground dark:bg-white/5 dark:border-white/10 shrink-0">
                            {typeLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {courseLabel}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onEdit(task)}
                        className="w-8 h-8 rounded-md border border-violet-300/40 flex items-center justify-center text-violet-700 dark:text-violet-200/90 hover:bg-violet-500/25 transition-colors"
                        aria-label="تعديل الحدث"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(task)}
                        className="w-8 h-8 rounded-md border border-rose-400/35 flex items-center justify-center text-rose-700 dark:text-rose-200/90 hover:bg-rose-500/20 transition-colors"
                        aria-label="حذف الحدث"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
                    <span className="font-mono text-muted-foreground">
                      {formatDate(iso)} · {task.suggestedTime}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={cn("font-semibold", remainingTone(iso))}>
                        {remainingLabel(iso)}
                      </span>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-md border",
                          PRIORITY_CHIP[task.priority],
                        )}
                      >
                        {PRIORITY_LABEL[task.priority]}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
