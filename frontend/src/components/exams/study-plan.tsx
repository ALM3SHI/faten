"use client";

import { useState } from "react";
import { Button } from "@/components/ds/button";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { minutesLabel, weekdayAr, type ExamStudyPlan } from "@/lib/exams";
import { formatExamDate } from "@/components/exams/exam-card";

const DAILY_CHOICES = [60, 120, 180, 240, 300, 360];
/** Days shown before «عرض كل الأيام»; the rest are one tap away. */
const VISIBLE_DAYS = 3;

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
  const [showAll, setShowAll] = useState(false);
  const days = showAll ? plan.days : plan.days.slice(0, VISIBLE_DAYS);
  const hidden = plan.days.length - days.length;
  return (
    <Card className="border border-line bg-surface shadow-card rounded-card p-6 md:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-heading font-bold">خطة المذاكرة قبل الاختبارات</h2>
          <p className="text-small text-ink-muted mt-1">
            وقت أكثر للأقرب والأثقل، ومراجعة نهائية في اليوم الذي قبل كل اختبار.
          </p>
        </div>
        <label className="text-small font-bold flex items-center gap-2">
          وقتي اليومي
          <select
            value={dailyMinutes}
            onChange={(e) => onDailyMinutes(Number(e.target.value))}
            className="h-10 rounded-control px-3 border bg-surface border-line"
          >
            {DAILY_CHOICES.map((m) => (
              <option key={m} value={m}>{minutesLabel(m)}</option>
            ))}
          </select>
        </label>
      </div>

      {tight.length > 0 && (
        <p className="flex items-start gap-2 text-small font-bold text-warning-ink bg-warning-soft border border-warning-line rounded-card p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          الوقت ضيق لـ {tight.map((t) => t.subject).join("، ")} — زد وقتك اليومي أو ابدأ بالأهم.
        </p>
      )}

      <ol className="space-y-3" id="exam-plan-days">
        {days.map((day) => (
          <li key={day.date} className={cn("rounded-card border border-line p-4", day.date === today && "border-info-line bg-info-soft")}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="font-bold text-small">
                {day.date === today ? "اليوم" : weekdayAr(day.date)} · {formatExamDate(day.date)}
              </span>
              {day.examsToday.length > 0 && (
                <span className="text-caption font-bold text-danger-ink">
                  اختبار: {day.examsToday.map((e) => e.subject).join("، ")}
                </span>
              )}
            </div>
            {day.sessions.length === 0 ? (
              <p className="text-caption text-ink-muted">بالتوفيق في اختبارك 🤲</p>
            ) : (
              <ul className="space-y-1.5">
                {day.sessions.map((s) => {
                  const checked = !!done[s.key];
                  return (
                    <li key={s.key}>
                      <Button variant="bare"
                        type="button"
                        onClick={() => onToggle(s.key)}
                        aria-pressed={checked}
                        className="w-full flex items-center gap-3 text-right rounded-control px-3 py-2 hover:bg-surface-sunken"
                      >
                        {checked ? (
                          <CheckCircle2 className="w-5 h-5 text-success-ink shrink-0" aria-hidden />
                        ) : (
                          <Circle className="w-5 h-5 text-ink-muted shrink-0" aria-hidden />
                        )}
                        <span className={cn("flex-1 text-small font-bold", checked && "line-through text-ink-muted")}>
                          {s.finalReview ? "مراجعة نهائية: " : ""}
                          {s.subject}
                        </span>
                        <span className="text-caption font-bold text-ink-muted">{minutesLabel(s.minutes)}</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {(hidden > 0 || showAll) && plan.days.length > VISIBLE_DAYS && (
        <Button variant="bare"
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          aria-controls="exam-plan-days"
          className="w-full rounded-control border border-line py-2.5 text-small font-bold text-info-ink hover:bg-info-soft"
        >
          {showAll ? "عرض أقرب الأيام فقط" : `عرض كل الأيام (${plan.days.length})`}
        </Button>
      )}
    </Card>
  );
}
