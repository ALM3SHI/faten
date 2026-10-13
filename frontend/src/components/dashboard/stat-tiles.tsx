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
      "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300 dark:border-emerald-400/20",
    sky: "bg-sky-500/10 border-sky-500/30 text-sky-800 dark:text-sky-300 dark:border-sky-400/20",
    amber:
      "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300 dark:border-amber-400/20",
    rose: "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300 dark:border-rose-400/20",
    uqu: "bg-uqu-accent/10 border-uqu-accent/25 text-uqu-accent",
    muted: "bg-background border-border text-foreground dark:bg-foreground/5 dark:border-foreground/10",
  }[accent];
  return (
    <div className={cn("p-3 rounded-xl border text-center", tone)}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80 mb-1">
        {label}
      </div>
      <div className={cn("text-xl font-black", mono && "font-mono")}>{value}</div>
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
  value: string;
  hint?: string;
  icon: React.ReactNode;
  color: "emerald" | "uqu" | "cyan" | "rose";
}) {
  const textColors = {
    emerald: "text-emerald-800 dark:text-emerald-300",
    uqu: "text-uqu-accent",
    cyan: "text-cyan-800 dark:text-cyan-300",
    rose: "text-rose-800 dark:text-rose-300",
  } as const;

  return (
    <Card className="glass p-3.5 md:p-4 gap-1 rounded-2xl border-foreground/10 hover:border-uqu-accent/30 transition-colors h-full">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-muted-foreground leading-snug">{title}</h3>
        <span className="hidden sm:inline-flex" aria-hidden>
          {icon}
        </span>
      </div>
      <div className={cn("text-2xl md:text-3xl font-black tracking-tight tabular-nums", textColors[color])}>{value}</div>
      {hint && <div className="text-[11px] leading-snug text-muted-foreground line-clamp-2">{hint}</div>}
    </Card>
  );
}


export function KvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-3 rounded-xl bg-background border border-border flex justify-between items-center dark:bg-foreground/5 dark:border-foreground/10">
      <span className="text-muted-foreground text-sm font-bold">{label}:</span>
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
      ? "bg-uqu-accent/10 border-uqu-accent/20 text-uqu-accent"
      : "bg-background border-border text-foreground dark:bg-foreground/5 dark:border-foreground/10";
  return (
    <div className={cn("p-3 rounded-xl border", tone)}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-black font-mono">{value}</div>
    </div>
  );
}
