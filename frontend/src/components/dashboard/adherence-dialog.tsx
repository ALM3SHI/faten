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
      className="!bg-surface border-line text-ink shadow-card backdrop-blur-xl rounded-card p-0 sm:max-w-[min(760px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-line shrink-0">
        <DialogTitle className="text-heading font-bold flex items-center gap-3">
          <ListChecks className="w-6 h-6 text-info-ink" />
          تحليل الانضباط الدراسي
        </DialogTitle>
        <DialogDescription className="text-ink-muted text-small">
          توزيع نسبة إنجاز مهام خطتك الذكية على أيام الأسبوع.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-surface-sunken [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Sprint-5: Overdue carry-over section pinned to the top of
            today's view so the user sees the backlog before the chart. */}
        {overdueTasks.length > 0 && (
          <div className="rounded-card border border-warning-line bg-warning-soft p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="text-small font-bold uppercase tracking-widest text-warning-ink">
                مهام متأخرة من الأيام السابقة (Overdue)
              </h4>
              <span className="text-caption font-mono text-warning-ink">
                {overdueTasks.length} مهمة
              </span>
            </div>
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-surface-sunken [&::-webkit-scrollbar-thumb]:rounded">
              {overdueTasks.map((t, i) => (
                <div
                  key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                  className="flex items-center gap-3 p-2 rounded-control bg-surface border border-line text-caption"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-warning-ink shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{t.title}</div>
                    <div className="text-caption font-mono text-ink-muted mt-0.5">
                      {t.suggestedDay} · {t.suggestedTime} · {t.durationMinutes}د
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button
              onClick={onOpenRollover}
              variant="outline"
              className="w-full rounded-control border-warning-line text-warning-ink hover:bg-warning-soft gap-2"
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
          <div className="h-[260px] flex flex-col items-center justify-center border-2 border-dashed border-line rounded-card gap-2 text-center p-6">
            <Activity className="w-8 h-8 text-ink-muted" />
            <p className="text-small text-ink-muted">
              ولّد خطتك الذكية أولاً لاستعراض توزيع الانضباط.
            </p>
            <Link href="/plan">
              <Button className="rounded-control bg-brand hover:bg-brand-hover gap-2 mt-2">
                إنشاء خطة
              </Button>
            </Link>
          </div>
        ) : (
          <div>
            <h4 className="text-caption font-bold uppercase tracking-widest text-ink-muted mb-3">
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
                  className="flex items-center gap-3 p-2.5 rounded-control bg-surface border border-line"
                >
                  <span className="text-small font-bold w-20">{d.day}</span>
                  <div className="flex-1 h-2 rounded-full bg-secondary/40 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${d.pct}%` }}
                    />
                  </div>
                  <span className="text-caption font-mono text-ink-muted w-16 text-left">
                    {d.done}/{d.total} · {d.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-caption text-ink-muted leading-relaxed pt-1 border-t border-line">
          ملاحظة: التتبع التاريخي عبر الفصول الدراسية سيُتاح في إصدار قادم — حالياً
          نعرض توزيع الانضباط على خطتك الحالية فقط.
        </p>
      </div>
    </DialogContent>
  );
}
