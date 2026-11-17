"use client";

import Link from "next/link";
import { Target, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { RequiredToGraduate } from "@/lib/graduation";

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

export function SummaryCard({
  label,
  primary,
  secondaryLabel,
  secondaryValue,
  delta,
  icon,
  accent,
}: {
  label: string;
  primary: string;
  secondaryLabel: string;
  secondaryValue?: string;
  delta?: number;
  icon: React.ReactNode;
  accent: "emerald" | "cyan" | "uqu";
}) {
  const tone = {
    emerald: "bg-success-soft border-success-line",
    cyan: "bg-info-soft border-info-line",
    uqu: "bg-info-soft border-info-line",
  }[accent];

  const deltaSign = delta != null ? (delta > 0 ? "+" : delta < 0 ? "" : "±") : "";
  const deltaColor =
    delta == null || Math.abs(delta) < 0.005
      ? "text-ink-muted"
      : delta > 0
        ? "text-success-ink"
        : "text-danger-ink";

  return (
    <Card className="border border-line bg-surface shadow-card p-4 md:p-5 gap-0 rounded-card hover:border-line transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-small font-bold tracking-wide text-ink-muted">
          {label}
        </h2>
        <div className={cn("w-9 h-9 rounded-control flex items-center justify-center border", tone)}>
          {icon}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-title md:text-title leading-none font-bold tracking-tighter font-mono">
          {primary}
        </div>
        <div className="flex items-baseline justify-between gap-2 text-caption">
          <span className="text-ink-muted font-semibold">{secondaryLabel}</span>
          {secondaryValue !== undefined && (
            <span className="font-mono font-bold text-ink">{secondaryValue}</span>
          )}
        </div>
        {delta != null && (
          <div
            className={cn(
              "text-caption font-semibold font-mono mt-1 pt-2 border-t border-line",
              deltaColor,
            )}
          >
            {Math.abs(delta) < 0.005
              ? "لا تغيير حتى الآن"
              : `${deltaSign}${delta.toFixed(2)} من المحاكاة`}
          </div>
        )}
      </div>
    </Card>
  );
}

export function RequiredToGraduateCard({
  targetGpa,
  totalPlanHours,
  required,
}: {
  targetGpa: number;
  totalPlanHours: number;
  required: RequiredToGraduate | null;
}) {
  // No target → CTA to /profile
  if (!required || required.status === "no_target" || targetGpa <= 0) {
    return (
      <Card className="border border-line bg-surface shadow-card p-4 md:p-5 gap-0 rounded-card">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-small font-bold tracking-wide text-ink-muted">
            المعدل المطلوب للأترام المتبقية
          </h2>
          <div className="w-9 h-9 rounded-control flex items-center justify-center border bg-surface-sunken border-line">
            <Target className="w-5 h-5 text-ink-muted" />
          </div>
        </div>
        <div className="text-title md:text-title leading-none font-bold text-ink-muted mb-2">—</div>
        <p className="text-caption text-ink-muted leading-relaxed">
          حدّد معدلاً مستهدفاً من{" "}
          <Link href="/profile" className="text-info-ink font-bold underline">
            صفحة الملف الشخصي
          </Link>{" "}
          لرؤية المطلوب لتحقيقه.
        </p>
      </Card>
    );
  }

  // Target set but plan hours unknown → CTA to /profile
  if (required.status === "no_plan" || totalPlanHours <= 0) {
    return (
      <Card className="border border-line bg-surface shadow-card p-4 md:p-5 gap-0 rounded-card">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-small font-bold tracking-wide text-ink-muted">
            المعدل المطلوب للأترام المتبقية
          </h2>
          <div className="w-9 h-9 rounded-control flex items-center justify-center border bg-warning-soft border-warning-line">
            <AlertCircle className="w-5 h-5 text-warning-ink" />
          </div>
        </div>
        <div className="text-title md:text-title leading-none font-bold text-ink-muted mb-2">—</div>
        <p className="text-caption text-ink-muted leading-relaxed">
          أدخل عدد ساعات خطتك الأكاديمية في{" "}
          <Link href="/profile" className="text-info-ink font-bold underline">
            صفحة الملف الشخصي
          </Link>{" "}
          (مثلاً 132) لحساب المعدل المطلوب لتحقيق الهدف عند التخرج.
        </p>
      </Card>
    );
  }

  const toneByStatus = {
    achieved: "bg-success-soft border-success-line text-success-ink ",
    complete: "bg-success-soft border-success-line text-success-ink ",
    feasible: "bg-info-soft border-info-line text-info-ink",
    stretch: "bg-warning-soft border-warning-line text-warning-ink ",
    impossible: "bg-danger-soft border-danger-line text-danger-ink ",
  } as const;

  const headlineByStatus = {
    achieved: "تجاوزت الهدف 🎯",
    complete: "أكملت ساعات الخطة — الهدف لم يُدرك",
    feasible: "على المسار الصحيح",
    stretch: "هدف طموح — يتطلب أداءً ممتازاً",
    impossible: "غير قابل للتحقيق بالساعات المتبقية",
  } as const;

  const status = required.status as keyof typeof toneByStatus;
  const display = required.value.toFixed(2);
  const remaining = required.remainingHours;

  return (
    <Card className={cn("border border-line bg-surface shadow-card p-4 md:p-5 gap-0 rounded-card", toneByStatus[status])}>
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-small font-bold tracking-wide opacity-90">
          المعدل المطلوب للأترام المتبقية
        </h2>
        <div className="w-9 h-9 rounded-control flex items-center justify-center border border-line bg-surface-sunken">
          <Target className="w-5 h-5" />
        </div>
      </div>
      <div className="text-title md:text-title leading-none font-bold tracking-tighter font-mono mb-1">
        {display}
      </div>
      <div className="text-caption font-semibold opacity-90">
        {remaining > 0
          ? `للوصول لمعدل ${targetGpa.toFixed(2)} في ${remaining} ساعة متبقية`
          : "أكملت ساعات الخطة"}
      </div>
      <div className="mt-3 pt-3 border-t border-line text-caption leading-relaxed opacity-90">
        {headlineByStatus[status]}
      </div>
    </Card>
  );
}
