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
import { ListChecks, ArrowUpRight, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PlanTask } from "@/store/planStore";
import { DialogStat } from "@/components/dashboard/stat-tiles";

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
