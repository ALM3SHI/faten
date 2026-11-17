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
          className="text-caption font-bold uppercase tracking-widest text-ink-muted"
        >
          تعديل الهدف
        </label>
        <span className="text-caption font-mono text-ink-muted">
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
          className="flex-1 bg-surface border border-line rounded-control px-3 py-2.5 text-small font-mono font-bold text-ink outline-none focus:border-info-line focus:ring-1 focus:ring-brand transition-all"
        />
        <Button
          onClick={handleSave}
          disabled={!isValid}
          className="rounded-control bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          حفظ
        </Button>
      </div>

      {/* Validation messages — ordered by severity. The amber "max possible"
          warning is the headline fix for Bug #5. */}
      {exceedsMax && (
        <p className="text-caption text-warning-ink font-bold flex items-center gap-1.5 leading-relaxed">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          أقصى معدل ممكن رياضياً هو{" "}
          <span className="font-mono font-bold">{maxPossible.toFixed(2)}</span>
          <span className="text-warning-ink font-normal">
            (بافتراض A+ في كل ساعة متبقية)
          </span>
        </p>
      )}
      {belowZero && (
        <p className="text-caption text-danger-ink font-bold">
          القيمة لا يمكن أن تكون سالبة.
        </p>
      )}
      {savedAt && parsed === targetGpa && (
        <p className="text-caption text-success-ink font-bold flex items-center gap-1.5">
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
      <div className="p-4 rounded-control bg-surface border border-line text-small text-ink-muted">
        حدّد هدفاً وارفع سجلك الأكاديمي حتى نستطيع حساب المطلوب.
      </div>
    );
  }

  if (status === "achieved") {
    return (
      <div className="p-4 rounded-control bg-success-soft border border-success-line text-success-ink text-small leading-relaxed">
        🎉 وصلت لهدفك بالفعل! حافظ على مستواك الحالي في الفصل القادم.
      </div>
    );
  }

  if (status === "impossible") {
    return (
      <div className="p-4 rounded-control bg-danger-soft border border-danger-line text-danger-ink text-small leading-relaxed">
        ⚠️ المطلوب{" "}
        <strong className="font-bold font-mono">{required.toFixed(2)}</strong> وهو فوق أعلى معدل ممكن
        (4.00). غيّر الهدف لقيمة قابلة للتحقيق، أو تابع التقدم على فصلين أو أكثر.
      </div>
    );
  }

  const accent =
    status === "stretch"
      ? "bg-warning-soft border-warning-line text-warning-ink "
      : "bg-info-soft border-info-line text-ink";

  return (
    <div className={cn("p-4 rounded-control border text-small leading-relaxed", accent)}>
      للوصول لهدفك{" "}
      <strong className="font-bold font-mono">{targetGpa.toFixed(2)}</strong>، تحتاج إلى تحقيق
      معدل{" "}
      <strong className="font-bold font-mono text-body">{required.toFixed(2)}</strong> في{" "}
      {nextHours} ساعة قادمة.
    </div>
  );
}
