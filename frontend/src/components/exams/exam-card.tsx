"use client";

import { CheckCircle2, Clock, MapPin, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/button";
import { cn } from "@/lib/utils";
import { EXAM_TYPE_LABELS, daysBetween, weekdayAr, whenLabel, type Exam } from "@/lib/exams";

export function formatExamDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
}

export function ExamCard({
  exam,
  today,
  clash,
  onEdit,
  onDelete,
  onToggleDone,
}: {
  exam: Exam;
  today: string;
  clash?: "overlap" | "same_day";
  onEdit: () => void;
  onDelete: () => void;
  onToggleDone: () => void;
}) {
  const days = daysBetween(today, exam.date);
  const past = days < 0 || exam.done;
  return (
    <li
      className={cn(
        "rounded-card border p-4 flex items-start gap-4 bg-surface",
        clash === "overlap" ? "border-danger-line" : clash === "same_day" ? "border-warning-line" : "border-line",
        past && "opacity-60",
      )}
    >
      <div className="w-14 shrink-0 rounded-control bg-info-soft border border-info-line text-center py-2">
        <div className="text-caption font-bold text-ink-muted">{weekdayAr(exam.date)}</div>
        <div className="text-subheading font-bold leading-tight">{exam.date.slice(8)}</div>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold truncate">{exam.subject}</h3>
          <span className="text-caption font-bold px-2 py-0.5 rounded-md bg-surface-sunken border border-line">
            {EXAM_TYPE_LABELS[exam.exam_type]}
          </span>
          {exam.course_code && <span className="text-caption font-mono text-ink-muted">{exam.course_code}</span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted">
          <span>{formatExamDate(exam.date)}</span>
          {exam.time && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" aria-hidden /> {exam.time}
            </span>
          )}
          {exam.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" aria-hidden /> {exam.location}
            </span>
          )}
        </div>
        <div className={cn("text-small font-bold", past ? "text-ink-muted" : days <= 3 ? "text-danger-ink " : "text-info-ink")}>
          {exam.done ? "تم ✔" : days < 0 ? "انتهى" : whenLabel(days)}
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button variant="bare" type="button" onClick={onToggleDone} className="p-2 rounded-control text-ink-muted hover:text-success-ink" aria-label={exam.done ? `إلغاء إنهاء ${exam.subject}` : `إنهاء ${exam.subject}`}>
          <CheckCircle2 className="w-4 h-4" />
        </Button>
        <Button variant="bare" type="button" onClick={onEdit} className="p-2 rounded-control text-ink-muted hover:text-ink" aria-label={`تعديل ${exam.subject}`}>
          <Pencil className="w-4 h-4" />
        </Button>
        <Button variant="bare" type="button" onClick={onDelete} className="p-2 rounded-control text-ink-muted hover:text-danger-ink" aria-label={`حذف ${exam.subject}`}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </li>
  );
}
