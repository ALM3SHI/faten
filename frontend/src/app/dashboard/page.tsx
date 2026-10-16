"use client";

/**
 * «اليوم» — what the student has now, today, and this week, in that order.
 *
 *   • Header        — greeting, date and week of term, focus streak
 *   • One nudge     — the agent's intervention, or missed plan sessions
 *   • التالي        — the one thing in progress or next, with its action
 *   • أقرب اختبار   — countdown to the next exam, whatever comes before it
 *   • اليوم         — today's timeline, every row actionable in place
 *   • أسبوعك        — the «وقتي» week strip, small; a day opens «وقتي» on it
 *   • Status line   — GPA · hours · absences, one tap into «معدّلي»
 *   • Ask Faten     — a question box that opens the chat
 *   • From the UQU  — the next calendar date; calendar and news in a dialog
 *
 * Everything reads the same agenda as «وقتي» (lib/agenda.ts); the GPA
 * analysis lives in «معدّلي».
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flame, History } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { AskFaten } from "@/components/dashboard/ask-faten";
import { StatusStrip } from "@/components/dashboard/status-strip";
import { NextUpCard, TodayTimeline, WeekGlance } from "@/components/dashboard/today-view";
import { NextExam } from "@/components/time/parts";
import { dayKey } from "@/lib/exams";
import { UniversityNewsCard } from "@/components/dashboard/university-news-card";
import { AcademicCalendarCard } from "@/components/dashboard/academic-calendar";
import { PanelTabs } from "@/components/ui/panel-tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmailVerificationReminder } from "@/components/email-verification-reminder";
import { useProfileStore } from "@/store/profileStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { usePlanStore, taskKey } from "@/store/planStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useGraduationProgress } from "@/lib/use-graduation";
import { useHydrated } from "@/lib/use-hydrated";
import { termWeek } from "@/lib/today";
import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import { AgenticInterventionBanner, InterventionDialogContent } from "@/components/dashboard/agentic-intervention";
import { usePlanAdherence } from "@/components/dashboard/adherence";
import { useAttendanceRows } from "@/components/dashboard/use-attendance-rows";
import { TaskRolloverDialog } from "@/components/dashboard/task-rollover-dialog";
import { useWelcomeTour } from "@/components/onboarding/use-welcome-tour";

// Only first-time visitors (or a replay from the profile page) load the tour.
const WelcomeTour = dynamic(() => import("@/components/onboarding/welcome-tour").then((m) => m.WelcomeTour), {
  ssr: false,
});

/** A plain element (not a component) because base-ui clones it with its own props. */
const CARD_TRIGGER = (
  <div role="button" tabIndex={0} className="block w-full text-right cursor-pointer focus:outline-none h-full" />
);

