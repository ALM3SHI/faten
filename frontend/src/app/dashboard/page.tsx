"use client";

/**
 * Academic Intelligence Center — main dashboard.
 *
 * Layout (Bento Grid):
 *   • Top row     — 3 KPI cards: Current GPA · Earned Hours · Target GPA
 *   • Middle row  — Split: Cumulative GPA Line Chart  |  Academic calendar
 *   • Bottom row  — Split: High-ROI Courses           |  Study Adherence
 *   • Tools row   — Attendance · Graduation · University news
 *
 * All analytics math runs on the backend at POST /api/analytics/dashboard
 * (see components/dashboard/use-dashboard-analytics.ts). This page only
 * wires the stores into the bento cells in components/dashboard/, and
 * gracefully degrades when the backend rejects stale data (the classic
 * "old 5.0-scale GPA hits the strict 4.0 validator" case).
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings, Flame, AlertCircle } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { UniversityNewsCard } from "@/components/dashboard/university-news-card";
import { AttendanceSummaryCard } from "@/components/dashboard/attendance-summary-card";
import { GraduationCard } from "@/components/dashboard/graduation-card";
import { ExamsSummaryCard } from "@/components/exams/exams-summary-card";
import { EmailVerificationReminder } from "@/components/email-verification-reminder";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { useProfileStore } from "@/store/profileStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { usePlanStore, taskKey } from "@/store/planStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { buildCreditsResolver, extractYearKey } from "@/lib/transcript-utils";
import { useGraduationProgress } from "@/lib/use-graduation";
import type { TargetCalloutStatus } from "@/components/dashboard/analytics";
import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import { CurrentGpaKpi, EarnedHoursKpi, TargetGpaKpi } from "@/components/dashboard/kpi-cards";
import { AgenticInterventionBanner, InterventionDialogContent } from "@/components/dashboard/agentic-intervention";
import { AdherenceCard, usePlanAdherence } from "@/components/dashboard/adherence";
import { HighRoiCard } from "@/components/dashboard/high-roi-card";
import { MigrationBoundary } from "@/components/dashboard/migration-boundary";
import { CumulativeGpaCard, GpaTrendInsight } from "@/components/dashboard/cumulative-gpa-card";
import { TaskRolloverDialog } from "@/components/dashboard/task-rollover-dialog";
import { AcademicCalendarCard, AcademicCalendarDialogContent } from "@/components/dashboard/academic-calendar";
import { useWelcomeTour } from "@/components/onboarding/use-welcome-tour";

// Dialog bodies load on first open (they carry the charts / simulator code);
// they are only rendered once their dialog has been opened, see below.
const AdherenceDialogContent = dynamic(
  () => import("@/components/dashboard/adherence-dialog").then((m) => m.AdherenceDialogContent),
  { ssr: false },
);
const RoiSimulatorDialog = dynamic(
  () => import("@/components/dashboard/roi-simulator-dialog").then((m) => m.RoiSimulatorDialog),
  { ssr: false },
);
// Only first-time visitors (or a replay from the profile page) load the tour.
const WelcomeTour = dynamic(() => import("@/components/onboarding/welcome-tour").then((m) => m.WelcomeTour), {
  ssr: false,
});

/** Hours the backend assumes for next term until it answers (backend NEXT_HOURS). */
const DEFAULT_NEXT_HOURS = 15;

/**
 * Element that turns a whole bento card into a dialog trigger. A plain
 * element (not a component) because base-ui clones it with its own props.
 * No aria-label: the card's own text is its accessible name, so what a
 * screen reader announces matches what is on screen.
 */
const CARD_TRIGGER = (
  <div role="button" tabIndex={0} className="block w-full text-right cursor-pointer focus:outline-none h-full" />
);

