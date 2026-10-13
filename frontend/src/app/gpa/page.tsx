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
 *   Plan target  → usePlanHours() (profile, else transcript), .goals.targetGpa
 *
 * Layout:
 *   1. Three glass summary cards (cumulative, completed hours, required-to-graduate)
 *   2. Current Semester Simulator (only editable section on the page)
 *   3. "View Detailed Transcript" button → Dialog with a 2-col bento grid of
 *      past semesters. This keeps the planning view focused on the simulator.
 */

import { useMemo, useState } from "react";
import { Calculator, TrendingUp, Target, Clock, Plus } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { useTranscriptStore } from "@/store/transcriptStore";
import { useProfileStore } from "@/store/profileStore";
import { GRADE_POINTS, type SelectableGrade } from "@/lib/grade-scale";
import { requiredToGraduate } from "@/lib/graduation";
import { usePlanHours } from "@/lib/use-graduation";
import { buildCreditsResolver, DEFAULT_COURSE_CREDITS } from "@/lib/transcript-utils";
import {
  SimulatorSection,
  RegisteredCourseRow,
  MockCourseRow,
  type MockCourse,
  type SimRow,
} from "@/components/gpa/simulator";
import { TranscriptDialog, groupBySemester } from "@/components/gpa/transcript-dialog";
import { SummaryCard, RequiredToGraduateCard } from "@/components/gpa/summary-cards";
import { EmptyTranscriptState } from "@/components/gpa/empty-state";

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

  const totalPlanHours = usePlanHours() ?? 0;
  const targetGpa = useProfileStore((s) => s.goals.targetGpa) || 0;

  // ── Local simulator state ────────────────────────────────────────
  const [simulatedGrades, setSimulatedGrades] = useState<
    Record<string, SelectableGrade>
  >({});
  const [mockCourses, setMockCourses] = useState<MockCourse[]>([]);

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
  const historicalSemesters = useMemo(() => groupBySemester(completedCourses), [completedCourses]);

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
      (s, r) => s + (GRADE_POINTS[r.grade] ?? 0) * r.credits,
      0,
    );
    const termHours = simulatorRows.reduce((s, r) => s + r.credits, 0);

    const projectedHours = historicalHours + termHours;
    const projectedPoints = historicalPoints + termPoints;
    const projectedGpa =
      projectedHours > 0 ? projectedPoints / projectedHours : historicalGpa;
    const delta = projectedGpa - historicalGpa;

    // Required GPA over the rest of the plan (lib/graduation.ts) — uses the
    // full graduation plan, not a fixed "next 15 hours" window.
    const requiredGrad = requiredToGraduate({
      targetGpa,
      planHours: totalPlanHours,
      projectedHours,
      projectedPoints,
    });

    return {
      termPoints,
      termHours,
      termGpa: termHours > 0 ? termPoints / termHours : 0,
      projectedHours,
      projectedGpa,
      delta,
      requiredToGraduate: requiredGrad,
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

      <main className="container mx-auto pt-24 px-4 md:px-8">

        <SectionTabs className="mb-6 max-w-6xl mx-auto" />
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
              <TranscriptDialog semesters={historicalSemesters} historicalHours={historicalHours} />

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
