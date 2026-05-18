"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ConnectedPlanProps {
  density?: "single" | "compact";
}

// Static mock until the academic plan service is wired in.
const COURSES = [
  { id: "se", name: "هندسة البرمجيات", code: "CS-301", progress: 0.65 },
  { id: "ds", name: "هياكل البيانات", code: "CS-211", progress: 0.78 },
  { id: "db", name: "قواعد البيانات", code: "CS-321", progress: 0.90 },
  { id: "math", name: "الرياضيات المتقطعة", code: "MATH-203", progress: 0.45 },
];

function toneFor(progress: number): { bar: string; chip: string; chipBg: string } {
  if (progress >= 0.85) return { bar: "bg-emerald-400", chip: "text-emerald-400", chipBg: "bg-emerald-500/10 border-emerald-500/20" };
  if (progress >= 0.6)  return { bar: "bg-[#0066cc]",   chip: "text-[#0066cc]",   chipBg: "bg-[#0066cc]/10 border-[#0066cc]/25" };
  if (progress >= 0.4)  return { bar: "bg-amber-400",   chip: "text-amber-400",   chipBg: "bg-amber-500/10 border-amber-500/20" };
  return                        { bar: "bg-red-400",    chip: "text-red-400",    chipBg: "bg-red-500/10 border-red-500/20" };
}

export function ConnectedPlan({ density = "compact" }: ConnectedPlanProps) {
  return (
    <motion.div
      layout
      className={cn(
        "w-full h-fit shrink-0 flex flex-col bg-foreground/5 backdrop-blur-xl border border-foreground/10 rounded-3xl",
        density === "single" ? "p-5 gap-3" : "p-4 gap-2.5"
      )}
      dir="rtl"
    >
      <div className="flex items-center justify-between shrink-0">
        <span className="text-muted text-[10px] font-bold tracking-tight">المنجز من المنهج</span>
        <span className="text-[10px] text-muted font-bold">{COURSES.length} مقررات</span>
      </div>

      <div className="flex flex-col gap-2">
        {COURSES.map((c, i) => {
          const t = toneFor(c.progress);
          const pct = Math.round(c.progress * 100);
          return (
            <div key={c.id} className="flex flex-col gap-1.5 bg-card/50 border border-foreground/10 rounded-2xl p-3">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex flex-col min-w-0">
                  <span className="text-foreground text-[13px] font-bold tracking-tight truncate">{c.name}</span>
                  <span className="text-muted text-[10px] font-mono font-bold">{c.code}</span>
                </div>
                <span className={cn("text-[10px] font-mono font-black px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0", t.chip, t.chipBg)}>
                  {pct}%
                </span>
              </div>

              <div className="relative h-1.5 w-full bg-foreground/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: i * 0.08, ease: "easeOut" }}
                  className={cn("absolute inset-y-0 right-0 rounded-full", t.bar)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