export default function DashboardPage() {
  const router = useRouter();

  const basic = useProfileStore((s) => s.basic);
  const goals = useProfileStore((s) => s.goals);
  const completedCourses = useTranscriptStore((s) => s.completedCourses);
  const currentCourses = useTranscriptStore((s) => s.currentCourses);
  const transcriptGpa = useTranscriptStore((s) => s.gpa);
  const transcriptStudentName = useTranscriptStore((s) => s.name || s.nameEn);
  const planMarkTasksDone = usePlanStore((s) => s.markTasksDone);
  const streak = usePomodoroStore((s) => s.currentStreak);
  const graduation = useGraduationProgress();
  const attendance = useAttendanceRows();

  const currentGpa = transcriptGpa ?? goals.currentGpa ?? 0;
  const targetGpa = goals.targetGpa ?? 0;
  const earnedHours = useMemo(
    () => completedCourses.reduce((sum, c) => sum + (c.creditHours ?? 0), 0),
    [completedCourses],
  );

  // Still fetched here for the agent's intervention banner (the backend's
  // self-healing loop rides on the same analytics call).
  const { analyticsData, analyticsError, hydrated } = useDashboardAnalytics({
    currentGpa,
    targetGpa,
    earnedHours,
    completedCourses,
    currentCourses,
  });
  const agenticAction = analyticsData?.agentic_action;
  const showIntervention = analyticsError?.kind !== "migration" && !!agenticAction?.active;

  const { overdueTasks } = usePlanAdherence();
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const tour = useWelcomeTour();

  const studentFirstName = (basic.name || transcriptStudentName || "").split(" ").filter(Boolean)[0] || null;
  const greeting = studentFirstName ? `أهلاً ${studentFirstName}` : "أهلاً بك";

  const mounted = useHydrated();
  // One "now" per visit, so every block on the page agrees on the time.
  const now = useMemo(() => (mounted ? new Date() : null), [mounted]);
  const week = now ? termWeek(now) : null;
  const dateLine = now
    ? [
        new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" }).format(now),
        week ? `الأسبوع ${week.week} من ${week.term}` : null,
      ]
        .filter(Boolean)
        .join("، ")
    : " ";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto pt-24 pb-24 px-4 md:px-8 max-w-6xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">{greeting}</h1>
            <p className="text-muted-foreground mt-1">{dateLine}</p>
          </div>
          <Link
            href="/pomodoro"
            prefetch={false}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-2xl shrink-0"
            aria-label={`سلسلة التركيز: ${streak} يوم`}
          >
            <Flame className="w-4 h-4 text-orange-500 fill-orange-500" aria-hidden />
            <span className="font-black text-orange-600 dark:text-orange-400 text-sm">{streak}</span>
            <span className="text-muted-foreground text-xs font-bold">يوم</span>
          </Link>
        </header>

        <EmailVerificationReminder />

        {/* One nudge at most: the agent's intervention wins over missed sessions. */}
        {showIntervention && agenticAction ? (
          <Dialog>
            <DialogTrigger nativeButton={false} render={CARD_TRIGGER}>
              <AgenticInterventionBanner action={agenticAction} />
            </DialogTrigger>
            <InterventionDialogContent action={agenticAction} />
          </Dialog>
        ) : (
          mounted &&
          overdueTasks.length > 0 && (
            <div className="flex items-center gap-3 rounded-3xl border border-uqu-accent/20 bg-uqu-accent/[0.06] px-4 py-3">
              <History className="w-5 h-5 text-uqu-accent shrink-0" aria-hidden />
              <p className="flex-1 text-sm leading-6">
                {overdueTasks.length === 1
                  ? `فاتتك جلسة «${overdueTasks[0].title}» من خطة هذا الأسبوع.`
                  : `فاتتك ${overdueTasks.length} جلسات من خطة هذا الأسبوع.`}
              </p>
              <button
                type="button"
                onClick={() => setRolloverOpen(true)}
                className="h-9 px-4 shrink-0 rounded-xl bg-uqu-accent text-white text-sm font-bold hover:bg-uqu-accent/90"
              >
                رتّبها
              </button>
            </div>
          )
        )}

        {!now ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" aria-busy="true">
            <div className="space-y-6">
              <div className="h-48 rounded-3xl bg-foreground/5 animate-pulse" />
              <div className="h-64 rounded-3xl bg-foreground/5 animate-pulse" />
            </div>
            <div className="h-40 rounded-3xl bg-foreground/5 animate-pulse" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
            <div className="space-y-6 min-w-0">
              <NextUpCard now={now} />
              <NextExam today={dayKey(now)} />
              <TodayTimeline now={now} />
            </div>

            <div className="space-y-6 min-w-0">
              <WeekGlance now={now} />
              <section aria-labelledby="status-title" className="space-y-2">
                <h2 id="status-title" className="font-black px-1">وضعي الأكاديمي</h2>
                <StatusStrip
                  hydrated={hydrated}
                  gpa={currentGpa}
                  earned={graduation?.earned ?? earnedHours}
                  planHours={graduation?.planHours ?? null}
                  absence={attendance[0]?.st.level ?? null}
                />
              </section>
              <AskFaten />
              <FromUniversity />
            </div>
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
            router.push("/time");
          }}
        />
      </main>
      {tour.open && <WelcomeTour open onClose={tour.close} />}
    </div>
  );
}

/** The next UQU calendar date; the full calendar and the news open in a dialog. */
function FromUniversity() {
  return (
    <section aria-labelledby="uqu-title" className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 id="uqu-title" className="font-black">من الجامعة</h2>
        <Dialog>
          <DialogTrigger className="text-sm font-bold text-uqu-accent">التقويم والأخبار</DialogTrigger>
          <DialogContent className="sm:max-w-[min(640px,calc(100%-2rem))] max-h-[85vh] overflow-y-auto rounded-[28px]">
            <DialogHeader>
              <DialogTitle>من الجامعة</DialogTitle>
            </DialogHeader>
            <PanelTabs
              label="من الجامعة"
              tabs={[
                { value: "calendar", label: "التقويم", content: <AcademicCalendarCard bare limit={8} /> },
                { value: "news", label: "أخبار الجامعة", content: <UniversityNewsCard bare limit={6} /> },
              ]}
            />
          </DialogContent>
        </Dialog>
      </div>
      <AcademicCalendarCard bare limit={1} />
    </section>
  );
}
