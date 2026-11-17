"use client";

import { useEffect, useState } from "react";
import { Clock, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { countdown, weekdayAr, type Exam } from "@/lib/exams";
import { formatExamDate } from "@/components/exams/exam-card";

/** Big countdown to the next exam (ticks every 30 s). */
export function NextExamHero({ exam }: { exam: Exam }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const c = countdown(exam, now);
  const units: [number, string][] = [
    [c.days, "يوم"],
    [c.hours, "ساعة"],
    [c.minutes, "دقيقة"],
  ];
  return (
    <Card className="border shadow-card rounded-card border-info-line bg-info-soft p-6 md:p-8">
      <div className="text-caption font-bold text-info-ink mb-2">اختبارك القادم</div>
      <h2 className="text-heading md:text-title font-bold mb-2">{exam.subject}</h2>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-muted mb-5">
        <span>
          {weekdayAr(exam.date)} {formatExamDate(exam.date)}
        </span>
        {exam.time && (
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" aria-hidden /> {exam.time}
          </span>
        )}
        {exam.location && (
          <span className="flex items-center gap-1">
            <MapPin className="w-4 h-4" aria-hidden /> {exam.location}
          </span>
        )}
      </div>
      {c.started ? (
        <div className="text-subheading font-bold">بدأ الاختبار — بالتوفيق! 🤲</div>
      ) : (
        <div className="flex gap-3" role="timer" aria-label={`باقي ${c.days} يوم و${c.hours} ساعة و${c.minutes} دقيقة`}>
          {units.map(([n, label]) => (
            <div key={label} className="min-w-[72px] rounded-card bg-surface border border-line px-3 py-2 text-center">
              <div className="text-title font-bold font-mono leading-none">{n}</div>
              <div className="text-caption font-bold text-ink-muted mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
