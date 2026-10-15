"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AbsenceLevel } from "@/lib/attendance";

const ABSENCE: Record<AbsenceLevel, { label: string; tone: string }> = {
  safe: { label: "آمن", tone: "text-emerald-700 dark:text-emerald-300" },
  warning: { label: "انتبه", tone: "text-amber-800 dark:text-amber-300" },
  danger: { label: "على الحد", tone: "text-rose-700 dark:text-rose-300" },
  deprived: { label: "حرمان", tone: "text-rose-700 dark:text-rose-300" },
};

/**
 * Three numbers at a glance — GPA, hours, absences — as one link into
 * «معدّلي». The detail and the analysis live there, not on the home page.
 */
export function StatusStrip({
  hydrated,
  gpa,
  earned,
  planHours,
  absence,
}: {
  hydrated: boolean;
  gpa: number;
  earned: number;
  planHours: number | null;
  absence: AbsenceLevel | null;
}) {
  const cell = "flex flex-col items-center justify-center gap-0.5 py-3.5 min-w-0";
  const value = "text-xl font-black leading-tight";
  const label = "text-xs text-muted-foreground font-semibold";
  return (
    <Link
      href="/record"
      prefetch={false}
      aria-label="افتح معدّلي"
      className="grid grid-cols-3 rounded-3xl border border-foreground/10 hover:bg-foreground/[0.03] transition-colors"
    >
      <span className={cell}>
        <span className={value}>{hydrated && gpa > 0 ? gpa.toFixed(2) : "—"}</span>
        <span className={label}>المعدل</span>
      </span>
      <span className={cn(cell, "border-s border-foreground/10")}>
        <span className={value}>
          {hydrated && earned > 0 ? earned : "—"}
          {hydrated && planHours ? <span className="text-sm text-muted-foreground font-bold">/{planHours}</span> : null}
        </span>
        <span className={label}>ساعة منجزة</span>
      </span>
      <span className={cn(cell, "border-s border-foreground/10")}>
        <span className={cn(value, absence ? ABSENCE[absence].tone : "")}>{absence ? ABSENCE[absence].label : "—"}</span>
        <span className={label}>الغياب</span>
      </span>
    </Link>
  );
}
