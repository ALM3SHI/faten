"use client";

import { cn } from "@/lib/utils";
import type { EnrichedCourse } from "@/store/transcriptStore";
import { gradeToneClass } from "@/lib/grade-scale";

export function RecentCourseRow({ course }: { course: EnrichedCourse }) {
  const grade = course.grade || "—";
  const tone = gradeToneClass(grade);
  return (
    <div className="flex items-center gap-2.5 p-2 rounded-lg bg-background border border-border dark:bg-foreground/5 dark:border-foreground/10">
      {/* PRIMARY: credit hours — big, monospaced, glowing accent tile. */}
      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/25 flex flex-col items-center justify-center shrink-0">
        <span className="text-[15px] font-black font-mono text-cyan-700 dark:text-cyan-300 leading-none">
          {course.creditHours}
        </span>
        <span className="text-[8px] font-bold text-cyan-700/70 dark:text-cyan-300/60 mt-0.5">
          ساعة
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold truncate">
          {course.nameAr || course.nameEn || course.code}
        </div>
        <div className="text-[10px] text-muted font-mono">
          {course.code}
        </div>
      </div>
      {/* SECONDARY: grade — smaller, lower contrast, no border. */}
      <div
        className={cn(
          "px-1.5 py-0.5 rounded text-[10px] font-bold font-mono shrink-0 opacity-70",
          tone,
        )}
      >
        {grade}
      </div>
    </div>
  );
}
