"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Dialog primitives shared by the four drill-downs ─────────────
export function DialogStat({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent: "emerald" | "sky" | "amber" | "rose" | "uqu" | "muted";
  mono?: boolean;
}) {
  const tone = {
    emerald:
      "bg-success-soft border-success-line text-success-ink",
    sky: "bg-info-soft border-info-line text-info-ink",
    amber:
      "bg-warning-soft border-warning-line text-warning-ink",
    rose: "bg-danger-soft border-danger-line text-danger-ink",
    uqu: "bg-info-soft border-info-line text-info-ink",
    muted: "bg-surface border-line text-ink",
  }[accent];
  return (
    <div className={cn("p-3 rounded-control border text-center", tone)}>
      <div className="text-caption font-bold uppercase tracking-wider opacity-80 mb-1">
        {label}
      </div>
      <div className={cn("text-heading font-bold", mono && "font-mono")}>{value}</div>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────
// Reused sub-components (KPI cards / Dialogs)
// ──────────────────────────────────────────────────────────────────

/**
 * Compact number tile for the dashboard's «وضعي الأكاديمي» row; the whole
 * tile opens its drill-down dialog.
 */
export function StatTile({
  title,
  value,
  hint,
  icon,
  color,
}: {
  title: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  color: "emerald" | "uqu" | "cyan" | "rose";
}) {
  const textColors = {
    emerald: "text-success-ink ",
    uqu: "text-info-ink",
    cyan: "text-info-ink ",
    rose: "text-danger-ink ",
  } as const;

  return (
    <Card className="border border-line bg-surface shadow-card p-3.5 md:p-4 gap-1 rounded-card border-line hover:border-info-line transition-colors h-full">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-caption font-bold text-ink-muted leading-snug">{title}</h3>
        <span className="hidden sm:inline-flex" aria-hidden>
          {icon}
        </span>
      </div>
      <div className={cn("text-heading md:text-title font-bold tracking-tight tabular-nums", textColors[color])}>{value}</div>
      {hint && <div className="text-caption leading-snug text-ink-muted line-clamp-2">{hint}</div>}
    </Card>
  );
}


export function KvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-3 rounded-control bg-surface border border-line flex justify-between items-center">
      <span className="text-ink-muted text-small font-bold">{label}:</span>
      <span className={cn("font-bold", mono && "font-mono")}>{value}</span>
    </div>
  );
}


export function KvTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "muted" | "uqu";
}) {
  const tone =
    accent === "uqu"
      ? "bg-info-soft border-info-line text-info-ink"
      : "bg-surface border-line text-ink";
  return (
    <div className={cn("p-3 rounded-control border", tone)}>
      <div className="text-caption font-bold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-heading font-bold font-mono">{value}</div>
    </div>
  );
}
