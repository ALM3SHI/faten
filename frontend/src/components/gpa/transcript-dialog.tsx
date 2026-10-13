"use client";

import { useState } from "react";
import { BookOpenCheck, ChevronDown, GraduationCap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { extractYearKey } from "@/lib/transcript-utils";
import { gradeToneClass, MUTED_GRADE_TONE } from "@/lib/grade-scale";
import type { EnrichedCourse } from "@/store/transcriptStore";

function shortSemesterLabel(semester: string): string {
  const yearMatch = semester.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : "";
  if (semester.includes("الأول")) return `الفصل الأول ${year}`.trim();
  if (semester.includes("الثاني")) return `الفصل الثاني ${year}`.trim();
  if (semester.includes("الثالث") || semester.includes("الصيف")) {
    return `الفصل الصيفي ${year}`.trim();
  }
  return semester;
}


function SemesterBentoCard({
  label,
  termGpa,
  termHours,
  items,
}: {
  label: string;
  termGpa: number;
  termHours: number;
  items: EnrichedCourse[];
}) {
  return (
    <div className="rounded-2xl bg-background border border-border hover:border-border dark:bg-foreground/5 dark:border-foreground/10 dark:hover:border-foreground/10 transition-colors p-4 md:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-black truncate">{label}</h4>
          <p className="text-[10px] text-muted font-mono mt-0.5">
            {items.length} مادة • {termHours} ساعة
          </p>
        </div>
        <div className="text-left shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-muted">
            معدل الفصل
          </div>
          <div className="text-2xl font-black font-mono leading-none mt-1">
            {termGpa.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        {items.map((c) => (
          <div
            key={`${label}-${c.code}`}
            className="flex items-center gap-2 p-2 rounded-lg bg-secondary/40 border border-border dark:bg-foreground/5 dark:border-foreground/10"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold truncate">
                {c.nameAr || c.nameEn || c.code}
              </div>
              <div className="text-[10px] text-muted font-mono">
                {c.code} · {c.creditHours}س
              </div>
            </div>
            <span
              className={cn(
                "px-2 py-0.5 rounded-md text-[10px] font-black font-mono shrink-0 border",
                gradeToneClass(c.grade, MUTED_GRADE_TONE),
              )}
            >
              {c.grade ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SemesterGroup {
  semester: string;
  label: string;
  items: EnrichedCourse[];
  termHours: number;
  termGpa: number;
}

/** Completed courses grouped by semester, oldest first, with each term's GPA. */
export function groupBySemester(completedCourses: EnrichedCourse[]): SemesterGroup[] {
  const groups = new Map<string, EnrichedCourse[]>();
  for (const c of completedCourses) {
    if (!c.semester) continue;
    const list = groups.get(c.semester) ?? [];
    list.push(c);
    groups.set(c.semester, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ya = extractYearKey(a);
      const yb = extractYearKey(b);
      if (ya !== yb) return ya - yb;
      return a.localeCompare(b);
    })
    .map(([semester, items]) => {
      const points = items.reduce((s, c) => s + (c.gradePoints ?? 0) * c.creditHours, 0);
      const hours = items.reduce((s, c) => s + c.creditHours, 0);
      return {
        semester,
        label: shortSemesterLabel(semester),
        items,
        termHours: hours,
        termGpa: hours > 0 ? points / hours : 0,
      };
    });
}

/** "View detailed transcript" button + dialog with a bento grid of past terms. */
export function TranscriptDialog({
  semesters,
  historicalHours,
}: {
  semesters: SemesterGroup[];
  historicalHours: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="w-full group relative overflow-hidden rounded-[28px] glass border border-foreground/10 hover:border-uqu-accent/40 transition-all px-6 py-5 flex items-center justify-between gap-4"
          >
            <span className="absolute inset-0 bg-gradient-to-l from-uqu-accent/0 via-uqu-accent/[0.04] to-uqu-accent/0 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative flex items-center gap-3 min-w-0">
              <span className="w-11 h-11 rounded-2xl bg-uqu-accent/10 border border-uqu-accent/20 text-uqu-accent flex items-center justify-center shrink-0">
                <BookOpenCheck className="w-5 h-5" />
              </span>
              <span className="text-right">
                <span className="block text-base font-black">
                  عرض السجل الأكاديمي التفصيلي
                </span>
                <span className="block text-[11px] text-muted mt-0.5">
                  {semesters.length} فصل دراسي مكتمل • {historicalHours} ساعة معتمدة
                </span>
              </span>
            </span>
            <span className="relative text-uqu-accent font-bold text-sm flex items-center gap-1 shrink-0">
              فتح
              <ChevronDown className="w-4 h-4 -rotate-90 transition-transform group-hover:translate-x-[-2px]" />
            </span>
          </button>
        }
      />
      <DialogContent className="!bg-card border-border text-foreground shadow-2xl backdrop-blur-xl dark:!bg-card/95 dark:border-foreground/10 sm:max-w-[min(1100px,calc(100%-2rem))] max-h-[88vh] flex flex-col p-0 rounded-[28px]">
        <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-border dark:border-foreground/10 shrink-0">
          <DialogTitle className="text-xl font-black flex items-center gap-3">
            <GraduationCap className="w-6 h-6 text-uqu-accent" />
            السجل الأكاديمي التفصيلي
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            جميع فصولك المكتملة بالمعدل الفصلي وقائمة المواد لكل فصل.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
          {semesters.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              لا توجد فصول مكتملة بعد.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {semesters.map((sem) => (
                <SemesterBentoCard
                  key={sem.semester}
                  label={sem.label}
                  termGpa={sem.termGpa}
                  termHours={sem.termHours}
                  items={sem.items}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