export default function DashboardPage() {
  const router = useRouter();

  // ── Stores ────────────────────────────────────────────────────────
  const basic = useProfileStore((s) => s.basic);
  const goals = useProfileStore((s) => s.goals);

  const completedCourses = useTranscriptStore((s) => s.completedCourses);
  const currentCourses = useTranscriptStore((s) => s.currentCourses);
  const transcriptGpa = useTranscriptStore((s) => s.gpa);
  const transcriptStudentName = useTranscriptStore((s) => s.name || s.nameEn);

  const planMarkTasksDone = usePlanStore((s) => s.markTasksDone);
  const streak = usePomodoroStore((s) => s.currentStreak);
  const graduation = useGraduationProgress();

  // ── Derived ──────────────────────────────────────────────────────
  // Prefer the transcript's authoritative GPA over profile.goals when present.
  const currentGpa = transcriptGpa ?? goals.currentGpa ?? 0;
  const targetGpa = goals.targetGpa ?? 0;

  const earnedHours = useMemo(
    () => completedCourses.reduce((sum, c) => sum + (c.creditHours ?? 0), 0),
    [completedCourses],
  );

  const { analyticsData, analyticsLoading, analyticsError, hydrated } = useDashboardAnalytics({
    currentGpa,
    targetGpa,
    earnedHours,
    completedCourses,
    currentCourses,
  });

  const nextHours = analyticsData?.target_analysis.next_hours ?? DEFAULT_NEXT_HOURS;

  const requiredNext = useMemo<{ required: number; status: TargetCalloutStatus }>(() => {
    if (!analyticsData) return { required: 0, status: "unknown" };
    const s = analyticsData.target_analysis.status;
    if (s === "no_target") return { required: 0, status: "unknown" };
    return { required: analyticsData.target_analysis.required, status: s };
  }, [analyticsData]);

  const gpaSeries = useMemo(
    () =>
      (analyticsData?.chart_data ?? []).map((p) => ({
        semester: p.semester,
        cumulativeGpa: p.cumulative_gpa,
        semesterGpa: p.term_gpa,
      })),
    [analyticsData],
  );

  const roiCourses = useMemo(() => analyticsData?.high_roi_courses ?? [], [analyticsData]);

  // Full current-term roster (credits resolved via the shared fallback) —
  // the simulator dialog simulates the WHOLE term, the card shows the top 2.
  const roiRoster = useMemo(() => {
    const resolveCredits = buildCreditsResolver(completedCourses);
    return currentCourses
      .filter((c) => c.code)
      .map((c) => ({
        code: c.code,
        name: c.nameAr || c.nameEn || c.code,
        credits: resolveCredits(c.creditHours, c.code),
      }));
  }, [completedCourses, currentCourses]);

  // "If you keep doing what you've been doing" baseline for the Target card:
  // the historical average carried over the current term.
  const currentTermCredits = useMemo(() => roiRoster.reduce((s, c) => s + c.credits, 0), [roiRoster]);
  const expectedGpa = useMemo(() => {
    if (currentGpa <= 0) return null;
    const totalHrs = earnedHours + currentTermCredits;
    if (totalHrs <= 0) return currentGpa;
    return (earnedHours * currentGpa + currentTermCredits * currentGpa) / totalHrs;
  }, [currentGpa, earnedHours, currentTermCredits]);

  const agenticAction = analyticsData?.agentic_action;
  const { adherence, overdueTasks, perDay, hasPlan } = usePlanAdherence();
  const [rolloverOpen, setRolloverOpen] = useState(false);
  // Lazy dialogs mount (and fetch their code) the first time they open.
  const [roiOpened, setRoiOpened] = useState(false);
  const [adherenceOpened, setAdherenceOpened] = useState(false);
  const tour = useWelcomeTour();

  const recentCourses = useMemo(
    () =>
      [...completedCourses]
        .filter((c) => !!c.grade)
        .sort((a, b) => extractYearKey(b.semester || "") - extractYearKey(a.semester || ""))
        .slice(0, 10),
    [completedCourses],
  );

  // ── Header bits ──────────────────────────────────────────────────
  const studentFirstName =
    (basic.name || transcriptStudentName || "").split(" ").filter(Boolean)[0] || null;
  const greeting = studentFirstName
    ? `أهلاً بك مجدداً، ${studentFirstName}!`
    : "أهلاً بك مجدداً، يا بطل!";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-24 pb-20 px-4 md:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <h1 className="text-4xl font-black mb-2">لوحة المعلومات</h1>
            <p className="text-muted-foreground font-medium">{greeting}</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-2xl">
              <Flame className="w-5 h-5 text-orange-500 fill-orange-500" />
              <span className="font-black text-orange-500">{streak}</span>
              <span className="text-muted-foreground text-sm font-bold">يوم</span>
            </div>
            <Link href="/profile" prefetch={false}>
              <Button className="rounded-2xl h-11 bg-uqu-accent hover:bg-uqu-accent/90 shadow-lg shadow-uqu-accent/20 gap-2">
                <Settings className="w-4 h-4" />
                الملف الشخصي
              </Button>
            </Link>
          </div>
        </div>

        <EmailVerificationReminder />

        {/* Migration boundary — replaces ALL analytics if the backend
            rejected the payload as schema-incompatible. */}
        {analyticsError?.kind === "migration" ? (
          <MigrationBoundary detail={analyticsError.detail} />
        ) : (
          <>
            {/* Agentic intervention banner — only when the backend's
                self-healing loop fired. Opens the AI decision log. */}
            {agenticAction?.active && (
              <Dialog>
                <DialogTrigger
                  nativeButton={false}
                  render={
                    <div
                      role="button"
                      tabIndex={0}
                      className="block w-full text-right cursor-pointer focus:outline-none"
                    />
                  }
                >
                  <AgenticInterventionBanner action={agenticAction} />
                </DialogTrigger>
                <InterventionDialogContent action={agenticAction} />
              </Dialog>
            )}

            {/* ╔═══ TOP ROW · KPI Cards ═══╗ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <CurrentGpaKpi
                hydrated={hydrated}
                currentGpa={currentGpa}
                earnedHours={earnedHours}
                completedCount={completedCourses.length}
              />
              <EarnedHoursKpi
                hydrated={hydrated}
                earnedHours={earnedHours}
                graduation={graduation}
                recentCourses={recentCourses}
                completedCount={completedCourses.length}
              />
              <TargetGpaKpi
                hydrated={hydrated}
                currentGpa={currentGpa}
                targetGpa={targetGpa}
                expectedGpa={expectedGpa}
                status={requiredNext.status}
                required={requiredNext.required}
                nextHours={nextHours}
              />
            </div>

            {/* ╔═══ MIDDLE ROW · Chart + Calendar ═══╗ */}
            <div className="grid lg:grid-cols-2 gap-6 mb-6">
              <div className="flex flex-col gap-3 min-w-0">
                <CumulativeGpaCard
                  series={gpaSeries}
                  loading={analyticsLoading && !analyticsData}
                  completedCount={completedCourses.length}
                  badgeStatus={requiredNext.status}
                  nextHours={nextHours}
                />
                {analyticsData?.gpa_trend_analysis && (
                  <GpaTrendInsight text={analyticsData.gpa_trend_analysis} />
                )}
              </div>

              <Dialog>
                <DialogTrigger nativeButton={false} render={CARD_TRIGGER}>
                  <AcademicCalendarCard />
                </DialogTrigger>
                <AcademicCalendarDialogContent />
              </Dialog>
            </div>

            {/* ╔═══ BOTTOM ROW · High-ROI + Adherence ═══╗ */}
            <div className="grid lg:grid-cols-2 gap-6">
              <Dialog onOpenChange={(open) => open && setRoiOpened(true)}>
                <DialogTrigger
                  nativeButton={false}
                  render={CARD_TRIGGER}
                >
                  <HighRoiCard
                    courses={roiCourses}
                    loading={analyticsLoading && !analyticsData}
                    hasCurrentTerm={currentCourses.length > 0}
                  />
                </DialogTrigger>
                {roiOpened && (
                  <RoiSimulatorDialog roster={roiRoster} currentGpa={currentGpa} earnedHours={earnedHours} />
                )}
              </Dialog>
              <div className="flex flex-col gap-3 min-w-0 h-full">
                <Dialog onOpenChange={(open) => open && setAdherenceOpened(true)}>
                  <DialogTrigger nativeButton={false} render={CARD_TRIGGER}>
                    <AdherenceCard {...adherence} hasPlan={hasPlan} />
                  </DialogTrigger>
                  {adherenceOpened && (
                    <AdherenceDialogContent
                      {...adherence}
                      hasPlan={hasPlan}
                      perDay={perDay}
                      overdueTasks={overdueTasks}
                      onOpenRollover={() => setRolloverOpen(true)}
                    />
                  )}
                </Dialog>
              </div>
            </div>

            {/* ╔═══ STUDENT TOOLS · Exams + Attendance + Graduation + News ═══╗ */}
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 mt-6">
              <ExamsSummaryCard />
              <AttendanceSummaryCard />
              <GraduationCard />
              <div className="lg:col-span-1">
                <UniversityNewsCard />
              </div>
            </div>

            {/* Soft error footer — non-migration server/network failures. */}
            {analyticsError && (
              <div className="mt-6 p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 text-rose-700 dark:text-rose-200 text-xs flex items-start gap-3">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {analyticsError.kind === "network"
                    ? "تعذّر الاتصال بخادم التحليلات. الأرقام أعلاه قد لا تكون محدّثة — تحقق من اتصال السيرفر."
                    : `تعطّل التحليل: ${analyticsError.detail.slice(0, 200)}`}
                </span>
              </div>
            )}

            {/* Page-scoped rollover modal — opened from the adherence dialog. */}
            <TaskRolloverDialog
              open={rolloverOpen}
              onOpenChange={setRolloverOpen}
              overdue={overdueTasks}
              onAckAll={() => {
                planMarkTasksDone(overdueTasks.map((t) => taskKey(t)));
                setRolloverOpen(false);
              }}
              onGoToPlan={() => {
                setRolloverOpen(false);
                router.push("/plan");
              }}
            />
          </>
        )}
      </main>
      {tour.open && <WelcomeTour open onClose={tour.close} />}
    </div>
  );
}
