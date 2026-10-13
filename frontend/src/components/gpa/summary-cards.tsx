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
    emerald: "bg-emerald-500/10 border-emerald-500/20",
    cyan: "bg-cyan-500/10 border-cyan-500/20",
    uqu: "bg-uqu-accent/10 border-uqu-accent/20",
  }[accent];

  const deltaSign = delta != null ? (delta > 0 ? "+" : delta < 0 ? "" : "±") : "";
  const deltaColor =
    delta == null || Math.abs(delta) < 0.005
      ? "text-muted"
      : delta > 0
        ? "text-emerald-400"
        : "text-rose-400";

  return (
    <Card className="glass p-4 md:p-5 gap-0 rounded-2xl border-foreground/10 hover:border-foreground/10 transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-sm font-extrabold tracking-wide text-muted-foreground">
          {label}
        </h2>
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center border", tone)}>
          {icon}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-3xl md:text-4xl leading-none font-black tracking-tighter font-mono">
          {primary}
        </div>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted font-semibold">{secondaryLabel}</span>
          {secondaryValue !== undefined && (
            <span className="font-mono font-bold text-foreground">{secondaryValue}</span>
          )}
        </div>
        {delta != null && (
          <div
            className={cn(
              "text-xs font-semibold font-mono mt-1 pt-2 border-t border-foreground/10",
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
      <Card className="glass p-4 md:p-5 gap-0 rounded-2xl border-foreground/10">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-sm font-extrabold tracking-wide text-muted-foreground">
            المعدل المطلوب للأترام المتبقية
          </h2>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center border bg-foreground/5 border-foreground/10">
            <Target className="w-5 h-5 text-muted" />
          </div>
        </div>
        <div className="text-3xl md:text-4xl leading-none font-black text-muted mb-2">—</div>
        <p className="text-xs text-muted leading-relaxed">
          حدّد معدلاً مستهدفاً من{" "}
          <Link href="/profile" className="text-uqu-accent font-bold underline">
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
      <Card className="glass p-4 md:p-5 gap-0 rounded-2xl border-foreground/10">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-sm font-extrabold tracking-wide text-muted-foreground">
            المعدل المطلوب للأترام المتبقية
          </h2>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center border bg-amber-500/10 border-amber-500/20">
            <AlertCircle className="w-5 h-5 text-amber-400" />
          </div>
        </div>
        <div className="text-3xl md:text-4xl leading-none font-black text-muted mb-2">—</div>
        <p className="text-xs text-muted leading-relaxed">
          أدخل عدد ساعات خطتك الأكاديمية في{" "}
          <Link href="/profile" className="text-uqu-accent font-bold underline">
            صفحة الملف الشخصي
          </Link>{" "}
          (مثلاً 132) لحساب المعدل المطلوب لتحقيق الهدف عند التخرج.
        </p>
      </Card>
    );
  }

  const toneByStatus = {
    achieved: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    complete: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    feasible: "bg-uqu-accent/10 border-uqu-accent/20 text-uqu-accent",
    stretch: "bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300",
    impossible: "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300",
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
    <Card className={cn("glass p-4 md:p-5 gap-0 rounded-2xl border", toneByStatus[status])}>
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-sm font-extrabold tracking-wide opacity-90">
          المعدل المطلوب للأترام المتبقية
        </h2>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center border border-foreground/10 bg-foreground/5 dark:bg-black/20">
          <Target className="w-5 h-5" />
        </div>
      </div>
      <div className="text-3xl md:text-4xl leading-none font-black tracking-tighter font-mono mb-1">
        {display}
      </div>
      <div className="text-xs font-semibold opacity-90">
        {remaining > 0
          ? `للوصول لمعدل ${targetGpa.toFixed(2)} عبر الـ${remaining} ساعة المتبقية`
          : "أكملت ساعات الخطة"}
      </div>
      <div className="mt-3 pt-3 border-t border-foreground/10 text-xs leading-relaxed opacity-90">
        {headlineByStatus[status]}
      </div>
    </Card>
  );
}
