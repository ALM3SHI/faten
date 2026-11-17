"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, FileText, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ds/button";
import { cn } from "@/lib/utils";
import { loadJob, type PrepJob } from "@/lib/tutor";

const STAGES: { id: NonNullable<PrepJob["stage"]>; label: string }[] = [
  { id: "reading", label: "نقرأ صفحات الملف والجداول" },
  { id: "vision", label: "نقرأ الصفحات المصوّرة والرسومات" },
  { id: "structure", label: "نرتّب المحاضرة في وحدات" },
  { id: "saving", label: "نجهّز دورتك" },
];

const POLL_MS = 3000;

/**
 * A lecture being prepared in the background. Follows the job every few
 * seconds (which also keeps a free server awake while it works) and:
 *   ready    → onReady (the page opens the course)
 *   stalled  → the work was lost (server restart): onResume sends the file
 *              again, free; without the file here, asks for it
 *   failed   → says why, offers to try again or dismiss
 * The student may leave: the lecture keeps being prepared and shows here
 * («محاضراتي») when they come back.
 */
export function PreparingCard({
  job: initial,
  canResume,
  onReady,
  onResume,
  onRetry,
  onDismiss,
}: {
  job: PrepJob;
  canResume: boolean;
  onReady: (id: string) => void;
  onResume: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const [job, setJob] = useState(initial);
  const [lost, setLost] = useState(false);
  const resumed = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    if (job.status !== "working") return;
    let stop = false;
    let failures = 0;
    const tick = async () => {
      try {
        const next = await loadJob(job.id);
        if (stop) return;
        failures = 0;
        setJob(next);
        if (next.status === "ready" && !done.current) {
          done.current = true;
          onReady(next.id);
          return;
        }
        if (next.stalled) {
          if (canResume && !resumed.current) {
            resumed.current = true;
            onResume();
          } else if (!canResume) setLost(true);
          return;
        }
      } catch {
        failures += 1; // offline or the server waking up: keep trying quietly
      }
      if (!stop && failures < 40) timer = window.setTimeout(tick, POLL_MS);
    };
    let timer = window.setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [job.id, job.status, canResume, onReady, onResume]);

  const current = STAGES.findIndex((s) => s.id === (job.stage ?? "reading"));
  const shown = STAGES;
  const name = (job.fileName ?? "").replace(/\.pdf$/i, "");
  const pct = Math.round(((Math.max(0, current) + (job.total ? (job.done ?? 0) / job.total : 0)) / STAGES.length) * 100);

  if (job.status === "failed" || lost) {
    return (
      <section className="rounded-card border border-danger-line bg-danger-soft p-5 space-y-3" role="alert" aria-label="تعذّر تجهيز المحاضرة">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle className="size-5 text-danger-ink" aria-hidden />
          <span className="truncate" dir="auto">
            {lost ? "توقف تجهيز المحاضرة" : "تعذّر تجهيز المحاضرة"}
            {name ? ` · ${name}` : ""}
          </span>
        </div>
        <p className="text-small leading-7">
          {lost ? "انقطع التجهيز من جهة الخادم. اختر الملف مرة ثانية ونكمل — بدون أن يُخصم من رصيدك." : job.error || "حاول مرة أخرى بعد قليل."}
        </p>
        <div className="flex flex-wrap gap-2">
          {canResume && (
            <Button variant="bare" type="button" onClick={onRetry} className="h-9 px-4 rounded-control bg-brand text-on-brand text-small font-bold inline-flex items-center gap-1.5">
              <RotateCcw className="size-4" aria-hidden /> حاول مرة أخرى
            </Button>
          )}
          <Button variant="bare" type="button" onClick={onDismiss} className="h-9 px-4 rounded-control border border-line-strong text-small font-bold inline-flex items-center gap-1.5">
            <X className="size-4" aria-hidden /> إخفاء
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-info-line bg-surface p-5 space-y-4 shadow-card" aria-label="نجهّز محاضرتك">
      <div className="flex items-start gap-3">
        <FileText className="size-6 shrink-0 text-info-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">نجهّز دورتك</h2>
          {name && (
            <p className="truncate text-small text-ink-muted" dir="auto" title={job.fileName}>
              {name}
            </p>
          )}
        </div>
        <span className="nums text-small font-bold text-info-ink" aria-hidden>
          {pct}%
        </span>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-label="تقدّم التجهيز"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-brand transition-all duration-700 motion-reduce:transition-none" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>

      <ol className="space-y-2" aria-live="polite">
        {shown.map((s) => {
          const i = STAGES.findIndex((x) => x.id === s.id);
          const state = i < current ? "done" : i === current ? "now" : "next";
          return (
            <li key={s.id} className={cn("flex items-center gap-2.5 text-small", state === "next" && "text-ink-muted")}>
              {state === "done" ? (
                <CheckCircle2 className="size-4 text-success-ink" aria-hidden />
              ) : state === "now" ? (
                <Loader2 className="size-4 animate-spin text-info-ink motion-reduce:animate-none" aria-hidden />
              ) : (
                <Circle className="size-4" aria-hidden />
              )}
              <span className={cn(state === "now" && "font-bold")}>
                {s.label}
                {state === "now" && s.id === "structure" && job.total && job.total > 1 ? ` (الجزء ${(job.done ?? 0) + 1} من ${job.total})` : ""}
                {state === "now" && s.id === "vision" && job.total ? ` (${job.total} صفحة)` : ""}
              </span>
              <span className="sr-only">{state === "done" ? "— تم" : state === "now" ? "— الآن" : ""}</span>
            </li>
          );
        })}
      </ol>

      <p className="text-caption leading-6 text-ink-muted">
        قد يأخذ دقيقة أو أكثر في المحاضرات الطويلة. تقدر تطلع من الصفحة — نكمل تجهيزها وتلقاها هنا في محاضراتك.
      </p>
    </section>
  );
}
