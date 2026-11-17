"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AbsenceLevel } from "@/lib/attendance";

const ABSENCE: Record<AbsenceLevel, { label: string; tone: string }> = {
  safe: { label: "آمن", tone: "text-success-ink" },
  warning: { label: "انتبه", tone: "text-warning-ink" },
  danger: { label: "على الحد", tone: "text-danger-ink" },
  deprived: { label: "حرمان", tone: "text-danger-ink" },
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
  const cell = "flex min-w-0 flex-col items-center justify-center gap-0.5 py-4";
  const value = "nums font-heading text-heading font-bold";
  const label = "text-caption font-medium text-ink-muted";
  return (
    <Link
      href="/record"
      prefetch={false}
      className="grid grid-cols-3 rounded-card border border-line bg-surface shadow-card motion-fast transition-colors hover:bg-surface-sunken focus-ring"
    >
      <span className={cell}>
        <span className={value}>{hydrated && gpa > 0 ? gpa.toFixed(2) : "—"}</span>
        <span className={label}>المعدل</span>
      </span>
      <span className={cn(cell, "border-s border-line")}>
        <span className={value}>
          {hydrated && earned > 0 ? earned : "—"}
          {hydrated && planHours ? <span className="text-small font-semibold text-ink-muted">/{planHours}</span> : null}
        </span>
        <span className={label}>ساعة منجزة</span>
      </span>
      <span className={cn(cell, "border-s border-line")}>
        <span className={cn(value, absence ? ABSENCE[absence].tone : "")}>{absence ? ABSENCE[absence].label : "—"}</span>
        <span className={label}>الغياب</span>
      </span>
      {/* Says where the link goes; the numbers above are part of its name too. */}
      <span className="sr-only">افتح معدّلي</span>
    </Link>
  );
}
