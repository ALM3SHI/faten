"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarX2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useScheduleStore } from "@/store/scheduleStore";
import { useAttendanceStore } from "@/store/attendanceStore";
import { getCurrentTerm } from "@/lib/academic-term";
import { absenceStatus, coursesFromSchedule, estimateSessions, type AbsenceLevel } from "@/lib/attendance";
import { cn } from "@/lib/utils";

const RANK: Record<AbsenceLevel, number> = { safe: 0, warning: 1, danger: 2, deprived: 3 };
const TONE: Record<AbsenceLevel, string> = {
  safe: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-orange-600 dark:text-orange-400",
  deprived: "text-rose-600 dark:text-rose-400",
};

export function AttendanceSummaryCard() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const schedule = useScheduleStore((s) => s.schedule);
  const records = useAttendanceStore((s) => s.courses);

  const rows = useMemo(() => {
    const term = getCurrentTerm(new Date());
    return coursesFromSchedule(schedule)
      .map((c) => {
        const r = records[c.code];
        const st = absenceStatus(r?.entries ?? [], r?.totalOverride ?? estimateSessions(c, term));
        return { code: c.code, name: c.name, st };
      })
      .sort((a, b) => RANK[b.st.level] - RANK[a.st.level] || a.st.remaining - b.st.remaining);
  }, [schedule, records]);

  const worst = rows[0];
  const atRisk = rows.filter((r) => r.st.level !== "safe").length;

  return (
    <Link href="/attendance" className="block h-full focus:outline-none" aria-label="افتح متابعة الغياب">
      <Card className="glass p-6 md:p-8 rounded-[32px] border-foreground/10 h-full flex flex-col hover:border-uqu-accent/30 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <CalendarX2 className="w-5 h-5 text-uqu-accent" />
            الغياب
          </h3>
          <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
        </div>

        {!mounted ? (
          <div className="h-24 rounded-2xl bg-foreground/5 animate-pulse" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-7">
            ارفع جدولك وسجّل غيابك — ننبهك قبل ما توصل لحد الحرمان (15% بدون عذر).
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              {atRisk ? (
                <ShieldAlert className={cn("w-9 h-9", TONE[worst.st.level])} />
              ) : (
                <ShieldCheck className="w-9 h-9 text-emerald-500" />
              )}
              <div>
                <div className="font-black text-lg">
                  {atRisk ? `${atRisk} ${atRisk === 1 ? "مقرر يحتاج انتباه" : "مقررات تحتاج انتباه"}` : "كل مقرراتك بأمان"}
                </div>
                <div className="text-xs text-muted-foreground">من أصل {rows.length} مقررات في جدولك</div>
              </div>
            </div>
            <ul className="space-y-1.5 text-sm">
              {rows.slice(0, 3).map((r) => (
                <li key={r.code} className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.name}</span>
                  <span className={cn("shrink-0 text-xs font-bold", TONE[r.st.level])}>
                    {r.st.level === "deprived" ? "تجاوز الحد" : `باقي ${r.st.remaining}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </Link>
  );
}
