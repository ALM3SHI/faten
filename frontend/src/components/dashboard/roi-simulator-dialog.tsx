"use client";

import { useEffect, useMemo, useState } from "react";
import { Zap, Sparkles } from "lucide-react";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GRADE_POINTS, SELECTABLE_GRADES, gradeToneClass } from "@/lib/grade-scale";

// ── 3. High-ROI Course Dialog — Unified What-If Simulator ────────
// Sprint 2 — Bug #12 fix:
// Replaces the old per-row isolated tables with ONE interactive dialog
// that lets the user dial in a hypothetical grade for every current-term
// course at once and watch the projected cumulative GPA recompute in
// real time. Strategy banner highlights the single biggest leverage
// course so users know where to invest the most effort.
const SIMULATION_GRADES: { letter: string; points: number }[] = SELECTABLE_GRADES.map((letter) => ({
  letter,
  points: GRADE_POINTS[letter] as number,
}));


/** Full roster row for the simulator — every in-progress course, credits already resolved. */
type RoiRosterCourse = { code: string; name: string; credits: number };


export function RoiSimulatorDialog({
  roster,
  currentGpa,
  earnedHours,
}: {
  roster: RoiRosterCourse[];
  currentGpa: number;
  earnedHours: number;
}) {
  // Default every course to A+ ("maximum potential") per spec.
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(roster.map((c) => [c.code, "A+"])),
  );

  // Reconcile when the roster changes (e.g., a new term gets imported
  // while the user has the dialog open). Add defaults for new codes,
  // drop entries for codes that disappeared — preserve any picks the
  // user already chose.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile picks with the live course list
    setPicks((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const c of roster) {
        if (prev[c.code]) {
          next[c.code] = prev[c.code];
        } else {
          next[c.code] = "A+";
          changed = true;
        }
      }
      if (!changed && Object.keys(prev).length === roster.length) return prev;
      return next;
    });
  }, [roster]);

  // ── Live projection math ──
  const { termPoints, termHours, projectedGpa, delta } = useMemo(() => {
    const lookup = new Map(SIMULATION_GRADES.map((g) => [g.letter, g.points]));
    let pts = 0;
    let hrs = 0;
    for (const c of roster) {
      const pickedLetter = picks[c.code] ?? "A+";
      const p = lookup.get(pickedLetter) ?? 4.0;
      pts += p * c.credits;
      hrs += c.credits;
    }
    const currentPoints = currentGpa * earnedHours;
    const newHours = earnedHours + hrs;
    const projected = newHours > 0 ? (currentPoints + pts) / newHours : currentGpa;
    return {
      termPoints: pts,
      termHours: hrs,
      projectedGpa: projected,
      delta: projected - currentGpa,
    };
  }, [picks, roster, currentGpa, earnedHours]);

  // ── AI strategy banner ──
  // Highest-credits current course = the biggest GPA leverage. If we have
  // ties, prefer the one whose CURRENT pick is below A+ (more impactful
  // to call out a "don't compromise here" choice when the student has
  // already lowered their expectation).
  const leverageCourse = useMemo(() => {
    if (roster.length === 0) return null;
    const sorted = [...roster].sort((a, b) => {
      if (b.credits !== a.credits) return b.credits - a.credits;
      const aDown = (picks[a.code] ?? "A+") !== "A+" ? 1 : 0;
      const bDown = (picks[b.code] ?? "A+") !== "A+" ? 1 : 0;
      return bDown - aDown;
    });
    return sorted[0];
  }, [roster, picks]);

  const projectionTone =
    delta >= 0.05
      ? { glow: "hsl(160, 95%, 55%)", text: "text-emerald-700 dark:text-emerald-300" }
      : delta <= -0.05
        ? { glow: "hsl(0, 80%, 60%)", text: "text-rose-700 dark:text-rose-300" }
        : { glow: "hsl(245, 78%, 62%)", text: "text-uqu-accent" };

  const resetAll = () =>
    setPicks(Object.fromEntries(roster.map((c) => [c.code, "A+"])));

  return (
    <DialogContent
      className="!bg-card border-border text-foreground shadow-2xl backdrop-blur-xl dark:!bg-card/95 dark:border-foreground/10 rounded-[28px] p-0 sm:max-w-[min(820px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-border dark:border-foreground/10 shrink-0">
        <DialogTitle className="text-xl font-black flex items-center gap-3">
          <Zap className="w-6 h-6 text-amber-700 dark:text-amber-400" />
          محاكي السيناريوهات — ماذا لو؟
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          جرّب درجات افتراضية على مواد فصلك الحالي وشاهد أثرها الفوري على
          معدلك التراكمي.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* HERO — projected cumulative GPA, glowing, updates instantly */}
        <div
          className="relative rounded-3xl border border-border dark:border-foreground/10 bg-gradient-to-l from-uqu-accent/[0.08] via-cyan-500/[0.06] to-emerald-500/[0.08] p-6 text-center overflow-hidden"
          style={{
            boxShadow: `0 0 40px -10px ${projectionTone.glow}`,
          }}
        >
          <span
            className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full blur-3xl opacity-50"
            style={{ background: projectionTone.glow }}
          />
          <div className="relative">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">
              المعدل التراكمي المتوقع
            </div>
            <div
              className={cn(
                "text-6xl md:text-7xl font-black tracking-tighter font-mono leading-none",
                projectionTone.text,
              )}
              style={{ textShadow: `0 0 24px ${projectionTone.glow}` }}
            >
              {projectedGpa.toFixed(2)}
            </div>
            <div className="text-[11px] text-muted mt-3 font-mono">
              من أصل 4.00 · حالياً {currentGpa.toFixed(2)} ·{" "}
              <span className={cn("font-bold", projectionTone.text)}>
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* AI strategy banner */}
        {leverageCourse && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/[0.06] border border-amber-500/25">
            <Sparkles className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-amber-800 dark:text-amber-200 leading-relaxed">
              <span className="font-black">استراتيجية ذكية:</span>{" "}
              لتحقيق أعلى قفزة، لا تتنازل عن{" "}
              <span className="font-mono font-black bg-amber-500/20 px-1.5 py-0.5 rounded">
                A+
              </span>{" "}
              في مادة{" "}
              <span className="font-black">{leverageCourse.name}</span>{" "}
              <span className="text-amber-700/80 dark:text-amber-200/70 font-normal">
                ({leverageCourse.credits} ساعات — أعلى ثقل في فصلك).
              </span>
            </p>
          </div>
        )}

        {/* Per-course pickers */}
        {roster.length === 0 ? (
          <div className="h-[180px] flex flex-col items-center justify-center border-2 border-dashed border-border dark:border-foreground/10 rounded-2xl text-center gap-2 p-6">
            <Zap className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              لا توجد مواد مسجّلة في الفصل الحالي. أكمل الإعداد من الملف الشخصي.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                مواد الفصل الحالي ({roster.length})
              </h4>
              <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
                <span>مجموع الساعات: {termHours}</span>
                <span>·</span>
                <span>نقاط متوقعة: {termPoints.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={resetAll}
                  className="text-uqu-accent hover:text-uqu-accent/80 font-bold underline mr-1"
                >
                  إعادة الكل لـA+
                </button>
              </div>
            </div>

            <div className="grid grid-cols-12 px-3 text-[10px] font-black uppercase tracking-wider text-muted">
              <span className="col-span-6">المادة</span>
              <span className="col-span-2 text-center">ساعات</span>
              <span className="col-span-2 text-center">الدرجة</span>
              <span className="col-span-2 text-left">المساهمة</span>
            </div>
            {roster.map((c) => (
              <RoiSimRow
                key={c.code}
                course={c}
                pick={picks[c.code] ?? "A+"}
                onChange={(letter) =>
                  setPicks((prev) => ({ ...prev, [c.code]: letter }))
                }
              />
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground leading-relaxed pt-1 border-t border-border dark:border-foreground/10">
          الحساب:{" "}
          <span className="font-mono">
            projected = (current_gpa × earned + Σ(grade × credits)) / (earned + Σcredits)
          </span>
          — على مقياس UQU 4.00 الرسمي.
        </p>
      </div>
    </DialogContent>
  );
}


function RoiSimRow({
  course,
  pick,
  onChange,
}: {
  course: RoiRosterCourse;
  pick: string;
  onChange: (letter: string) => void;
}) {
  const points = SIMULATION_GRADES.find((g) => g.letter === pick)?.points ?? 4;
  const contribution = points * course.credits;
  const tone = gradeToneClass(pick);
  return (
    <div className="grid grid-cols-12 items-center px-3 py-2.5 rounded-xl bg-background border border-border dark:bg-foreground/5 dark:border-foreground/10 text-[12px] gap-2">
      <div className="col-span-6 min-w-0">
        <div className="font-bold truncate">{course.name}</div>
        <div className="text-[10px] font-mono text-muted mt-0.5">{course.code}</div>
      </div>
      <div className="col-span-2 text-center font-mono font-bold text-foreground">
        {course.credits}
      </div>
      <div className="col-span-2 flex justify-center">
        <div
          className={cn(
            "relative inline-flex items-center rounded-md border font-mono font-black text-[11px]",
            tone,
          )}
        >
          <select
            value={pick}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`اختر درجة افتراضية لمادة ${course.name}`}
            className="appearance-none bg-transparent pr-2 pl-6 py-1 outline-none cursor-pointer"
          >
            {SIMULATION_GRADES.map((g) => (
              <option key={g.letter} value={g.letter} className="bg-background text-foreground">
                {g.letter}
              </option>
            ))}
          </select>
          <span className="w-2 h-2 absolute left-2 pointer-events-none opacity-50 border-l-2 border-b-2 border-current rotate-[-45deg]" />
        </div>
      </div>
      <div className="col-span-2 text-left font-mono font-black text-amber-800 dark:text-amber-300">
        {contribution.toFixed(2)}
      </div>
    </div>
  );
}
