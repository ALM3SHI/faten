"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProfileStore } from "@/store/profileStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { maxAchievableGpa } from "@/lib/graduation";
import { usePlanHours } from "@/lib/use-graduation";
import type { TargetCalloutStatus } from "@/components/dashboard/analytics";

/**
 * Inline target-GPA editor inside the Target GPA card's dialog. Rejects
 * targets above the mathematical ceiling (A+ in every remaining plan hour),
 * computed by lib/graduation.ts from the shared plan-hours resolver.
 */
export function TargetGpaEditDialog({ targetGpa }: { targetGpa: number }) {
  const setGoals = useProfileStore((s) => s.setGoals);
  const planHours = usePlanHours();
  const profileCurrentGpa = useProfileStore((s) => s.goals.currentGpa) ?? 0;
  const transcriptGpa = useTranscriptStore((s) => s.gpa);
  const transcriptEarned = useTranscriptStore((s) => s.earnedHours);
  const completedCourses = useTranscriptStore((s) => s.completedCourses);

  // Same source-of-truth resolution as the dashboard's main fetch effect.
  const currentGpa = transcriptGpa ?? profileCurrentGpa ?? 0;
  const earnedHours = useMemo(
    () =>
      transcriptEarned ??
      completedCourses.reduce((sum, c) => sum + (c.creditHours ?? 0), 0),
    [transcriptEarned, completedCourses],
  );

  const maxPossible = useMemo(
    () => maxAchievableGpa({ currentGpa, earnedHours, planHours }),
    [currentGpa, earnedHours, planHours],
  );

  const [draft, setDraft] = useState<string>(
    targetGpa > 0 ? targetGpa.toFixed(2) : "",
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-sync the input whenever the underlying target changes (e.g., the
  // chat agent fired an UPDATE_TARGET_GPA action while this dialog was
  // mounted) so the field never shows stale data.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-sync the field when the agent changes the target
    setDraft(targetGpa > 0 ? targetGpa.toFixed(2) : "");
  }, [targetGpa]);

  const parsed = parseFloat(draft);
  const inRange =
    !Number.isNaN(parsed) && parsed >= 0 && parsed <= 4 && parsed !== targetGpa;
  const exceedsMax = !Number.isNaN(parsed) && parsed > maxPossible;
  const belowZero = !Number.isNaN(parsed) && parsed < 0;
  const isValid = inRange && !exceedsMax;

  const handleSave = () => {
    if (!isValid) return;
    // Hard-clamp to both the UQU scale (0–4) AND the per-student max.
    // Belt + braces against any input that snuck past the validators.
    const next = Math.max(0, Math.min(maxPossible, parsed));
    setGoals({ targetGpa: Number(next.toFixed(2)) });
    setSavedAt(Date.now());
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <label
          htmlFor="target-gpa-input"
          className="text-[11px] font-black uppercase tracking-widest text-muted"
        >
          تعديل الهدف
        </label>
        <span className="text-[10px] font-mono text-muted">
          الحد الأقصى الممكن: {maxPossible.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="target-gpa-input"
          type="number"
          inputMode="decimal"
          min={0}
          max={maxPossible}
          step={0.05}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder={`0.00 – ${maxPossible.toFixed(2)}`}
          className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono font-black text-foreground outline-none focus:border-uqu-accent/50 focus:ring-1 focus:ring-uqu-accent/30 transition-all dark:bg-foreground/5 dark:border-foreground/10"
        />
        <Button
          onClick={handleSave}
          disabled={!isValid}
          className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          حفظ
        </Button>
      </div>

      {/* Validation messages — ordered by severity. The amber "max possible"
          warning is the headline fix for Bug #5. */}
      {exceedsMax && (
        <p className="text-[11px] text-amber-800 dark:text-amber-300 font-bold flex items-center gap-1.5 leading-relaxed">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          أقصى معدل ممكن رياضياً هو{" "}
          <span className="font-mono font-black">{maxPossible.toFixed(2)}</span>
          <span className="text-amber-700/80 dark:text-amber-300/70 font-normal">
            (بافتراض A+ في كل ساعة متبقية)
          </span>
        </p>
      )}
      {belowZero && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300 font-bold">
          القيمة لا يمكن أن تكون سالبة.
        </p>
      )}
      {savedAt && parsed === targetGpa && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          تم تحديث الهدف إلى {targetGpa.toFixed(2)}
        </p>
      )}
    </div>
  );
}


export function TargetGpaCallout({
  status,
  required,
  targetGpa,
  nextHours,
}: {
  status: TargetCalloutStatus;
  required: number;
  targetGpa: number;
  nextHours: number;
}) {
  if (status === "unknown") {
    return (
      <div className="p-4 rounded-xl bg-background border border-border text-sm text-muted-foreground dark:bg-foreground/5 dark:border-foreground/10">
        حدّد هدفاً وارفع سجلك الأكاديمي حتى نستطيع حساب المطلوب.
      </div>
    );
  }

  if (status === "achieved") {
    return (
      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-sm leading-relaxed">
        🎉 وصلت لهدفك بالفعل! حافظ على مستواك الحالي في الفصل القادم.
      </div>
    );
  }

  if (status === "impossible") {
    return (
      <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-200 text-sm leading-relaxed">
        ⚠️ المطلوب{" "}
        <strong className="font-black font-mono">{required.toFixed(2)}</strong> وهو فوق سقف الـ
        4.00. غيّر الهدف لقيمة قابلة للتحقيق، أو تابع التقدم على فصلين أو أكثر.
      </div>
    );
  }

  const accent =
    status === "stretch"
      ? "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200"
      : "bg-uqu-accent/10 border-uqu-accent/30 text-foreground";

  return (
    <div className={cn("p-4 rounded-xl border text-sm leading-relaxed", accent)}>
      للوصول لهدفك{" "}
      <strong className="font-black font-mono">{targetGpa.toFixed(2)}</strong>، تحتاج إلى تحقيق
      معدل{" "}
      <strong className="font-black font-mono text-base">{required.toFixed(2)}</strong> في الـ{" "}
      {nextHours} ساعة القادمة.
    </div>
  );
}
