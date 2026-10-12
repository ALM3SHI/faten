"use client";

/**
 * Smart GPA Planner & Simulator (/gpa)
 *
 * Auto-loads from useTranscriptStore + useProfileStore. Every grade change
 * recomputes the projected cumulative GPA inline; no "Calculate" button.
 *
 *   Past terms   → useTranscriptStore.completedCourses (read-only, in modal)
 *   Current term → useTranscriptStore.currentCourses + user-added mocks
 *   Baseline     → useTranscriptStore.gpa, .earnedHours
 *   Plan target  → useProfileStore.basic.totalPlanHours, .goals.targetGpa
 *
 * Layout:
 *   1. Three glass summary cards (cumulative, completed hours, required-to-graduate)
 *   2. Current Semester Simulator (only editable section on the page)
 *   3. "View Detailed Transcript" button → Dialog with a 2-col bento grid of
 *      past semesters. This keeps the planning view focused on the simulator.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Calculator,
  TrendingUp,
  Target,
  Clock,
  ChevronDown,
  Plus,
  Trash2,
  GraduationCap,
  AlertCircle,
  BookOpenCheck,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useTranscriptStore, type EnrichedCourse } from "@/store/transcriptStore";
import { useProfileStore } from "@/store/profileStore";
import { GRADE_MAP } from "@/lib/transcript-parser";
import { buildCreditsResolver, DEFAULT_COURSE_CREDITS } from "@/lib/transcript-utils";

// ──────────────────────────────────────────────────────────────────
// Constants — grading scale + projection bounds
// ──────────────────────────────────────────────────────────────────

const SELECTABLE_GRADES = ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "F"] as const;
type SelectableGrade = (typeof SELECTABLE_GRADES)[number];

// DEFAULT_COURSE_CREDITS is re-exported from lib/transcript-utils so this
// page and the dashboard share a single source of truth for both the
// credits-resolver fallback AND the "Add Mock Course" seed value.
// Official UQU 4.00 scale. The whole app — parser, dashboard, advisor,
// backend analytics — operates on this single scale; do not introduce
// any 5.0 ceiling, floor, or label anywhere.
const UQU_GPA_CEILING = 4.0;
const UQU_GPA_FLOOR = 1.0;            // Lower-bound clamp for the required-to-graduate display.
const CURRENT_TERM_LABEL = "الفصل الحالي";

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function extractYearKey(semester: string): number {
  const matches = semester.match(/\d{4}/g);
  if (!matches) return Number.POSITIVE_INFINITY;
  const nums = matches.map((m) => parseInt(m, 10)).filter(Number.isFinite);
  return nums.length > 0 ? Math.min(...nums) : Number.POSITIVE_INFINITY;
}

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

function gradeBadgeTone(grade: string | null): string {
  if (!grade) return "bg-foreground/5 text-muted border-foreground/10";
  const g = grade.toUpperCase();
  if (g === "A+" || g === "A") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (g === "B+" || g === "B") return "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  if (g === "C+" || g === "C") return "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30";
  if (g === "D+" || g === "D") return "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30";
  if (g === "F" || g === "DN") return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
  return "bg-foreground/5 text-muted border-foreground/10";
}

type MockCourse = {
  id: string;
  code: string;
  name: string;
  credits: number;
  grade: SelectableGrade;
};

type SimRow = {
  key: string;
  code: string;
  name: string;
  credits: number;
  grade: SelectableGrade;
  origin: "registered" | "mock";
};

// ──────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────

export default function GPAPage() {
  // ── Stores ────────────────────────────────────────────────────────
  const completedCourses = useTranscriptStore((s) => s.completedCourses);
  const currentCourses = useTranscriptStore((s) => s.currentCourses);
  const transcriptGpa = useTranscriptStore((s) => s.gpa);
  const transcriptEarned = useTranscriptStore((s) => s.earnedHours);
  const hasTranscript =
    completedCourses.length > 0 || currentCourses.length > 0;

  const totalPlanHours = useProfileStore((s) => {
    const v = s.basic.totalPlanHours;
    return typeof v === "number" && v > 0 ? v : 0;
  });
  const targetGpa = useProfileStore((s) => s.goals.targetGpa) || 0;

  // ── Local simulator state ────────────────────────────────────────
  const [simulatedGrades, setSimulatedGrades] = useState<
    Record<string, SelectableGrade>
  >({});
  const [mockCourses, setMockCourses] = useState<MockCourse[]>([]);
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);

  // ── Credit-hour lookup (fixes the parser's "creditHours = 0" bug
  //    for registered courses) ───────────────────────────────────────
  // Backed by the shared `buildCreditsResolver` so the GPA Planner and
  // the Dashboard's High-ROI ranker never drift. See lib/transcript-
  // utils.ts for the resolution chain.
  const resolveCredits = useMemo(
    () => buildCreditsResolver(completedCourses),
    [completedCourses],
  );

  // ── Historical baseline (authoritative — never recomputed) ───────
  const historicalGpa = transcriptGpa ?? 0;
  const historicalHours = transcriptEarned ?? 0;
  const historicalPoints = historicalGpa * historicalHours;

  // ── Per-semester groups for the transcript modal ─────────────────
  const historicalSemesters = useMemo(() => {
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
        const points = items.reduce(
          (s, c) => s + (c.gradePoints ?? 0) * c.creditHours,
          0,
        );
        const hours = items.reduce((s, c) => s + c.creditHours, 0);
        return {
          semester,
          label: shortSemesterLabel(semester),
          items,
          termHours: hours,
          termGpa: hours > 0 ? points / hours : 0,
        };
      });
  }, [completedCourses]);

  // ── Simulator rows (registered + mock) ───────────────────────────
  const simulatorRows = useMemo<SimRow[]>(() => {
    const registered: SimRow[] = currentCourses.map((c) => ({
      key: `reg:${c.code}`,
      code: c.code,
      name: c.nameAr || c.nameEn || c.code,
      credits: resolveCredits(c.creditHours, c.code),
      grade: simulatedGrades[c.code] ?? "A",
      origin: "registered",
    }));
    const mocks: SimRow[] = mockCourses.map((m) => ({
      key: `mock:${m.id}`,
      code: m.code || "—",
      name: m.name || "مادة افتراضية",
      credits: m.credits,
      grade: m.grade,
      origin: "mock",
    }));
    return [...registered, ...mocks];
  }, [currentCourses, simulatedGrades, mockCourses, resolveCredits]);

  // ── Projection math (live) ───────────────────────────────────────
  const projection = useMemo(() => {
    const termPoints = simulatorRows.reduce(
      (s, r) => s + (GRADE_MAP[r.grade] ?? 0) * r.credits,
      0,
    );
    const termHours = simulatorRows.reduce((s, r) => s + r.credits, 0);

    const projectedHours = historicalHours + termHours;
    const projectedPoints = historicalPoints + termPoints;
    const projectedGpa =
      projectedHours > 0 ? projectedPoints / projectedHours : historicalGpa;
    const delta = projectedGpa - historicalGpa;

    // ── Required-to-graduate (replaces the old "next 15 hours" formula) ──
    // Uses the student's full graduation plan instead of a fixed window so
    // the number stops jumping every time a single course is added.
    //
    //   remainingHours = totalPlanHours − projectedHours
    //   required       = (target * totalPlanHours − projectedPoints) / remainingHours
    //
    // Clamped to [UQU_GPA_FLOOR, UQU_GPA_CEILING] for display so the card
    // never shows a nonsensical 8.42 or −1.20.
    type RequiredStatus =
      | "achieved"
      | "feasible"
      | "stretch"
      | "impossible"
      | "no_plan"
      | "no_target"
      | "complete";

    let requiredToGraduate:
      | { value: number; raw: number; status: RequiredStatus; remainingHours: number }
      | null = null;

    if (targetGpa <= 0) {
      requiredToGraduate = {
        value: 0,
        raw: 0,
        status: "no_target",
        remainingHours: 0,
      };
    } else if (totalPlanHours <= 0) {
      requiredToGraduate = {
        value: 0,
        raw: 0,
        status: "no_plan",
        remainingHours: 0,
      };
    } else {
      const remainingHours = totalPlanHours - projectedHours;
      if (remainingHours <= 0) {
        // Student has already met (or exceeded) the plan's credit load.
        requiredToGraduate = {
          value: projectedGpa,
          raw: projectedGpa,
          status: projectedGpa >= targetGpa ? "achieved" : "complete",
          remainingHours: Math.max(remainingHours, 0),
        };
      } else if (projectedGpa >= targetGpa) {
        requiredToGraduate = {
          value: projectedGpa,
          raw: projectedGpa,
          status: "achieved",
          remainingHours,
        };
      } else {
        const desired = targetGpa * totalPlanHours;
        const raw = (desired - projectedPoints) / remainingHours;
        const clamped = Math.min(UQU_GPA_CEILING, Math.max(UQU_GPA_FLOOR, raw));
        let status: RequiredStatus;
        if (raw > UQU_GPA_CEILING) status = "impossible";
        else if (raw > UQU_GPA_CEILING - 0.5) status = "stretch";
        else status = "feasible";
        requiredToGraduate = {
          value: clamped,
          raw,
          status,
          remainingHours,
        };
      }
    }

    return {
      termPoints,
      termHours,
      termGpa: termHours > 0 ? termPoints / termHours : 0,
      projectedHours,
      projectedGpa,
      delta,
      requiredToGraduate,
    };
  }, [
    simulatorRows,
    historicalHours,
    historicalPoints,
    historicalGpa,
    targetGpa,
    totalPlanHours,
  ]);

  // ── Mutations ────────────────────────────────────────────────────
  const setSimGrade = (code: string, grade: SelectableGrade) =>
    setSimulatedGrades((prev) => ({ ...prev, [code]: grade }));

  const setMockField = <K extends keyof MockCourse>(
    id: string,
    field: K,
    value: MockCourse[K],
  ) =>
    setMockCourses((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
    );

  const addMockCourse = () => {
    const id = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setMockCourses((prev) => [
      ...prev,
      { id, code: "", name: "", credits: DEFAULT_COURSE_CREDITS, grade: "A" },
    ]);
  };

  const removeMockCourse = (id: string) =>
    setMockCourses((prev) => prev.filter((m) => m.id !== id));

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-28 px-4 md:px-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h1 className="text-4xl font-black flex items-center gap-3">
                <Calculator className="w-8 h-8 text-uqu-accent" />
                حاسبة المعدل
              </h1>
            </div>
          </div>

          {!hasTranscript ? (
            <EmptyTranscriptState />
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100 fill-mode-both">
                <SummaryCard
                  label="المعدل التراكمي"
                  primary={historicalGpa.toFixed(2)}
                  secondaryLabel="بعد المحاكاة"
                  secondaryValue={projection.projectedGpa.toFixed(2)}
                  delta={projection.delta}
                  icon={<TrendingUp className="w-6 h-6 text-emerald-400" />}
                  accent="emerald"
                />
                <SummaryCard
                  label="الساعات المنجزة"
                  primary={String(historicalHours)}
                  secondaryLabel={
                    totalPlanHours > 0
                      ? `من أصل ${totalPlanHours}`
                      : "ساعة معتمدة"
                  }
                  secondaryValue={
                    totalPlanHours > 0
                      ? `${Math.round((historicalHours / totalPlanHours) * 100)}%`
                      : undefined
                  }
                  icon={<Clock className="w-6 h-6 text-cyan-400" />}
                  accent="cyan"
                />
                <RequiredToGraduateCard
                  targetGpa={targetGpa}
                  totalPlanHours={totalPlanHours}
                  required={projection.requiredToGraduate}
                />
              </div>

              {/* Current Semester Simulator */}
              <SimulatorSection
                subtitle={
                  simulatorRows.length === 0
                    ? "لا توجد مواد مسجّلة — أضف مادة افتراضية لتجربة الأثر"
                    : `${simulatorRows.length} مادة • ${projection.termHours} ساعة • معدل الفصل ${projection.termGpa.toFixed(2)}`
                }
              >
                <div className="space-y-2.5">
                  {simulatorRows.map((row) =>
                    row.origin === "registered" ? (
                      <RegisteredCourseRow
                        key={row.key}
                        row={row}
                        onGradeChange={(g) => setSimGrade(row.code, g)}
                      />
                    ) : (
                      <MockCourseRow
                        key={row.key}
                        row={row}
                        onChange={(field, value) =>
                          setMockField(row.key.replace(/^mock:/, ""), field, value)
                        }
                        onRemove={() =>
                          removeMockCourse(row.key.replace(/^mock:/, ""))
                        }
                      />
                    ),
                  )}

                  <button
                    type="button"
                    onClick={addMockCourse}
                    className="w-full p-3 rounded-xl border border-dashed border-foreground/10 text-muted hover:text-uqu-accent hover:border-uqu-accent/40 hover:bg-uqu-accent/[0.04] transition-all flex items-center justify-center gap-2 text-sm font-bold"
                  >
                    <Plus className="w-4 h-4" />
                    إضافة مادة افتراضية (Mock)
                  </button>
                </div>
              </SimulatorSection>

              {/* Detailed transcript modal trigger */}
              <Dialog open={transcriptModalOpen} onOpenChange={setTranscriptModalOpen}>
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
                            {historicalSemesters.length} فصل دراسي مكتمل • {historicalHours} ساعة معتمدة
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
                    {historicalSemesters.length === 0 ? (
                      <div className="text-center py-12 text-sm text-muted-foreground">
                        لا توجد فصول مكتملة بعد.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {historicalSemesters.map((sem) => (
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

              {/* Scale footer */}
              <div className="flex items-center gap-3 p-5 rounded-2xl bg-foreground/5 border border-foreground/10 text-xs text-muted leading-relaxed">
                <Target className="w-4 h-4 text-uqu-accent shrink-0" />
                <span>
                  المقياس: نظام جامعة أم القرى (4.00). الأرقام: A+ = 4.00، A = 3.75،
                  B+ = 3.50، B = 3.00، C+ = 2.50، C = 2.00، D+ = 1.50، D = 1.00، F = 0.00.
                </span>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  primary,
  secondaryLabel,
  secondaryValue,
  delta,
  icon,
  accent,
}: {
  label: string;
  primary: string;
  secondaryLabel: string;
  secondaryValue?: string;
  delta?: number;
  icon: React.ReactNode;
  accent: "emerald" | "cyan" | "uqu";
}) {
  const tone = {
    emerald: "bg-emerald-500/10 border-emerald-500/20",
    cyan: "bg-cyan-500/10 border-cyan-500/20",
    uqu: "bg-uqu-accent/10 border-uqu-accent/20",
  }[accent];

  const deltaSign = delta != null ? (delta > 0 ? "+" : delta < 0 ? "" : "±") : "";
  const deltaColor =
    delta == null || Math.abs(delta) < 0.005
      ? "text-muted"
      : delta > 0
        ? "text-emerald-400"
        : "text-rose-400";

  return (
    <Card className="glass p-6 rounded-[28px] border-foreground/10 hover:border-foreground/10 transition-colors group">
      <div className="flex items-start justify-between mb-5">
        <h3 className="text-sm font-extrabold tracking-wide text-muted-foreground">
          {label}
        </h3>
        <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center border", tone)}>
          {icon}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-[2.75rem] leading-none font-black tracking-tighter font-mono">
          {primary}
        </div>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted font-semibold">{secondaryLabel}</span>
          {secondaryValue !== undefined && (
            <span className="font-mono font-bold text-foreground">{secondaryValue}</span>
          )}
        </div>
        {delta != null && (
          <div
            className={cn(
              "text-xs font-semibold font-mono mt-1 pt-2 border-t border-foreground/10",
              deltaColor,
            )}
          >
            {Math.abs(delta) < 0.005
              ? "لا تغيير حتى الآن"
              : `${deltaSign}${delta.toFixed(2)} من المحاكاة`}
          </div>
        )}
      </div>
    </Card>
  );
}

function RequiredToGraduateCard({
  targetGpa,
  totalPlanHours,
  required,
}: {
  targetGpa: number;
  totalPlanHours: number;
  required: {
    value: number;
    raw: number;
    status:
      | "achieved"
      | "feasible"
      | "stretch"
      | "impossible"
      | "no_plan"
      | "no_target"
      | "complete";
    remainingHours: number;
  } | null;
}) {
  // No target → CTA to /profile
  if (!required || required.status === "no_target" || targetGpa <= 0) {
    return (
      <Card className="glass p-6 rounded-[28px] border-foreground/10">
        <div className="flex items-start justify-between mb-5">
          <h3 className="text-sm font-extrabold tracking-wide text-muted-foreground">
            المعدل المطلوب للأترام المتبقية
          </h3>
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center border bg-foreground/5 border-foreground/10">
            <Target className="w-6 h-6 text-muted" />
          </div>
        </div>
        <div className="text-[2.75rem] leading-none font-black text-muted mb-2">—</div>
        <p className="text-xs text-muted leading-relaxed">
          حدّد معدلاً مستهدفاً من{" "}
          <Link href="/profile" className="text-uqu-accent font-bold underline">
            صفحة الملف الشخصي
          </Link>{" "}
          لرؤية المطلوب لتحقيقه.
        </p>
      </Card>
    );
  }

  // Target set but plan hours unknown → CTA to /profile
  if (required.status === "no_plan" || totalPlanHours <= 0) {
    return (
      <Card className="glass p-6 rounded-[28px] border-foreground/10">
        <div className="flex items-start justify-between mb-5">
          <h3 className="text-sm font-extrabold tracking-wide text-muted-foreground">
            المعدل المطلوب للأترام المتبقية
          </h3>
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center border bg-amber-500/10 border-amber-500/20">
            <AlertCircle className="w-6 h-6 text-amber-400" />
          </div>
        </div>
        <div className="text-[2.75rem] leading-none font-black text-muted mb-2">—</div>
        <p className="text-xs text-muted leading-relaxed">
          أدخل عدد ساعات خطتك الأكاديمية في{" "}
          <Link href="/profile" className="text-uqu-accent font-bold underline">
            صفحة الملف الشخصي
          </Link>{" "}
          (مثلاً 132) لحساب المعدل المطلوب لتحقيق الهدف عند التخرج.
        </p>
      </Card>
    );
  }

  const toneByStatus = {
    achieved: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    complete: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    feasible: "bg-uqu-accent/10 border-uqu-accent/20 text-uqu-accent",
    stretch: "bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300",
    impossible: "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300",
  } as const;

  const headlineByStatus = {
    achieved: "تجاوزت الهدف 🎯",
    complete: "أكملت ساعات الخطة — الهدف لم يُدرك",
    feasible: "على المسار الصحيح",
    stretch: "هدف طموح — يتطلب أداءً ممتازاً",
    impossible: "غير قابل للتحقيق بالساعات المتبقية",
  } as const;

  const status = required.status as keyof typeof toneByStatus;
  const display = required.value.toFixed(2);
  const remaining = required.remainingHours;

  return (
    <Card className={cn("glass p-6 rounded-[28px] border", toneByStatus[status])}>
      <div className="flex items-start justify-between mb-5">
        <h3 className="text-sm font-extrabold tracking-wide opacity-90">
          المعدل المطلوب للأترام المتبقية
        </h3>
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center border border-foreground/10 bg-foreground/5 dark:bg-black/20">
          <Target className="w-6 h-6" />
        </div>
      </div>
      <div className="text-[2.75rem] leading-none font-black tracking-tighter font-mono mb-1">
        {display}
      </div>
      <div className="text-xs font-semibold opacity-90">
        {remaining > 0
          ? `للوصول لمعدل ${targetGpa.toFixed(2)} عبر الـ${remaining} ساعة المتبقية`
          : "أكملت ساعات الخطة"}
      </div>
      <div className="mt-3 pt-3 border-t border-foreground/10 text-xs leading-relaxed opacity-90">
        {headlineByStatus[status]}
      </div>
    </Card>
  );
}

function SimulatorSection({
  subtitle,
  children,
}: {
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="glass rounded-[28px] border-foreground/10 overflow-hidden">
      <div className="p-5 md:p-6 border-b border-foreground/10 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-base font-black truncate">{CURRENT_TERM_LABEL}</h3>
          <p className="text-sm md:text-base font-medium text-foreground/80 mt-1.5">
            {subtitle}
          </p>
        </div>
      </div>
      <div className="px-4 md:px-6 pb-5 md:pb-6 pt-4">{children}</div>
    </Card>
  );
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
                gradeBadgeTone(c.grade),
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

function RegisteredCourseRow({
  row,
  onGradeChange,
}: {
  row: SimRow;
  onGradeChange: (g: SelectableGrade) => void;
}) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 p-3 rounded-xl bg-uqu-accent/[0.04] border border-uqu-accent/15 hover:border-uqu-accent/30 transition-colors">
      <div className="col-span-12 sm:col-span-6 min-w-0">
        <div className="text-[13px] font-bold truncate">{row.name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted font-mono">{row.code}</span>
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-uqu-accent/20 text-uqu-accent border border-uqu-accent/30">
            مسجّلة
          </span>
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2 text-[11px] text-muted">
        <span className="font-mono font-bold text-foreground">{row.credits}</span> ساعة
      </div>
      <div className="col-span-4 sm:col-span-2 text-[11px] text-muted font-mono">
        {((GRADE_MAP[row.grade] ?? 0) * row.credits).toFixed(2)} نقطة
      </div>
      <div className="col-span-4 sm:col-span-2 flex justify-end">
        <GradePicker value={row.grade} onChange={onGradeChange} tone={gradeBadgeTone(row.grade)} />
      </div>
    </div>
  );
}

function MockCourseRow({
  row,
  onChange,
  onRemove,
}: {
  row: SimRow;
  onChange: <K extends keyof MockCourse>(field: K, value: MockCourse[K]) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 p-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/15 group">
      <div className="col-span-12 sm:col-span-6 min-w-0 space-y-1">
        <input
          value={row.name === "مادة افتراضية" ? "" : row.name}
          onChange={(e) => onChange("name", e.target.value)}
          placeholder="اسم المادة الافتراضية"
          className="w-full bg-transparent outline-none text-[13px] font-bold placeholder:text-muted placeholder:font-normal"
        />
        <div className="flex items-center gap-2">
          <input
            value={row.code === "—" ? "" : row.code}
            onChange={(e) => onChange("code", e.target.value.toUpperCase())}
            placeholder="CODE"
            className="w-20 bg-foreground/5 rounded px-1.5 py-0.5 text-[10px] font-mono text-muted outline-none focus:bg-foreground/5"
          />
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30">
            افتراضية
          </span>
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2 flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          max={6}
          value={row.credits}
          onChange={(e) =>
            onChange(
              "credits",
              Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 1)),
            )
          }
          className="w-12 bg-foreground/5 rounded px-1.5 py-1 text-[11px] font-mono outline-none focus:bg-foreground/5"
        />
        <span className="text-[11px] text-muted">ساعة</span>
      </div>
      <div className="col-span-4 sm:col-span-2 text-[11px] text-muted font-mono">
        {((GRADE_MAP[row.grade] ?? 0) * row.credits).toFixed(2)} نقطة
      </div>
      <div className="col-span-4 sm:col-span-2 flex justify-end items-center gap-2">
        <GradePicker
          value={row.grade}
          onChange={(g) => onChange("grade", g)}
          tone={gradeBadgeTone(row.grade)}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="حذف المادة الافتراضية"
          className="text-muted hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function GradePicker({
  value,
  onChange,
  tone,
}: {
  value: SelectableGrade;
  onChange: (g: SelectableGrade) => void;
  tone: string;
}) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center rounded-md border font-mono font-black text-[11px]",
        tone,
      )}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SelectableGrade)}
        className="appearance-none bg-transparent pr-2 pl-6 py-1 outline-none cursor-pointer"
      >
        {SELECTABLE_GRADES.map((g) => (
          <option key={g} value={g} className="bg-background text-foreground">
            {g}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3 h-3 absolute left-1.5 pointer-events-none opacity-70" />
    </div>
  );
}

function EmptyTranscriptState() {
  return (
    <Card className="glass p-12 rounded-[32px] border-foreground/10 text-center space-y-5 animate-in fade-in duration-500">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-foreground/5 border border-foreground/10 flex items-center justify-center">
        <AlertCircle className="w-8 h-8 text-muted" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-black">لم نجد سجلاً أكاديمياً بعد</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          ارفع سجلك الأكاديمي (PDF) من معالج الإعداد لاستيراد المواد المكتملة والمسجّلة تلقائياً،
          ثم ابدأ المحاكاة هنا.
        </p>
      </div>
      <Link href="/profile">
        <Button className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 shadow-lg shadow-uqu-accent/20 gap-2">
          ابدأ الإعداد الأكاديمي
        </Button>
      </Link>
    </Card>
  );
}
