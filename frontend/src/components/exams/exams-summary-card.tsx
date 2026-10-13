"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useHydrated } from "@/lib/use-hydrated";
import { dayKey, daysBetween, findConflicts, upcomingExams, whenLabel } from "@/lib/exams";
import { useExamsStore } from "@/store/examsStore";

/** Dashboard card: the next exams with their countdown. */
export function ExamsSummaryCard() {
  const mounted = useHydrated();
  const exams = useExamsStore((s) => s.exams);
  const today = mounted ? dayKey(new Date()) : "";
  const next = mounted ? upcomingExams(exams, today).slice(0, 3) : [];
  const overlaps = mounted ? findConflicts(upcomingExams(exams, today)).filter((c) => c.kind === "overlap").length : 0;

  return (
    <Link href="/exams" prefetch={false} className="block h-full focus:outline-none">
      <Card className="glass p-6 md:p-8 rounded-[32px] border-foreground/10 h-full flex flex-col hover:border-uqu-accent/30 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-uqu-accent" />
            الاختبارات
          </h3>
          <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
        </div>
        {!mounted ? (
          <div className="h-24 rounded-2xl bg-foreground/5 animate-pulse" />
        ) : next.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-7">
            أضف مواعيد اختباراتك — نعدّ لك الأيام وننبهك للتعارض ونوزّع مذاكرتك قبل كل اختبار.
          </p>
        ) : (
          <ul className="space-y-3">
            {next.map((e) => {
              const days = daysBetween(today, e.date);
              return (
                <li key={e.id} className="flex items-center justify-between gap-3">
                  <span className="font-bold text-sm truncate">{e.subject}</span>
                  <span className={days <= 3 ? "text-sm font-black text-rose-600 dark:text-rose-400 shrink-0" : "text-sm font-black text-uqu-accent shrink-0"}>
                    {whenLabel(days)}
                  </span>
                </li>
              );
            })}
            {overlaps > 0 && (
              <li className="text-xs font-bold text-rose-600 dark:text-rose-400">⚠️ يوجد تعارض في المواعيد</li>
            )}
          </ul>
        )}
      </Card>
    </Link>
  );
}
