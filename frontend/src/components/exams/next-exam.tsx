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
    <Card className="glass rounded-[32px] border-uqu-accent/30 bg-gradient-to-l from-uqu-accent/[0.08] to-transparent p-6 md:p-8">
      <div className="text-xs font-black text-uqu-accent mb-2">اختبارك القادم</div>
      <h2 className="text-2xl md:text-3xl font-black mb-2">{exam.subject}</h2>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mb-5">
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
        <div className="text-lg font-black">بدأ الاختبار — بالتوفيق! 🤲</div>
      ) : (
        <div className="flex gap-3" role="timer" aria-label={`باقي ${c.days} يوم و${c.hours} ساعة و${c.minutes} دقيقة`}>
          {units.map(([n, label]) => (
            <div key={label} className="min-w-[72px] rounded-2xl bg-background/70 border border-foreground/10 px-3 py-2 text-center">
              <div className="text-3xl font-black font-mono leading-none">{n}</div>
              <div className="text-[11px] font-bold text-muted-foreground mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
