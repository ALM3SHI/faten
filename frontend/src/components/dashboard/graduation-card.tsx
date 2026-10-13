"use client";

import { termsLeftLabel, type GraduationProgress } from "@/lib/graduation";

/** Progress bar + "terms left" line — shared by the card and the hours dialog. */
export function GraduationSummary({ p }: { p: GraduationProgress }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-end justify-between mb-2">
          <span className="text-3xl font-black">{p.percent}%</span>
          <span className="text-xs text-muted-foreground font-mono">
            {p.earned} / {p.planHours} ساعة
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-foreground/10 overflow-hidden flex" aria-hidden>
          <div className="h-full bg-uqu-accent" style={{ width: `${(p.earned / p.planHours) * 100}%` }} />
          <div className="h-full bg-uqu-accent/35" style={{ width: `${(Math.min(p.inProgress, p.remaining) / p.planHours) * 100}%` }} />
        </div>
        <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-uqu-accent" /> مجتازة</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-uqu-accent/35" /> هذا الفصل ({p.inProgress})</span>
        </div>
      </div>
      <div className="text-sm">
        <div className="font-bold">{termsLeftLabel(p)}</div>
        {p.remainingAfterTerm > 0 && (
          <div className="text-xs text-muted-foreground mt-1">
            باقي {p.remainingAfterTerm} ساعة بعد هذا الفصل — بمعدل 14 إلى 18 ساعة للفصل.
          </div>
        )}
      </div>
    </div>
  );
}
