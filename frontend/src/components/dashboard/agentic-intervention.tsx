"use client";

import Link from "next/link";
import { ArrowUpRight, Sparkles, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DialogStat } from "@/components/dashboard/stat-tiles";
import { DecisionLogEntry, AgenticAction } from "@/components/dashboard/analytics";

// ──────────────────────────────────────────────────────────────────
// Agentic Self-Healing Banner
// ──────────────────────────────────────────────────────────────────

/**
 * Renders the dashboard's top-of-page intervention banner when the
 * backend self-healing loop has fired. The page's dispatch effect has
 * already injected the agent's suggested pomodoro tasks into the plan
 * store by the time this paints, so the banner's "scheduled" claim is
 * literally true — the user can scroll down to /plan and find them.
 */
export function AgenticInterventionBanner({ action }: { action: AgenticAction }) {
  const severityTone =
    action.severity === "high"
      ? {
          ring: "border-danger-line",
          bg: "bg-danger-soft",
          pulse: "bg-danger-ink",
          chipBg: "bg-danger-soft text-danger-ink border-danger-line",
          icon: "text-danger-ink ",
        }
      : action.severity === "medium"
        ? {
            ring: "border-warning-line",
            bg: "bg-warning-soft",
            pulse: "bg-warning-ink",
            chipBg: "bg-warning-soft text-warning-ink border-warning-line",
            icon: "text-warning-ink ",
          }
        : {
            ring: "border-info-line",
            bg: "",
            pulse: "bg-brand",
            chipBg: "bg-info-soft text-info-ink border-info-line",
            icon: "text-info-ink",
          };

  return (
    <div
      className={cn(
        "relative overflow-hidden mb-8 rounded-card border bg-info-soft p-6 md:p-7",
        " animate-in fade-in slide-in-from-top-2 duration-500",
        severityTone.ring,
        severityTone.bg,
      )}
    >
      {/* Aurora glow accents */}
      <span className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full bg-info-soft blur-3xl" />
      <span className="pointer-events-none absolute -bottom-24 -left-10 w-64 h-64 rounded-full bg-success-soft blur-3xl" />

      <div className="relative flex items-start gap-4 flex-wrap md:flex-nowrap">
        {/* Pulsing status dot + icon */}
        <div className="shrink-0 relative">
          <div className="w-12 h-12 rounded-card bg-surface-sunken border border-line flex items-center justify-center">
            <Sparkles className={cn("w-6 h-6", severityTone.icon)} />
          </div>
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
              severityTone.pulse,
              "before:content-[''] before:absolute before:inset-0 before:rounded-full before:animate-ping",
              severityTone.pulse,
            )}
          />
        </div>

        {/* Copy */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge
              variant="outline"
              className={cn("text-caption font-bold px-2 py-0.5", severityTone.chipBg)}
            >
              <Activity className="w-3 h-3 ml-1" />
              تدخل ذكي نشط
            </Badge>
            <span className="text-caption font-mono text-ink-muted">
              {action.intervention_id}
            </span>
          </div>
          <h3 className="text-subheading md:text-heading font-bold mb-1.5 leading-tight">
            {action.headline}
          </h3>
          <p className="text-small text-ink leading-relaxed">{action.body}</p>

          {/* Scheduled tasks preview chips */}
          {action.scheduled_tasks.length > 0 && (
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              {action.scheduled_tasks.map((t, i) => (
                <span
                  key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-sunken border border-line text-caption font-bold"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-success-ink" />
                  {t.suggestedDay} · {t.suggestedTime}
                  <span className="text-ink-muted font-mono">
                    {t.durationMinutes}د
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* CTA — stopPropagation so clicking "افتح الخطة" navigates
            instead of opening the parent banner's decision-log dialog. */}
        <Link
          href="/plan"
          prefetch={false}
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="outline"
            className="rounded-card border border-line bg-surface shadow-card gap-2 hover:border-line transition-colors"
          >
            <ArrowUpRight className="w-4 h-4" />
            افتح الخطة
          </Button>
        </Link>
      </div>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────
// Drill-down Dialogs — Phase-2 interactivity
// ──────────────────────────────────────────────────────────────────
//
// Each of the four data widgets (Skills Radar, Agentic Banner, High-ROI
// Courses, Adherence Indicator) opens a dedicated dialog co-located here.
// They follow the same border border-line bg-surface shadow-card / rounded-card / animated-base-ui pattern
// the Top KPI cards already use — no new visual language introduced.
//
// All four are uncontrolled (`<Dialog>` self-manages open state via its
// trigger button). The dashboard page just wraps the widget JSX in
// `<DialogTrigger render={<Button … />}>` and the matching
// `<DialogContent>` lives as its sibling, exactly mirroring the KPI
// cards above.

// ── 2. Agentic Intervention Dialog (AI Decision Log) ─────────────
export function InterventionDialogContent({ action }: { action: AgenticAction }) {
  const totalMinutes = action.scheduled_tasks.reduce(
    (s, t) => s + t.durationMinutes,
    0,
  );

  return (
    <DialogContent
      className="border border-line bg-surface shadow-card rounded-card p-0 sm:max-w-[min(820px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-line shrink-0">
        <DialogTitle className="text-heading font-bold flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-info-ink" />
          سجل قرار الذكاء الاصطناعي
        </DialogTitle>
        <DialogDescription className="text-ink-muted text-small">
          الأسباب التي دفعت النظام لتفعيل التدخّل الاستدراكي تلقائياً.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-surface-sunken [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Identity block */}
        <div className="grid grid-cols-3 gap-3">
          <DialogStat label="المُشغّل" value={triggerLabel(action.trigger)} accent="uqu" />
          <DialogStat label="الشدّة" value={severityLabel(action.severity)} accent={severityToAccent(action.severity)} />
          <DialogStat label="رقم التدخّل" value={action.intervention_id.replace("intv_", "#")} accent="muted" mono />
        </div>

        {/* Decision log rows */}
        <div className="space-y-2">
          <h4 className="text-caption font-bold uppercase tracking-widest text-ink-muted mb-1">
            سلسلة القرارات
          </h4>
          {action.reasoning.length === 0 ? (
            <p className="text-caption text-ink-muted italic">
              لم يُرفق سجل قرارات لهذا التدخّل.
            </p>
          ) : (
            action.reasoning.map((row, i) => (
              <DecisionLogRow key={i} row={row} index={i + 1} />
            ))
          )}
        </div>

        {/* Scheduled tasks recap */}
        {action.scheduled_tasks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="text-caption font-bold uppercase tracking-widest text-ink-muted">
                الجلسات المُجدْولة في خطتك
              </h4>
              <span className="text-caption font-mono text-ink-muted">
                {action.scheduled_tasks.length} جلسات · {totalMinutes} دقيقة
              </span>
            </div>
            <div className="space-y-1.5">
              {action.scheduled_tasks.map((t, i) => (
                <div
                  key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                  className="flex items-center gap-3 p-2.5 rounded-control bg-success-soft border border-success-line"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-success-ink" />
                  <div className="flex-1 min-w-0">
                    <div className="text-small font-bold truncate">{t.title}</div>
                    <div className="text-caption text-ink-muted font-mono mt-0.5">
                      {t.suggestedDay} · {t.suggestedTime} · {t.durationMinutes}د
                      {t.courseCode ? ` · ${t.courseCode}` : ""}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-caption font-bold bg-info-soft text-info-ink border border-info-line">
                    {t.priority === "high" ? "أولوية عالية" : t.priority === "medium" ? "متوسطة" : "منخفضة"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Link href="/plan">
          <Button className="w-full rounded-control bg-brand hover:bg-brand-hover gap-2 mt-2">
            <ArrowUpRight className="w-4 h-4" />
            افتح صفحة الخطة لمراجعة الجلسات
          </Button>
        </Link>
      </div>
    </DialogContent>
  );
}


function DecisionLogRow({ row, index }: { row: DecisionLogEntry; index: number }) {
  const tone =
    row.severity === "alert"
      ? "border-danger-line bg-danger-soft"
      : row.severity === "warn"
        ? "border-warning-line bg-warning-soft"
        : "border-line bg-surface-sunken";
  const dot =
    row.severity === "alert"
      ? "bg-danger-ink "
      : row.severity === "warn"
        ? "bg-warning-ink "
        : "bg-surface-sunken ";
  return (
    <div className={cn("p-3 rounded-control border flex gap-3 items-start", tone)}>
      <div className="flex flex-col items-center pt-0.5 gap-1 shrink-0">
        <span className="text-caption font-mono font-bold text-ink-muted">
          {String(index).padStart(2, "0")}
        </span>
        <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-caption font-mono text-ink-muted leading-relaxed break-all">
          {row.fact}
        </div>
        <p className="text-small text-ink leading-relaxed mt-1.5">
          {row.interpretation}
        </p>
      </div>
    </div>
  );
}


function triggerLabel(t: AgenticAction["trigger"]): string {
  switch (t) {
    case "low_gpa":
      return "هبوط في المعدل";
    case "skill_gap":
      return "فجوة مهارية";
    case "combined":
      return "تدخّل مزدوج";
    default:
      return "—";
  }
}


function severityLabel(s: AgenticAction["severity"]): string {
  return s === "high" ? "عالية" : s === "medium" ? "متوسطة" : "منخفضة";
}


function severityToAccent(
  s: AgenticAction["severity"],
): "emerald" | "amber" | "rose" {
  return s === "high" ? "rose" : s === "medium" ? "amber" : "emerald";
}
