"use client";

import { CheckCircle2, Clock, MapPin, Pencil, Trash2 } from "lucide-react";
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
        "rounded-2xl border p-4 flex items-start gap-4 bg-card",
        clash === "overlap" ? "border-rose-500/40" : clash === "same_day" ? "border-amber-500/40" : "border-foreground/10",
        past && "opacity-60",
      )}
    >
      <div className="w-14 shrink-0 rounded-xl bg-uqu-accent/10 border border-uqu-accent/20 text-center py-2">
        <div className="text-[11px] font-bold text-muted-foreground">{weekdayAr(exam.date)}</div>
        <div className="text-lg font-black leading-tight">{exam.date.slice(8)}</div>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-black truncate">{exam.subject}</h3>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-foreground/5 border border-foreground/10">
            {EXAM_TYPE_LABELS[exam.exam_type]}
          </span>
          {exam.course_code && <span className="text-[11px] font-mono text-muted-foreground">{exam.course_code}</span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
        <div className={cn("text-sm font-bold", past ? "text-muted-foreground" : days <= 3 ? "text-rose-600 dark:text-rose-400" : "text-uqu-accent")}>
          {exam.done ? "تم ✔" : days < 0 ? "انتهى" : whenLabel(days)}
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button type="button" onClick={onToggleDone} className="p-2 rounded-lg text-muted-foreground hover:text-emerald-600" aria-label={exam.done ? `إلغاء إنهاء ${exam.subject}` : `إنهاء ${exam.subject}`}>
          <CheckCircle2 className="w-4 h-4" />
        </button>
        <button type="button" onClick={onEdit} className="p-2 rounded-lg text-muted-foreground hover:text-foreground" aria-label={`تعديل ${exam.subject}`}>
          <Pencil className="w-4 h-4" />
        </button>
        <button type="button" onClick={onDelete} className="p-2 rounded-lg text-muted-foreground hover:text-rose-500" aria-label={`حذف ${exam.subject}`}>
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
}
