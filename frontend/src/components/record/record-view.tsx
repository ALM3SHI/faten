"use client";

/**
 * «معدّلي» — how am I doing academically, on one screen.
 *
 *   • Numbers     — GPA · hours (with graduation) · target, each opens its dialog
 *   • Next step   — try a grade scenario (/gpa) · the advisor's latest advice
 *   • Analysis    — GPA trend | high-ROI courses | plan adherence
 *   • More        — detailed transcript, simulator, advisor
 *
 * The analysis moved here from the old dashboard unchanged: all analytics
 * math still runs on the backend at POST /api/analytics/dashboard
 * (components/dashboard/use-dashboard-analytics.ts).
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronLeft, Compass, FileText, Calculator, Upload } from "lucide-react";
import { PanelTabs } from "@/components/ui/panel-tabs";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { useProfileStore } from "@/store/profileStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { usePlanStore, taskKey } from "@/store/planStore";
import { buildCreditsResolver, extractYearKey } from "@/lib/transcript-utils";
import { useGraduationProgress } from "@/lib/use-graduation";
import type { TargetCalloutStatus } from "@/components/dashboard/analytics";
import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import { CurrentGpaKpi, EarnedHoursKpi, TargetGpaKpi } from "@/components/dashboard/kpi-cards";
import { AdherenceCard, usePlanAdherence } from "@/components/dashboard/adherence";
import { HighRoiCard } from "@/components/dashboard/high-roi-card";
import { MigrationBoundary } from "@/components/dashboard/migration-boundary";
import { CumulativeGpaCard, GpaTrendInsight } from "@/components/dashboard/cumulative-gpa-card";
import { TaskRolloverDialog } from "@/components/dashboard/task-rollover-dialog";
import { AdvisorTeaser } from "@/components/record/advisor-teaser";

const AdherenceDialogContent = dynamic(
  () => import("@/components/dashboard/adherence-dialog").then((m) => m.AdherenceDialogContent),
  { ssr: false },
);
const RoiSimulatorDialog = dynamic(
  () => import("@/components/dashboard/roi-simulator-dialog").then((m) => m.RoiSimulatorDialog),
  { ssr: false },
);

/** Hours the backend assumes for next term until it answers (backend NEXT_HOURS). */
const DEFAULT_NEXT_HOURS = 15;

const CARD_TRIGGER = (
  <div role="button" tabIndex={0} className="block w-full text-right cursor-pointer focus:outline-none h-full" />
);

const MORE = [
  { href: "/transcript", label: "السجل الأكاديمي التفصيلي", detail: "كل المواد · نقاط القوة والضعف · تحديث السجل", Icon: FileText },
  { href: "/gpa", label: "محاكي المعدل", detail: "جرّب درجات الفصل الحالي وشوف أثرها", Icon: Calculator },
  { href: "/advisor", label: "المرشد الأكاديمي", detail: "الفصل القادم · المسارات · المخاطر · المحاضرون", Icon: Compass },
];

