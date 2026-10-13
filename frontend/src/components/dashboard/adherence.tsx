"use client";

import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ListChecks, ArrowUpRight, CheckCircle2, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { usePlanStore, taskKey, type PlanTask } from "@/store/planStore";
import { DialogStat } from "@/components/dashboard/stat-tiles";

// ──────────────────────────────────────────────────────────────────
// Bottom Row — Adherence Indicator
// ──────────────────────────────────────────────────────────────────

export function AdherenceCard({
  completed,
  total,
  pct,
  hasPlan,
}: {
  completed: number;
  total: number;
  pct: number;
  hasPlan: boolean;
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

  return (
    <Card className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
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
            <Link href="/plan" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="outline"
                className="w-full rounded-xl glass border-foreground/10 gap-2 mt-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                إدارة المهام
              </Button>
            </Link>
          ) : (
            <Link href="/plan" onClick={(e) => e.stopPropagation()}>
              <Button className="w-full rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 mt-2">
                ولّد خطتك الذكية
              </Button>
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}


// ── 4. Adherence Dialog ──────────────────────────────────────────
export function AdherenceDialogContent({
  completed,
  total,
  pct,
  hasPlan,
  perDay,
  overdueTasks,
  onOpenRollover,
}: {
  completed: number;
  total: number;
  pct: number;
  hasPlan: boolean;
  perDay: { day: string; total: number; done: number; pct: number }[];
  /** Sprint-5: tasks scheduled before today this week that aren't done. */
  overdueTasks: PlanTask[];
  onOpenRollover: () => void;
}) {
  return (
    <DialogContent
      className="!bg-card border-border text-foreground shadow-2xl backdrop-blur-xl dark:!bg-card/95 dark:border-foreground/10 rounded-[28px] p-0 sm:max-w-[min(760px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-border dark:border-foreground/10 shrink-0">
        <DialogTitle className="text-xl font-black flex items-center gap-3">
          <ListChecks className="w-6 h-6 text-uqu-accent" />
          تحليل الانضباط الدراسي
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          توزيع نسبة إنجاز مهام خطتك الذكية على أيام الأسبوع.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Sprint-5: Overdue carry-over section pinned to the top of
            today's view so the user sees the backlog before the chart. */}
        {overdueTasks.length > 0 && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="text-[12px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">
                مهام متأخرة من الأيام السابقة (Overdue)
              </h4>
              <span className="text-[10px] font-mono text-amber-700/80 dark:text-amber-300/70">
                {overdueTasks.length} مهمة
              </span>
            </div>
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded">
              {overdueTasks.map((t, i) => (
                <div
                  key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                  className="flex items-center gap-3 p-2 rounded-lg bg-background border border-border dark:bg-foreground/5 dark:border-foreground/10 text-[11px]"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_hsl(40,90%,60%)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{t.title}</div>
                    <div className="text-[10px] font-mono text-muted mt-0.5">
                      {t.suggestedDay} · {t.suggestedTime} · {t.durationMinutes}د
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button
              onClick={onOpenRollover}
              variant="outline"
              className="w-full rounded-xl border-amber-500/30 text-amber-800 dark:text-amber-200 hover:bg-amber-500/10 gap-2"
            >
              <ArrowUpRight className="w-4 h-4" />
              ترحيل البقايا إلى الأسبوع الجديد
            </Button>
          </div>
        )}

        {/* Overall stats */}
        <div className="grid grid-cols-3 gap-3">
          <DialogStat
            label="نسبة الإنجاز"
            value={`${pct}%`}
            accent={pct >= 70 ? "emerald" : pct >= 40 ? "uqu" : "rose"}
            mono
          />
          <DialogStat label="مكتملة" value={String(completed)} accent="emerald" mono />
          <DialogStat label="إجمالي المهام" value={String(total)} accent="muted" mono />
        </div>

        {/* Weekly per-day adherence chart */}
        {!hasPlan || total === 0 ? (
          <div className="h-[260px] flex flex-col items-center justify-center border-2 border-dashed border-border dark:border-foreground/10 rounded-2xl gap-2 text-center p-6">
            <Activity className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              ولّد خطتك الذكية أولاً لاستعراض توزيع الانضباط.
            </p>
            <Link href="/plan">
              <Button className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 mt-2">
                إنشاء خطة
              </Button>
            </Link>
          </div>
        ) : (
          <div>
            <h4 className="text-[11px] font-black uppercase tracking-widest text-muted mb-3">
              الانضباط حسب اليوم
            </h4>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={perDay}
                  margin={{ top: 10, right: 12, left: 12, bottom: 0 }}
                >
                  <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "var(--muted-text)", fontSize: 11, fontWeight: 700 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "var(--muted-text)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--color-chart-grid)", strokeWidth: 1 }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: "8px 12px",
                      fontSize: 12,
                      color: "var(--foreground)",
                    }}
                    formatter={(value, name, props) => {
                      const num = typeof value === "number" ? value : Number(value);
                      const p = props?.payload as
                        | { done?: number; total?: number }
                        | undefined;
                      return [
                        `${num.toFixed(0)}%${p ? ` · ${p.done}/${p.total} مهام` : ""}`,
                        "الإنجاز",
                      ];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="pct"
                    stroke="hsl(245, 78%, 62%)"
                    strokeWidth={3}
                    dot={{ r: 4, fill: "hsl(245, 78%, 62%)", strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: "var(--card)", stroke: "hsl(245, 78%, 62%)", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Per-day breakdown table */}
            <div className="mt-4 space-y-1.5">
              {perDay.map((d) => (
                <div
                  key={d.day}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-background border border-border dark:bg-foreground/5 dark:border-foreground/10"
                >
                  <span className="text-[12px] font-bold w-20">{d.day}</span>
                  <div className="flex-1 h-2 rounded-full bg-secondary/40 dark:bg-foreground/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-uqu-accent to-cyan-400"
                      style={{ width: `${d.pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-muted w-16 text-left">
                    {d.done}/{d.total} · {d.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground leading-relaxed pt-1 border-t border-border dark:border-foreground/10">
          ملاحظة: التتبع التاريخي عبر الفصول الدراسية سيُتاح في إصدار قادم — حالياً
          نعرض توزيع الانضباط على خطتك الحالية فقط.
        </p>
      </div>
    </DialogContent>
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
