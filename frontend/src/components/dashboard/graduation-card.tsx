"use client";

import { termsLeftLabel, type GraduationProgress } from "@/lib/graduation";

/** Progress bar + "terms left" line — shared by the card and the hours dialog. */
export function GraduationSummary({ p }: { p: GraduationProgress }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-end justify-between mb-2">
          <span className="text-title font-bold">{p.percent}%</span>
          <span className="text-caption text-ink-muted font-mono">
            {p.earned} / {p.planHours} ساعة
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-sunken overflow-hidden flex" aria-hidden>
          <div className="h-full bg-brand" style={{ width: `${(p.earned / p.planHours) * 100}%` }} />
          <div className="h-full bg-info-soft" style={{ width: `${(Math.min(p.inProgress, p.remaining) / p.planHours) * 100}%` }} />
        </div>
        <div className="flex gap-4 mt-2 text-caption text-ink-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-brand" /> مجتازة</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-info-soft" /> هذا الفصل ({p.inProgress})</span>
        </div>
      </div>
      <div className="text-small">
        <div className="font-bold">{termsLeftLabel(p)}</div>
        {p.remainingAfterTerm > 0 && (
          <div className="text-caption text-ink-muted mt-1">
            باقي {p.remainingAfterTerm} ساعة بعد هذا الفصل — بمعدل 14 إلى 18 ساعة للفصل.
          </div>
        )}
      </div>
    </div>
  );
}
