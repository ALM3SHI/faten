"use client";

/**
 * «اليوم» — what the student has right now, and nothing else.
 *
 *   • Header        — greeting, date and week of term, focus streak
 *   • One nudge     — the agent's intervention, or missed plan sessions
 *   • Ask Faten     — a question box that opens the chat
 *   • اليوم         — next lecture, next exam, absences, today's plan tasks
 *   • Status strip  — GPA · hours · absences, one tap into «معدّلي»
 *   • University    — calendar | news
 *
 * The GPA analysis (trend, high-ROI courses, adherence, simulators) moved
 * to «معدّلي» (components/record/record-view.tsx); the full agenda lives in
 * «وقتي» (components/time/time-view.tsx).
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flame, History } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { UniversityNewsCard } from "@/components/dashboard/university-news-card";
import { TodayCard } from "@/components/dashboard/today-card";
import { AskFaten } from "@/components/dashboard/ask-faten";
import { StatusStrip } from "@/components/dashboard/status-strip";
import { PanelTabs } from "@/components/ui/panel-tabs";
import { EmailVerificationReminder } from "@/components/email-verification-reminder";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
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
import { AcademicCalendarCard, AcademicCalendarDialogContent } from "@/components/dashboard/academic-calendar";
import { useWelcomeTour } from "@/components/onboarding/use-welcome-tour";

// Only first-time visitors (or a replay from the profile page) load the tour.
const WelcomeTour = dynamic(() => import("@/components/onboarding/welcome-tour").then((m) => m.WelcomeTour), {
  ssr: false,
});

/**
 * Element that turns a whole card into a dialog trigger. A plain element
 * (not a component) because base-ui clones it with its own props.
 */
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

  const studentFirstName =
    (basic.name || transcriptStudentName || "").split(" ").filter(Boolean)[0] || null;
  const greeting = studentFirstName
    ? `أهلاً بك مجدداً، ${studentFirstName}!`
    : "أهلاً بك مجدداً، يا بطل!";

  const mounted = useHydrated();
  const now = mounted ? new Date() : null;
  const week = now ? termWeek(now) : null;
  const dateLine = now
    ? [
        new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" }).format(now),
        week ? `الأسبوع ${week.week} من ${week.term}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : " ";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-24 pb-20 px-4 md:px-8 max-w-6xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-black">{greeting}</h1>
            <p className="text-sm text-muted-foreground mt-1">{dateLine}</p>
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
        </div>

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

        <AskFaten />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
          <section aria-labelledby="today-title" className="space-y-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 id="today-title" className="text-sm font-black text-muted-foreground">اليوم</h2>
              <Link href="/time" prefetch={false} className="text-xs font-bold text-uqu-accent">
                الأسبوع كامل
              </Link>
            </div>
            <TodayCard />
          </section>

          <div className="space-y-5 min-w-0">
            <section aria-labelledby="status-title" className="space-y-2">
              <h2 id="status-title" className="text-sm font-black text-muted-foreground px-1">وضعي الأكاديمي</h2>
              <StatusStrip
                hydrated={hydrated}
                gpa={currentGpa}
                earned={graduation?.earned ?? earnedHours}
                planHours={graduation?.planHours ?? null}
                absence={mounted ? attendance[0]?.st.level ?? null : null}
              />
            </section>

            <PanelTabs
              label="من الجامعة"
              tabs={[
                {
                  value: "calendar",
                  label: "التقويم",
                  content: (
                    <Dialog>
                      <DialogTrigger nativeButton={false} render={CARD_TRIGGER}>
                        <AcademicCalendarCard bare limit={2} />
                      </DialogTrigger>
                      <AcademicCalendarDialogContent />
                    </Dialog>
                  ),
                },
                { value: "news", label: "أخبار الجامعة", content: <UniversityNewsCard bare limit={3} /> },
              ]}
            />
          </div>
        </div>

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
      </main>
      {tour.open && <WelcomeTour open onClose={tour.close} />}
    </div>
  );
}
