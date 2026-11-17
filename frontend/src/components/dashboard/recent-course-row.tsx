"use client";

import { cn } from "@/lib/utils";
import type { EnrichedCourse } from "@/store/transcriptStore";
import { gradeToneClass } from "@/lib/grade-scale";

export function RecentCourseRow({ course }: { course: EnrichedCourse }) {
  const grade = course.grade || "—";
  const tone = gradeToneClass(grade);
  return (
    <div className="flex items-center gap-2.5 p-2 rounded-control bg-surface border border-line">
      {/* PRIMARY: credit hours — big, monospaced, glowing accent tile. */}
      <div className="w-10 h-10 rounded-control bg-info-soft border border-info-line flex flex-col items-center justify-center shrink-0">
        <span className="text-body font-bold font-mono text-info-ink leading-none">
          {course.creditHours}
        </span>
        <span className="text-caption font-bold text-info-ink mt-0.5">
          ساعة
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-small font-bold truncate">
          {course.nameAr || course.nameEn || course.code}
        </div>
        <div className="text-caption text-ink-muted font-mono">
          {course.code}
        </div>
      </div>
      {/* SECONDARY: grade — smaller, lower contrast, no border. */}
      <div
        className={cn(
          "px-1.5 py-0.5 rounded text-caption font-bold font-mono shrink-0 opacity-70",
          tone,
        )}
      >
        {grade}
      </div>
    </div>
  );
}
