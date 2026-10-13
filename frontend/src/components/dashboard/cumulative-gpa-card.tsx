"use client";

import dynamic from "next/dynamic";
import { LineChart as LineChartIcon, Sparkles } from "lucide-react";
import { PanelRoot } from "@/components/dashboard/panel-root";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useInViewOnce } from "@/lib/use-in-view";
import type { TargetCalloutStatus } from "@/components/dashboard/analytics";

// ──────────────────────────────────────────────────────────────────
// Middle Row — Cumulative GPA Chart
// ──────────────────────────────────────────────────────────────────

// Recharts is heavy: load it only when there is a chart to draw and the
// card is (nearly) on screen.
const GpaLineChart = dynamic(() => import("@/components/dashboard/gpa-line-chart").then((m) => m.GpaLineChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

export function CumulativeGpaCard({
  series,
  loading,
  completedCount,
  badgeStatus,
  nextHours,
  bare,
}: {
  series: { semester: string; cumulativeGpa: number; semesterGpa: number }[];
  loading: boolean;
  completedCount: number;
  badgeStatus: TargetCalloutStatus;
  /** Hours the backend's target analysis assumes for next term. */
  nextHours: number;
  /** Inside the dashboard's tabbed card: no card chrome, no title. */
  bare?: boolean;
}) {
  // Load the chart only once it is actually on screen: on phones it sits
  // just below the fold, and recharts is the heaviest script on this page.
  const [chartRef, chartVisible] = useInViewOnce<HTMLDivElement>("0px");
  return (
    <PanelRoot bare={bare} className="glass p-8 rounded-[32px] border-border dark:border-foreground/10 relative overflow-hidden min-h-[400px] flex flex-col">
      <div className={cn("flex items-center justify-between flex-wrap gap-3", bare ? "mb-3" : "mb-6")}>
        <div className={cn(bare && "sr-only")}>
          <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
            <LineChartIcon className="w-5 h-5 text-uqu-accent" />
            تقدم المعدل التراكمي
          </h3>
          <p className="text-sm text-muted-foreground">مسارك نحو الهدف الدراسي</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            badgeStatus === "achieved" || badgeStatus === "feasible"
              ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-500/30 dark:border-emerald-400/20"
              : badgeStatus === "stretch"
                ? "bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-500/30 dark:border-amber-400/20"
                : badgeStatus === "impossible"
                  ? "bg-rose-500/10 text-rose-800 dark:text-rose-400 border-rose-500/30 dark:border-rose-400/20"
                  : "bg-foreground/5 text-muted border-foreground/10",
          )}
        >
          {badgeStatus === "achieved"
            ? "تجاوزت الهدف 🎯"
            : badgeStatus === "feasible"
              ? "على المسار الصحيح 🎯"
              : badgeStatus === "stretch"
                ? "يحتاج مجهوداً 💪"
                : badgeStatus === "impossible"
                  ? `غير قابل بـ ${nextHours} ساعة`
                  : "حدد هدفك"}
        </Badge>
      </div>

      <div className={cn("flex-1", bare ? "min-h-[220px]" : "min-h-[280px]")} ref={chartRef}>
        {loading ? (
          <ChartSkeleton />
        ) : series.length < 2 ? (
          <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-foreground/10 rounded-2xl p-8 text-center gap-2">
            <LineChartIcon className="w-8 h-8 text-muted" />
            <p className="text-sm text-muted-foreground">
              نحتاج فصلين دراسيين على الأقل لرسم منحنى التقدم.
            </p>
            <p className="text-xs text-muted">
              {completedCount === 0
                ? "ارفع سجلك الأكاديمي للبدء."
                : `لديك بيانات ${series.length} فصل فقط — أكمل ترماً آخر وستظهر هنا.`}
            </p>
          </div>
        ) : (
          chartVisible ? <GpaLineChart series={series} /> : <ChartSkeleton />
        )}
      </div>

      {series.length >= 2 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border dark:border-foreground/10 text-[11px] flex-wrap gap-2">
          <span className="text-muted-foreground font-mono">
            {series[0].semester} → {series[series.length - 1].semester}
          </span>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full bg-uqu-accent" />
              <span className="text-muted-foreground font-bold">تراكمي</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full bg-foreground/35 dark:bg-white/30 [background-image:repeating-linear-gradient(90deg,var(--foreground)_0_2px,transparent_2px_4px)] dark:[background-image:repeating-linear-gradient(90deg,white_0_2px,transparent_2px_4px)]" />
              <span className="text-muted-foreground font-bold">فصلي</span>
            </span>
          </div>
        </div>
      )}
    </PanelRoot>
  );
}


/**
 * Sprint-4 Bug #8 — GPA trend insight box.
 * Renders the backend's one-sentence narrative about per-semester
 * variance directly under the cumulative-GPA chart. The card is glass
 * + glow + AI sparkle icon to read as "model said this" rather than
 * "static label".
 */
export function GpaTrendInsight({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="glass rounded-2xl border border-uqu-accent/20 bg-gradient-to-l from-uqu-accent/[0.06] via-cyan-500/[0.04] to-transparent p-4 flex items-start gap-3 shadow-[0_0_24px_-12px_hsla(245,78%,62%,0.5)]">
      <div className="w-9 h-9 rounded-xl bg-uqu-accent/15 border border-uqu-accent/30 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-4 h-4 text-uqu-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-black uppercase tracking-widest text-uqu-accent mb-1">
          تحليل ذكي للمسار
        </div>
        <p className="text-[13px] text-foreground leading-relaxed">{text}</p>
      </div>
    </div>
  );
}


function ChartSkeleton() {
  return (
    <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-foreground/10 rounded-2xl p-8 text-center gap-3 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-foreground/5" />
      <div className="h-2.5 w-40 rounded-full bg-foreground/5" />
      <div className="h-2 w-28 rounded-full bg-foreground/5" />
    </div>
  );
}
