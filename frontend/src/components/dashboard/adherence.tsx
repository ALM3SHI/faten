"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ListChecks, CheckCircle2 } from "lucide-react";
import { PanelRoot } from "@/components/dashboard/panel-root";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlanStore, taskKey } from "@/store/planStore";

// ──────────────────────────────────────────────────────────────────
// Bottom Row — Adherence Indicator
// ──────────────────────────────────────────────────────────────────

export function AdherenceCard({
  completed,
  total,
  pct,
  hasPlan,
  bare,
}: {
  completed: number;
  total: number;
  pct: number;
  hasPlan: boolean;
  /** Inside the dashboard's tabbed card: no card chrome, title kept for screen readers. */
  bare?: boolean;
}) {
  const tone =
    pct >= 70
      ? "emerald"
      : pct >= 40
        ? "uqu"
        : "rose";

  const toneClasses = {
    emerald: {
      ring: "stroke-emerald-400",
      glow: "drop-shadow(0 0 8px hsla(160,80%,50%,0.5))",
      pill: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
      icon: "text-emerald-700 dark:text-emerald-400",
    },
    uqu: {
      ring: "stroke-uqu-accent",
      glow: "drop-shadow(0 0 8px hsla(245,78%,62%,0.5))",
      pill: "bg-uqu-accent/15 text-uqu-accent border-uqu-accent/30",
      icon: "text-uqu-accent",
    },
    rose: {
      ring: "stroke-rose-400",
      glow: "drop-shadow(0 0 8px hsla(0,80%,60%,0.4))",
      pill: "bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-500/30",
      icon: "text-rose-700 dark:text-rose-400",
    },
  } as const;

  const t = toneClasses[tone];
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(1, pct / 100));

  const headline = !hasPlan
    ? "لم تُولَّد خطة بعد"
    : total === 0
      ? "لا توجد مهام في الخطة"
      : pct >= 70
        ? "انضباط ممتاز 🔥"
        : pct >= 40
          ? "تقدّم جيد — استمر"
          : "ركّز على إكمال مهام اليوم";

  // No plan yet: one line and the button, not an empty ring of zeros.
  if (!hasPlan) {
    return (
      <PanelRoot bare={bare} className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden">
        <h3 className={cn("text-xl font-bold mb-1 flex items-center gap-2", bare && "sr-only")}>
          <ListChecks className="w-5 h-5 text-uqu-accent" />
          مؤشر الانضباط
        </h3>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between py-2">
          <p className="text-sm text-muted-foreground leading-7">
            ولّد خطة مذاكرة لهذا الأسبوع، وهنا تشوف كم أنجزت من مهامها.
          </p>
          <Link href="/plan" prefetch={false} onClick={(e) => e.stopPropagation()} className="shrink-0">
            <Button className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2">ولّد خطتك الذكية</Button>
          </Link>
        </div>
      </PanelRoot>
    );
  }

  return (
    <PanelRoot bare={bare} className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden">
      <div className={cn("flex items-center justify-between flex-wrap gap-3", bare ? "mb-3" : "mb-5")}>
        <div className={cn(bare && "sr-only")}>
          <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
            <ListChecks className={cn("w-5 h-5", t.icon)} />
            مؤشر الانضباط
          </h3>
          <p className="text-sm text-muted-foreground">
            نسبة إنجازك من مهام خطتك الذكية لهذا الأسبوع.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn("text-[10px] font-bold", t.pill)}
        >
          {headline}
        </Badge>
      </div>

      <div className="grid grid-cols-[140px_1fr] gap-6 items-center">
        {/* Progress ring */}
        <div className="relative w-[140px] h-[140px] mx-auto">
          <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={10}
            />
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              className={t.ring}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{
                transition: "stroke-dashoffset 700ms ease-out",
                filter: t.glow,
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-3xl font-black font-mono">{pct}%</div>
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">
              إنجاز
            </div>
          </div>
        </div>

        {/* Numbers */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-bold text-muted">المهام المكتملة</span>
            <span className="font-mono font-black text-lg">{completed}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-bold text-muted">إجمالي مهام الخطة</span>
            <span className="font-mono font-black text-lg">{total}</span>
          </div>
          <div className="flex items-baseline justify-between pt-3 border-t border-foreground/10">
            <span className="text-[12px] font-bold text-muted">المتبقي</span>
            <span className="font-mono font-black text-lg text-foreground">
              {Math.max(0, total - completed)}
            </span>
          </div>
          {/* stopPropagation so the inner CTA navigates rather than
              opening the parent card's adherence drill-down dialog. */}
          {hasPlan && total > 0 ? (
            <Link href="/plan" prefetch={false} onClick={(e) => e.stopPropagation()}>
              <Button
                variant="outline"
                className="w-full rounded-xl glass border-foreground/10 gap-2 mt-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                إدارة المهام
              </Button>
            </Link>
          ) : (
            <Link href="/plan" prefetch={false} onClick={(e) => e.stopPropagation()}>
              <Button className="w-full rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 mt-2">
                ولّد خطتك الذكية
              </Button>
            </Link>
          )}
        </div>
      </div>
    </PanelRoot>
  );
}


// Sun=0 … Sat=6, matching Date.getDay().
const AR_WEEK = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** Plan adherence — purely client-side from planStore. */
export function usePlanAdherence() {
  const plan = usePlanStore((s) => s.plan);
  const completedTaskKeys = usePlanStore((s) => s.completed);

  const adherence = useMemo(() => {
    const tasks = plan?.tasks ?? [];
    const total = tasks.length;
    if (total === 0) return { completed: 0, total: 0, pct: 0 };
    const completedSet = new Set(completedTaskKeys);
    const done = tasks.filter((t) => completedSet.has(taskKey(t))).length;
    return { completed: done, total, pct: Math.round((done / total) * 100) };
  }, [plan, completedTaskKeys]);

  // "Overdue" = scheduled on a weekday earlier than today THIS week,
  // not in the completed set. Tasks aren't dated, so we approximate
  // using Sun=0..Sat=6 ordering within the current week.
  const overdueTasks = useMemo(() => {
    const tasks = plan?.tasks ?? [];
    if (tasks.length === 0) return [];
    const completedSet = new Set(completedTaskKeys);
    const todayIdx = new Date().getDay();
    return tasks.filter((t) => {
      const i = AR_WEEK.indexOf(t.suggestedDay);
      if (i < 0) return false;
      return i < todayIdx && !completedSet.has(taskKey(t));
    });
  }, [plan, completedTaskKeys]);

  // Per-weekday rollup in Sun→Sat order so the chart reads chronologically.
  const perDay = useMemo(() => {
    const tasks = plan?.tasks ?? [];
    const completedSet = new Set(completedTaskKeys);
    return AR_WEEK.map((day) => {
      const dayTasks = tasks.filter((t) => t.suggestedDay === day);
      const dayDone = dayTasks.filter((t) => completedSet.has(taskKey(t))).length;
      const dayTotal = dayTasks.length;
      return {
        day,
        total: dayTotal,
        done: dayDone,
        pct: dayTotal === 0 ? 0 : Math.round((dayDone / dayTotal) * 100),
      };
    });
  }, [plan, completedTaskKeys]);

  return { adherence, overdueTasks, perDay, hasPlan: !!plan };
}
