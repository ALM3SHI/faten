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

export function StatCard({
  title,
  value,
  subtitle,
  footer,
  icon,
  color,
  delay,
  extraSubtext,
}: {
  title: string;
  value: string;
  subtitle: string;
  footer: string;
  icon: React.ReactNode;
  color: "emerald" | "uqu" | "cyan" | "rose";
  delay?: string;
  /** Sprint-4 Bug #7: subtle second-line muted text rendered below the
   *  primary subtitle (e.g., "Expected GPA based on trajectory: X.XX"
   *  on the Target GPA card). Optional so other cards stay unchanged. */
  extraSubtext?: string;
}) {
  const colorMap = {
    emerald:
      "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 dark:border-emerald-400/20",
    uqu: "bg-uqu-accent/10 border-uqu-accent/20 text-uqu-accent",
    cyan:
      "bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300 dark:border-cyan-400/20",
    rose:
      "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300 dark:border-rose-400/20",
  } as const;

  const textColors = {
    emerald: "text-emerald-800 dark:text-emerald-300",
    uqu: "text-uqu-accent",
    cyan: "text-cyan-800 dark:text-cyan-300",
    rose: "text-rose-800 dark:text-rose-300",
  } as const;

  return (
    <Card
      className={cn(
        "glass p-6 rounded-[28px] border-foreground/10 hover:border-foreground/10 transition-all group animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both",
        "relative overflow-hidden h-full flex flex-col",
        delay,
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-sm font-bold text-foreground leading-snug">
          {title}
        </h3>
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border", colorMap[color])}>
          {icon}
        </div>
      </div>
      <div className="space-y-1">
        <div className={cn("text-4xl font-black tracking-tighter", textColors[color])}>{value}</div>
        <div className="text-[10px] font-bold text-muted-foreground">{subtitle}</div>
        {extraSubtext && (
          <div className="text-[10px] font-medium text-muted leading-relaxed pt-0.5">
            {extraSubtext}
          </div>
        )}
      </div>
      <div className="mt-auto pt-4 border-t border-foreground/10 text-[10px] text-muted-foreground font-medium">
        {footer}
      </div>
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