export function RecordView() {
  const router = useRouter();

  const goals = useProfileStore((s) => s.goals);
  const completedCourses = useTranscriptStore((s) => s.completedCourses);
  const currentCourses = useTranscriptStore((s) => s.currentCourses);
  const transcriptGpa = useTranscriptStore((s) => s.gpa);
  const planMarkTasksDone = usePlanStore((s) => s.markTasksDone);
  const graduation = useGraduationProgress();

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

  const currentTermCredits = useMemo(() => roiRoster.reduce((s, c) => s + c.credits, 0), [roiRoster]);
  const expectedGpa = useMemo(() => {
    if (currentGpa <= 0) return null;
    const totalHrs = earnedHours + currentTermCredits;
    if (totalHrs <= 0) return currentGpa;
    return (earnedHours * currentGpa + currentTermCredits * currentGpa) / totalHrs;
  }, [currentGpa, earnedHours, currentTermCredits]);

  const { adherence, overdueTasks, perDay, hasPlan } = usePlanAdherence();
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [roiOpened, setRoiOpened] = useState(false);
  const [adherenceOpened, setAdherenceOpened] = useState(false);

  const recentCourses = useMemo(
    () =>
      [...completedCourses]
        .filter((c) => !!c.grade)
        .sort((a, b) => extractYearKey(b.semester || "") - extractYearKey(a.semester || ""))
        .slice(0, 10),
    [completedCourses],
  );

  const noRecord = hydrated && completedCourses.length === 0 && currentCourses.length === 0;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-heading md:text-title font-bold">معدّلي</h1>
        <p className="text-small text-ink-muted mt-1">معدلك وساعاتك وهدفك، وكيف توصل له.</p>
      </header>

      {noRecord ? (
        <Link
          href="/transcript"
          prefetch={false}
          className="flex items-center gap-4 rounded-card border border-info-line bg-info-soft p-5 hover:bg-info-soft transition-colors"
        >
          <span className="w-11 h-11 rounded-card bg-info-soft text-info-ink flex items-center justify-center shrink-0">
            <Upload className="w-5 h-5" aria-hidden />
          </span>
          <span className="flex-1">
            <span className="block font-bold">ارفع سجلك الأكاديمي</span>
            <span className="block text-small text-ink-muted">PDF من البوابة — نحسب معدلك وساعاتك وكم تحتاج لهدفك.</span>
          </span>
          <ChevronLeft className="w-4 h-4 text-info-ink" aria-hidden />
        </Link>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5">
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

          <Link
            href="/gpa"
            prefetch={false}
            className="flex items-center justify-center gap-2 h-12 rounded-card bg-brand font-semibold text-on-brand motion-fast transition-colors hover:bg-brand-hover focus-ring"
          >
            <Calculator className="w-4 h-4" aria-hidden />
            جرّب سيناريو لدرجات هذا الفصل
          </Link>

          <AdvisorTeaser />

          {analyticsError?.kind === "migration" ? (
            <MigrationBoundary detail={analyticsError.detail} />
          ) : (
            <PanelTabs
              label="تحليل المعدل والدراسة"
              tabs={[
                {
                  value: "trend",
                  label: "تطور المعدل",
                  content: (
                    <div className="space-y-3">
                      <CumulativeGpaCard
                        bare
                        series={gpaSeries}
                        loading={analyticsLoading && !analyticsData}
                        completedCount={completedCourses.length}
                        badgeStatus={requiredNext.status}
                        nextHours={nextHours}
                      />
                      {analyticsData?.gpa_trend_analysis && <GpaTrendInsight text={analyticsData.gpa_trend_analysis} />}
                    </div>
                  ),
                },
                {
                  value: "roi",
                  label: "روافع المعدل",
                  content: (
                    <Dialog onOpenChange={(open) => open && setRoiOpened(true)}>
                      <DialogTrigger nativeButton={false} render={CARD_TRIGGER}>
                        <HighRoiCard
                          bare
                          courses={roiCourses}
                          loading={analyticsLoading && !analyticsData}
                          hasCurrentTerm={currentCourses.length > 0}
                        />
                      </DialogTrigger>
                      {roiOpened && (
                        <RoiSimulatorDialog roster={roiRoster} currentGpa={currentGpa} earnedHours={earnedHours} />
                      )}
                    </Dialog>
                  ),
                },
                {
                  value: "adherence",
                  label: "الانضباط",
                  content: hasPlan ? (
                    <Dialog onOpenChange={(open) => open && setAdherenceOpened(true)}>
                      <DialogTrigger nativeButton={false} render={CARD_TRIGGER}>
                        <AdherenceCard bare {...adherence} hasPlan={hasPlan} />
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
                  ) : (
                    <AdherenceCard bare {...adherence} hasPlan={hasPlan} />
                  ),
                },
              ]}
            />
          )}
        </>
      )}

      <section aria-labelledby="record-more" className="pt-2">
        <h2 id="record-more" className="text-small font-bold text-ink-muted px-1 mb-2">المزيد</h2>
        <ul className="rounded-card border border-line divide-y divide-line overflow-hidden">
          {MORE.map(({ href, label, detail, Icon }) => (
            <li key={href}>
              <Link href={href} prefetch={false} className="group flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken transition-colors">
                <Icon className="w-5 h-5 text-ink-muted shrink-0" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block text-small font-bold">{label}</span>
                  <span className="block text-caption text-ink-muted truncate">{detail}</span>
                </span>
                <ChevronLeft className="w-4 h-4 text-ink-muted group-hover:text-ink" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {analyticsError && analyticsError.kind !== "migration" && (
        <div className="p-4 rounded-card bg-danger-soft border border-danger-line text-danger-ink text-caption flex items-start gap-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {analyticsError.kind === "network"
              ? "تعذّر الاتصال بخادم التحليلات. الأرقام أعلاه قد لا تكون محدّثة — تحقق من اتصال السيرفر."
              : `تعطّل التحليل: ${analyticsError.detail.slice(0, 200)}`}
          </span>
        </div>
      )}

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
    </div>
  );
}
