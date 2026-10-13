"use client";

import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { minutesLabel, weekdayAr, type ExamStudyPlan } from "@/lib/exams";
import { formatExamDate } from "@/components/exams/exam-card";

const DAILY_CHOICES = [60, 120, 180, 240, 300, 360];

export function ExamStudyPlanCard({
  plan,
  today,
  dailyMinutes,
  onDailyMinutes,
  done,
  onToggle,
}: {
  plan: ExamStudyPlan;
  today: string;
  dailyMinutes: number;
  onDailyMinutes: (m: number) => void;
  done: Record<string, true>;
  onToggle: (key: string) => void;
}) {
  const tight = plan.coverage.filter((c) => plan.tight.includes(c.examId));
  return (
    <Card className="glass rounded-[32px] border-foreground/10 p-6 md:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">خطة المذاكرة قبل الاختبارات</h2>
          <p className="text-sm text-muted-foreground mt-1">
            وقت أكثر للأقرب والأثقل، ومراجعة نهائية في اليوم الذي قبل كل اختبار.
          </p>
        </div>
        <label className="text-sm font-bold flex items-center gap-2">
          وقتي اليومي
          <select
            value={dailyMinutes}
            onChange={(e) => onDailyMinutes(Number(e.target.value))}
            className="h-10 rounded-xl px-3 border bg-background border-border dark:bg-foreground/5 dark:border-foreground/10"
          >
            {DAILY_CHOICES.map((m) => (
              <option key={m} value={m}>{minutesLabel(m)}</option>
            ))}
          </select>
        </label>
      </div>

      {tight.length > 0 && (
        <p className="flex items-start gap-2 text-sm font-bold text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          الوقت ضيق لـ {tight.map((t) => t.subject).join("، ")} — زد وقتك اليومي أو ابدأ بالأهم.
        </p>
      )}

      <ol className="space-y-3">
        {plan.days.map((day) => (
          <li key={day.date} className={cn("rounded-2xl border border-foreground/10 p-4", day.date === today && "border-uqu-accent/40 bg-uqu-accent/[0.04]")}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="font-black text-sm">
                {day.date === today ? "اليوم" : weekdayAr(day.date)} · {formatExamDate(day.date)}
              </span>
              {day.examsToday.length > 0 && (
                <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                  اختبار: {day.examsToday.map((e) => e.subject).join("، ")}
                </span>
              )}
            </div>
            {day.sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground">بالتوفيق في اختبارك 🤲</p>
            ) : (
              <ul className="space-y-1.5">
                {day.sessions.map((s) => {
                  const checked = !!done[s.key];
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        onClick={() => onToggle(s.key)}
                        aria-pressed={checked}
                        className="w-full flex items-center gap-3 text-right rounded-xl px-3 py-2 hover:bg-foreground/5"
                      >
                        {checked ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" aria-hidden />
                        ) : (
                          <Circle className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden />
                        )}
                        <span className={cn("flex-1 text-sm font-bold", checked && "line-through text-muted-foreground")}>
                          {s.finalReview ? "مراجعة نهائية: " : ""}
                          {s.subject}
                        </span>
                        <span className="text-xs font-bold text-muted-foreground">{minutesLabel(s.minutes)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
