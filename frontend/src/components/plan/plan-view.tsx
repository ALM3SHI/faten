"use client";

/**
 * «خطة المذاكرة» — the student's week, told as a story.
 *
 *   • The week strip: one column per day; its height is the day's load —
 *     lectures in grey, then each study session in its course colour,
 *     solid when done and striped while still ahead. Tapping a column
 *     opens that day. This is the page's one bold element.
 *   • The day: lectures, exams and prayer times as quiet context around the
 *     study sessions (tick done · start a focus session · why this session ·
 *     edit · delete) and the dated appointments of that day.
 *   • Beside it: study time per course (a course with no session stands
 *     out), the registered appointments, and how the plan was built
 *     (the AI's overview + the preferences it used, editable here).
 *
 * Generation, editing and conflict checks are the same as before
 * (store/planStore.ts, lib/plan-task-conflicts.ts); only the page changed.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarPlus, Check, ChevronDown, Pencil, Play, Plus, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StudySessionDialog } from "@/components/plan/StudySessionDialog";
import { SmartPreferencesModal } from "@/components/profile/SmartPreferencesModal";
import { strategyLabelAr } from "@/components/profile/preferenceOptions";
import { AR_WEEKDAYS } from "@/lib/academic-term";
import { buildAgenda, formatClock, formatMinutes, weekDates, type AgendaItem } from "@/lib/agenda";
import { dayKey, EXAM_TYPE_LABELS } from "@/lib/exams";
import { validatePlanTaskPlacement } from "@/lib/plan-task-conflicts";
import { courseColors, courseShares, minutesShort, weekPlan } from "@/lib/plan-week";
import { prayerTimesFor } from "@/lib/prayer-times";
import { toast } from "@/lib/toast";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { useExamsStore } from "@/store/examsStore";
import { usePlanStore, taskKey, type GeneratePlanPayload, type PlanTask } from "@/store/planStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useProfileStore } from "@/store/profileStore";
import { useScheduleStore } from "@/store/scheduleStore";
import { useTranscriptStore } from "@/store/transcriptStore";

const SHORT_DAYS = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const DAY_OFF_INDEX: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const PEAK_LABEL: Record<string, string> = { morning: "الصباح", afternoon: "العصر والمساء", night: "الليل" };
const TYPE_LABEL: Record<string, string> = { study: "مذاكرة", exam: "اختبار", quiz: "كويز", assignment: "واجب", project: "مشروع", other: "موعد" };
const PRIORITY_LABEL: Record<string, string> = { high: "أولوية عالية", medium: "", low: "خفيفة" };
const BUILD_STEPS = ["أقرأ جدولك ومواد الفصل…", "أبحث عن الفراغات بين محاضراتك…", "أوزّع الجلسات على وقت نشاطك…", "أتأكد إن ما فيه تعارض…"];

/** Stripes mark study still ahead, so "done" never depends on colour alone. */
const AHEAD = "repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0 3px, transparent 3px 7px)";

export function PlanView() {
  const mounted = useHydrated();
  if (!mounted) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="h-10 w-48 rounded-xl bg-foreground/5 animate-pulse" />
        <div className="h-52 rounded-3xl bg-foreground/5 animate-pulse" />
        <div className="h-72 rounded-3xl bg-foreground/5 animate-pulse" />
      </div>
    );
  }
  return <PlanReady />;
}

function PlanReady() {
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => weekDates(now), [now]);
  const [selected, setSelected] = useState(now.getDay());

  // ── stores ──────────────────────────────────────────────────────────
  const currentCourses = useTranscriptStore((s) => s.currentCourses);
  const hasGradedRecord = useTranscriptStore((s) => s.completedCourses.length > 0);
  const studentName = useTranscriptStore((s) => s.name || s.nameEn);
  const schedule = useScheduleStore((s) => s.schedule);
  const exams = useExamsStore((s) => s.exams);
  const basic = useProfileStore((s) => s.basic);
  const goals = useProfileStore((s) => s.goals);
  const preferences = useProfileStore((s) => s.preferences);
  const setPreferences = useProfileStore((s) => s.setPreferences);
  const plan = usePlanStore((s) => s.plan);
  const generatedAt = usePlanStore((s) => s.generatedAt);
  const isGenerating = usePlanStore((s) => s.isGenerating);
  const error = usePlanStore((s) => s.error);
  const completed = usePlanStore((s) => s.completed);
  const generatePlan = usePlanStore((s) => s.generatePlan);
  const toggleTaskDone = usePlanStore((s) => s.toggleTaskDone);
  const addTask = usePlanStore((s) => s.addTask);
  const updateTask = usePlanStore((s) => s.updateTask);
  const removeTask = usePlanStore((s) => s.removeTask);
  const clearError = usePlanStore((s) => s.clearError);
  const startTaskFromPlan = usePomodoroStore((s) => s.startTaskFromPlan);

  // ── dialogs ─────────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; task?: PlanTask; key?: string; prefill?: { courseCode?: string; suggestedDay?: string } } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; title: string } | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  // ── derived ─────────────────────────────────────────────────────────
  const tasks = useMemo(() => plan?.tasks ?? [], [plan]);
  const input = useMemo(() => ({ schedule, tasks, completed, exams }), [schedule, tasks, completed, exams]);
  const week = useMemo(() => weekPlan(days, input), [days, input]);
  const colors = useMemo(
    () => courseColors([...currentCourses.map((c) => c.code), ...tasks.map((t) => t.courseCode), ...schedule.map((s) => s.course_code)]),
    [currentCourses, tasks, schedule],
  );
  const courses = useMemo(() => currentCourses.map((c) => ({ code: c.code, name: c.nameAr || c.nameEn || c.code })), [currentCourses]);
  const shares = useMemo(() => courseShares(courses, tasks, completed), [courses, tasks, completed]);
  const appointments = useMemo(
    () => tasks.filter((t) => !!t.targetDate).sort((a, b) => (a.targetDate! + a.suggestedTime).localeCompare(b.targetDate! + b.suggestedTime)),
    [tasks],
  );

  const date = days[selected];
  const dayItems = useMemo(
    () => buildAgenda(date, { ...input, prayers: prayerTimesFor(date, ["dhuhr", "asr", "maghrib", "isha"]) }),
    [date, input],
  );

  const totals = week.reduce(
    (acc, d) => ({
      sessions: acc.sessions + d.load.sessions.length,
      done: acc.done + d.load.sessions.filter((s) => s.done).length,
      min: acc.min + d.load.studyMin,
      doneMin: acc.doneMin + d.load.doneMin,
    }),
    { sessions: 0, done: 0, min: 0, doneMin: 0 },
  );

  // ── actions ─────────────────────────────────────────────────────────
  const build = async () => {
    setConfirmRebuild(false);
    const payload: GeneratePlanPayload = {
      courses: currentCourses.map((c) => ({
        code: c.code,
        name: c.nameAr || c.nameEn || c.code,
        creditHours: c.creditHours || 3,
        difficulty: c.difficulty ?? null,
      })),
      schedule: schedule.map((s) => ({
        day: String(s.day),
        start_time: s.start_time,
        end_time: s.end_time,
        course_code: s.course_code || null,
        course_name: s.course_name || null,
        type: typeof s.type === "string" ? s.type : null,
      })),
      preferences: {
        learningStyle: preferences.learningStyle,
        energyPeak: preferences.energyPeak,
        taskStrategy: preferences.taskStrategy,
        pomodoroFocus: preferences.pomodoroFocus,
        pomodoroShortBreak: preferences.pomodoroShortBreak,
        pomodoroLongBreak: preferences.pomodoroLongBreak,
        dayOff: preferences.dayOff,
      },
      studentName: studentName || basic.name || null,
      currentGpa: goals.currentGpa || null,
      targetGpa: goals.targetGpa || null,
    };
    await generatePlan(payload);
    if (!usePlanStore.getState().error) toast.success("جهزت خطة الأسبوع");
  };

  const submit = (task: PlanTask) => {
    if (!dialog) return;
    const err = validatePlanTaskPlacement({
      task,
      lectures: schedule,
      existingTasks: tasks,
      excludeTaskKey: dialog.mode === "edit" ? dialog.key : undefined,
    });
    if (err) {
      toast.error(err);
      return;
    }
    if (dialog.mode === "add") {
      addTask(task);
      toast.success(task.targetDate ? "سجّلت الموعد" : "أضفت الجلسة");
    } else if (dialog.key) {
      updateTask(dialog.key, task);
      toast.success("حدّثت الجلسة");
    }
    setDialog(null);
  };

  const start = (task: PlanTask, key: string) => {
    startTaskFromPlan(task, key);
    router.push("/pomodoro");
  };

  const edit = (task: PlanTask) => setDialog({ mode: "edit", task, key: taskKey(task) });
  const askDelete = (task: PlanTask) => setDeleteTarget({ key: taskKey(task), title: task.title });

  // ── no courses: nothing to plan yet ─────────────────────────────────
  if (currentCourses.length === 0) {
    return (
      <div className="space-y-6">
        <PageTitle />
        <section className="rounded-3xl border border-foreground/10 p-6 md:p-8 max-w-2xl space-y-3">
          <h2 className="text-xl font-black">{hasGradedRecord ? "ما فيه مواد مسجّلة في سجلك الحين" : "نحتاج مواد فصلك أول"}</h2>
          <p className="text-muted-foreground leading-7">
            {hasGradedRecord
              ? "سجلك المرفوع مرصود بالكامل (بين فصلين أو بعد التخرج). بعد ما تسجّل مواد الفصل الجديد ارفع السجل مرة ثانية ونبني لك الخطة."
              : "ارفع سجلك الأكاديمي من الملف الشخصي. منه نعرف مواد الفصل ونوزّع عليها جلسات المراجعة."}
          </p>
          <Link href="/profile" prefetch={false} className="inline-flex items-center h-11 px-5 rounded-xl bg-uqu-accent text-white font-bold hover:bg-uqu-accent/90">
            ارفع السجل
          </Link>
        </section>
      </div>
    );
  }

  const dayOffIdx = DAY_OFF_INDEX[preferences.dayOff] ?? -1;

  return (
    <div className="space-y-6">
      {/* ── title and the week in one sentence ─────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <PageTitle />
          {/* Before the first plan the build panel explains the page; no need to say it twice. */}
          {plan && (
            <p className="text-muted-foreground mt-1 leading-7">
              {totals.sessions > 0 ? (
                <>
                  أنجزت <b className="text-foreground">{totals.done}</b> من <b className="text-foreground">{totals.sessions}</b> جلسات هذا الأسبوع،{" "}
                  {minutesShort(totals.doneMin)} من {minutesShort(totals.min)} مذاكرة.
                </>
              ) : (
                "ما فيه جلسات هذا الأسبوع. أضف جلسة أو أعد بناء الأسبوع."
              )}
            </p>
          )}
        </div>
        {plan && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDialog({ mode: "add", prefill: { suggestedDay: AR_WEEKDAYS[selected] } })}
              className="h-11 px-4 rounded-xl bg-foreground text-background font-bold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" aria-hidden />
              إضافة جلسة
            </button>
            <button
              type="button"
              onClick={() => setConfirmRebuild(true)}
              disabled={isGenerating}
              className="h-11 px-4 rounded-xl border border-foreground/15 font-bold inline-flex items-center gap-1.5 hover:bg-foreground/5 disabled:opacity-60"
            >
              <RefreshCw className={cn("w-4 h-4", isGenerating && "motion-safe:animate-spin")} aria-hidden />
              أعد بناء الأسبوع
            </button>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
          <p className="flex-1 leading-6">{error}</p>
          <button type="button" onClick={clearError} className="text-xs font-bold shrink-0 hover:underline">
            إخفاء
          </button>
        </div>
      )}

      {isGenerating ? (
        <Building />
      ) : (
        !plan && (
          <BuildPanel
            courseCount={currentCourses.length}
            hasSchedule={schedule.length > 0}
            peak={PEAK_LABEL[preferences.energyPeak] ?? preferences.energyPeak}
            focus={preferences.pomodoroFocus}
            dayOff={dayOffIdx >= 0 ? AR_WEEKDAYS[dayOffIdx] : null}
            onEditPrefs={() => setPrefsOpen(true)}
            onBuild={build}
          />
        )
      )}

      {/* ── the week strip ─────────────────────────────────────────── */}
      <WeekStrip
        days={days}
        week={week}
        colors={colors}
        selected={selected}
        today={now.getDay()}
        dayOff={dayOffIdx}
        onSelect={setSelected}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <DayView
          date={date}
          isToday={dayKey(date) === dayKey(now)}
          isDayOff={selected === dayOffIdx}
          summary={plan?.dailySummary?.find((d) => d.day?.includes(AR_WEEKDAYS[selected]))?.summary}
          items={dayItems}
          colors={colors}
          hasPlan={!!plan}
          onToggle={toggleTaskDone}
          onStart={start}
          onEdit={edit}
          onDelete={askDelete}
          onAdd={() => setDialog({ mode: "add", prefill: { suggestedDay: AR_WEEKDAYS[selected] } })}
        />

        <div className="space-y-6 min-w-0">
          {plan && (
            <CourseBalance
              shares={shares}
              colors={colors}
              onAdd={(code) => setDialog({ mode: "add", prefill: { courseCode: code } })}
            />
          )}
          <Appointments
            items={appointments}
            today={dayKey(now)}
            onAdd={() => setDialog({ mode: "add" })}
            onEdit={edit}
            onDelete={askDelete}
          />
          {plan && (
            <AboutPlan
              overview={plan.overview}
              generatedAt={generatedAt}
              peak={PEAK_LABEL[preferences.energyPeak] ?? preferences.energyPeak}
              strategy={strategyLabelAr(preferences.taskStrategy)}
              focus={preferences.pomodoroFocus}
              dayOff={dayOffIdx >= 0 ? AR_WEEKDAYS[dayOffIdx] : "بدون"}
              onEditPrefs={() => setPrefsOpen(true)}
            />
          )}
        </div>
      </div>

      <StudySessionDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        mode={dialog?.mode ?? "add"}
        initialTask={dialog?.task}
        prefill={dialog?.prefill}
        courses={currentCourses}
        onSubmit={submit}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف الجلسة"
        description={deleteTarget ? `تحذف «${deleteTarget.title}» من خطتك؟ ما تقدر تتراجع.` : ""}
        confirmLabel="حذف"
        destructive
        onConfirm={() => {
          if (!deleteTarget) return;
          removeTask(deleteTarget.key);
          toast.success("حذفت الجلسة");
          setDeleteTarget(null);
        }}
      />
      <ConfirmDialog
        open={confirmRebuild}
        onOpenChange={setConfirmRebuild}
        title="أعد بناء الأسبوع"
        description="نوزّع الجلسات من جديد: اللي ما خلصتها نعيد جدولتها، ومواعيدك المسجّلة تبقى كما هي. علامات الإنجاز على الجلسات الحالية تنمسح."
        confirmLabel="أعد البناء"
        onConfirm={() => void build()}
      />
      <SmartPreferencesModal
        isOpen={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        preferences={preferences}
        onPreferencesChange={setPreferences}
      />
    </div>
  );
}

function PageTitle() {
  return <h1 className="text-3xl md:text-4xl font-black tracking-tight">خطة المذاكرة</h1>;
}

// ═══════════════════════════════════════════════════════════════════════
//  The week strip
// ═══════════════════════════════════════════════════════════════════════

function WeekStrip({
  days,
  week,
  colors,
  selected,
  today,
  dayOff,
  onSelect,
}: {
  days: Date[];
  week: ReturnType<typeof weekPlan>;
  colors: Record<string, string>;
  selected: number;
  today: number;
  dayOff: number;
  onSelect: (i: number) => void;
}) {
  // One scale for the whole week, so the columns compare honestly.
  const scale = Math.max(180, ...week.map((d) => d.load.lectureMin + d.load.studyMin));
  const monthLabel = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "long" }).format(days[6]);

  return (
    <section aria-labelledby="week-strip-title" className="rounded-3xl border border-foreground/10 p-4 md:p-6">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 id="week-strip-title" className="font-black">
          أسبوعك {days[0].getDate()}–{days[6].getDate()} {monthLabel}
        </h2>
        <Legend />
      </div>
      <div role="tablist" aria-label="أيام الأسبوع" className="grid grid-cols-7 gap-1.5 md:gap-3">
        {days.map((d, i) => {
          const { lectureMin, sessions, studyMin, doneMin } = week[i].load;
          const on = i === selected;
          const isToday = i === today;
          const label = [
            `${AR_WEEKDAYS[i]} ${d.getDate()}`,
            isToday ? "اليوم" : null,
            i === dayOff ? "يوم راحتك" : null,
            lectureMin ? `محاضرات ${minutesShort(lectureMin)}` : null,
            studyMin ? `مذاكرة ${minutesShort(studyMin)}، أنجزت ${minutesShort(doneMin)}` : "بدون مذاكرة",
          ]
            .filter(Boolean)
            .join("، ");
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={label}
              onClick={() => onSelect(i)}
              className={cn(
                "group flex flex-col items-stretch gap-2 rounded-2xl p-1.5 md:p-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-uqu-accent/60",
                on ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]",
              )}
            >
              <span className={cn("text-[11px] md:text-xs font-bold text-center h-4", studyMin ? "text-foreground" : "text-muted-foreground")}>
                {studyMin ? minutesShort(studyMin) : i === dayOff ? "راحة" : ""}
              </span>
              <span className="relative h-28 md:h-36 flex flex-col-reverse rounded-xl bg-foreground/[0.04] overflow-hidden" aria-hidden>
                {lectureMin > 0 && <span className="block bg-foreground/20" style={{ height: `${(lectureMin / scale) * 100}%` }} />}
                {sessions.map((s) => (
                  <span
                    key={s.key}
                    className="block border-t border-background/60 motion-safe:transition-[height] motion-safe:duration-500"
                    style={{
                      height: `${(s.min / scale) * 100}%`,
                      backgroundColor: colors[s.code] ?? "#6d5ae6",
                      backgroundImage: s.done ? undefined : AHEAD,
                      opacity: s.done ? 1 : 0.55,
                    }}
                  />
                ))}
              </span>
              <span className="flex flex-col items-center leading-tight">
                <span className={cn("text-[11px] md:text-xs", on ? "font-bold" : "text-muted-foreground")}>{SHORT_DAYS[i]}</span>
                <span className={cn("text-base md:text-lg font-black", isToday && "text-uqu-accent")}>{d.getDate()}</span>
                <span className={cn("w-1 h-1 rounded-full", isToday ? "bg-uqu-accent" : "bg-transparent")} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <ul className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-foreground/20" aria-hidden /> محاضرات
      </li>
      <li className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-uqu-accent" aria-hidden /> مذاكرة أنجزتها
      </li>
      <li className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-uqu-accent opacity-55" style={{ backgroundImage: AHEAD }} aria-hidden /> باقية
      </li>
    </ul>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  The day
// ═══════════════════════════════════════════════════════════════════════

function DayView({
  date,
  isToday,
  isDayOff,
  summary,
  items,
  colors,
  hasPlan,
  onToggle,
  onStart,
  onEdit,
  onDelete,
  onAdd,
}: {
  date: Date;
  isToday: boolean;
  isDayOff: boolean;
  summary?: string;
  items: AgendaItem[];
  colors: Record<string, string>;
  hasPlan: boolean;
  onToggle: (key: string) => void;
  onStart: (task: PlanTask, key: string) => void;
  onEdit: (task: PlanTask) => void;
  onDelete: (task: PlanTask) => void;
  onAdd: () => void;
}) {
  const title = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" }).format(date);
  const studyCount = items.filter((i) => i.kind === "task" && !i.task.targetDate).length;

  return (
    <section aria-labelledby="day-title" className="space-y-4 min-w-0">
      <div>
        <h2 id="day-title" className="text-xl font-black">
          {title}
          {isToday && <span className="ms-2 align-middle text-xs font-bold px-2 py-0.5 rounded-full bg-uqu-accent/15 text-uqu-accent">اليوم</span>}
        </h2>
        {summary && <p className="text-sm text-muted-foreground leading-7 mt-1">{summary}</p>}
      </div>

      {items.length === 0 ? (
        <EmptyDay isDayOff={isDayOff} hasPlan={hasPlan} onAdd={onAdd} />
      ) : (
        <ol className="space-y-2.5">
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.start}-${i}`}>
              <DayItem item={it} colors={colors} onToggle={onToggle} onStart={onStart} onEdit={onEdit} onDelete={onDelete} />
            </li>
          ))}
        </ol>
      )}

      {items.length > 0 && studyCount === 0 && hasPlan && !isDayOff && (
        <button type="button" onClick={onAdd} className="text-sm font-bold text-uqu-accent inline-flex items-center gap-1">
          <Plus className="w-4 h-4" aria-hidden /> أضف جلسة لهذا اليوم
        </button>
      )}
    </section>
  );
}

function EmptyDay({ isDayOff, hasPlan, onAdd }: { isDayOff: boolean; hasPlan: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-foreground/15 px-6 py-10 text-center space-y-3">
      <p className="font-bold">{isDayOff ? "يوم راحتك — ما فيه شي مجدول." : "يوم فاضي من المحاضرات والمذاكرة."}</p>
      {hasPlan && (
        <button type="button" onClick={onAdd} className="text-sm font-bold text-uqu-accent inline-flex items-center gap-1">
          <Plus className="w-4 h-4" aria-hidden /> أضف جلسة
        </button>
      )}
    </div>
  );
}

function Clock({ start }: { start: number }) {
  const [clock, half] = formatMinutes(start).split(" ");
  return (
    <span className="w-12 shrink-0 text-center leading-tight pt-0.5">
      <span className="block text-sm font-black">{clock}</span>
      <span className="block text-[11px] text-muted-foreground">{half}</span>
    </span>
  );
}

function DayItem({
  item,
  colors,
  onToggle,
  onStart,
  onEdit,
  onDelete,
}: {
  item: AgendaItem;
  colors: Record<string, string>;
  onToggle: (key: string) => void;
  onStart: (task: PlanTask, key: string) => void;
  onEdit: (task: PlanTask) => void;
  onDelete: (task: PlanTask) => void;
}) {
  if (item.kind === "prayer") {
    return (
      <div role="separator" aria-label={`${item.name} ${formatClock(item.time)}`} className="flex items-center gap-3 ps-14 text-xs text-muted-foreground">
        <span className="flex-1 h-px bg-foreground/10" />
        {item.name} {formatClock(item.time)}
        <span className="flex-1 h-px bg-foreground/10" />
      </div>
    );
  }
  if (item.kind === "lecture") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock start={item.start} />
        <span className="flex-1 min-w-0 truncate rounded-xl bg-foreground/[0.04] px-3 py-2">
          محاضرة <span className="text-foreground font-semibold">{item.slot.course_name || item.slot.course_code}</span> حتى {formatMinutes(item.end)}
          {item.slot.room ? `، قاعة ${item.slot.room}` : ""}
        </span>
      </div>
    );
  }
  if (item.kind === "exam") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Clock start={item.start} />
        <span className="flex-1 min-w-0 truncate rounded-xl bg-amber-500/10 text-amber-900 dark:text-amber-200 px-3 py-2 font-semibold">
          {EXAM_TYPE_LABELS[item.exam.exam_type] ?? "اختبار"} {item.exam.subject}
        </span>
      </div>
    );
  }
  if (item.task.targetDate) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Clock start={item.start} />
        <span className="flex-1 min-w-0 flex items-center gap-2 rounded-xl border border-foreground/10 px-3 py-2">
          <span className="text-xs font-bold text-muted-foreground shrink-0">{TYPE_LABEL[item.task.taskType ?? "other"] ?? "موعد"}</span>
          <span className="font-semibold truncate">{item.task.title}</span>
        </span>
      </div>
    );
  }
  return <SessionCard task={item.task} taskKey={item.key} done={item.done} start={item.start} end={item.end} color={colors[item.task.courseCode] ?? "#6d5ae6"} onToggle={onToggle} onStart={onStart} onEdit={onEdit} onDelete={onDelete} />;
}

function SessionCard({
  task,
  taskKey: key,
  done,
  start,
  end,
  color,
  onToggle,
  onStart,
  onEdit,
  onDelete,
}: {
  task: PlanTask;
  taskKey: string;
  done: boolean;
  start: number;
  end: number;
  color: string;
  onToggle: (key: string) => void;
  onStart: (task: PlanTask, key: string) => void;
  onEdit: (task: PlanTask) => void;
  onDelete: (task: PlanTask) => void;
}) {
  const [why, setWhy] = useState(false);
  const priority = PRIORITY_LABEL[task.priority];
  return (
    <div className="flex gap-2">
      <Clock start={start} />
      <article className={cn("flex-1 min-w-0 rounded-2xl border p-4 space-y-3 transition-colors", done ? "border-foreground/10 bg-foreground/[0.02]" : "border-foreground/15 bg-card")}>
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => onToggle(key)}
            aria-pressed={done}
            aria-label={done ? `إلغاء إنجاز ${task.title}` : `تم: ${task.title}`}
            className="mt-0.5 w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors"
            style={{ borderColor: color, backgroundColor: done ? color : "transparent" }}
          >
            {done && <Check className="w-4 h-4 text-white" strokeWidth={3} aria-hidden />}
          </button>
          <div className="flex-1 min-w-0">
            <h3 className={cn("font-bold leading-6", done && "line-through text-muted-foreground")}>{task.title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden />
                {task.courseName || task.courseCode}
              </span>
              <span>
                {task.durationMinutes} دقيقة، حتى {formatMinutes(end)}
              </span>
              {priority && <span className={task.priority === "high" ? "font-bold text-rose-700 dark:text-rose-300" : ""}>{priority}</span>}
            </p>
          </div>
          {!done && (
            <button
              type="button"
              onClick={() => onStart(task, key)}
              className="h-9 px-3 shrink-0 rounded-xl text-white text-sm font-bold inline-flex items-center gap-1.5"
              style={{ backgroundColor: color }}
            >
              <Play className="w-3.5 h-3.5 fill-current" aria-hidden />
              ابدأ
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 ps-10">
          {task.reason ? (
            <button type="button" onClick={() => setWhy((w) => !w)} aria-expanded={why} className="text-xs font-bold text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              ليش هذي الجلسة؟
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", why && "rotate-180")} aria-hidden />
            </button>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => onEdit(task)} aria-label={`تعديل ${task.title}`} className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 inline-flex items-center justify-center">
              <Pencil className="w-4 h-4" aria-hidden />
            </button>
            <button type="button" onClick={() => onDelete(task)} aria-label={`حذف ${task.title}`} className="w-8 h-8 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 inline-flex items-center justify-center">
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          </span>
        </div>
        {why && task.reason && <p className="ps-10 text-sm leading-7 text-muted-foreground">{task.reason}</p>}
      </article>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Beside the day
// ═══════════════════════════════════════════════════════════════════════

function CourseBalance({
  shares,
  colors,
  onAdd,
}: {
  shares: ReturnType<typeof courseShares>;
  colors: Record<string, string>;
  onAdd: (code: string) => void;
}) {
  const max = Math.max(60, ...shares.map((s) => s.plannedMin));
  return (
    <section aria-labelledby="balance-title" className="rounded-3xl border border-foreground/10 p-5 space-y-4">
      <h2 id="balance-title" className="font-black">وقتك على المواد</h2>
      <ul className="space-y-3.5">
        {shares.map((s) => {
          const color = colors[s.code] ?? "#6d5ae6";
          return (
            <li key={s.code} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden />
                  <span className="font-bold truncate">{s.name}</span>
                </span>
                {s.sessions > 0 ? (
                  <span className="text-muted-foreground shrink-0">
                    {minutesShort(s.doneMin)} من {minutesShort(s.plannedMin)}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 shrink-0 text-xs">
                    <span className="text-muted-foreground">بدون جلسات</span>
                    <button type="button" onClick={() => onAdd(s.code)} className="font-bold text-uqu-accent" aria-label={`أضف جلسة لـ ${s.name}`}>
                      أضف جلسة
                    </button>
                  </span>
                )}
              </div>
              {/* planned (faded) under done (solid), both from the start edge */}
              <div className="relative h-2 rounded-full bg-foreground/[0.06] overflow-hidden" aria-hidden>
                <div className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${(s.plannedMin / max) * 100}%`, backgroundColor: color, opacity: 0.35 }} />
                <div className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${(s.doneMin / max) * 100}%`, backgroundColor: color }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Appointments({
  items,
  today,
  onAdd,
  onEdit,
  onDelete,
}: {
  items: PlanTask[];
  today: string;
  onAdd: () => void;
  onEdit: (task: PlanTask) => void;
  onDelete: (task: PlanTask) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const upcoming = items.filter((t) => t.targetDate! >= today);
  const past = items.filter((t) => t.targetDate! < today);
  const list = showPast ? [...past, ...upcoming] : upcoming;
  const fmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" });

  return (
    <section aria-labelledby="appointments-title" className="rounded-3xl border border-foreground/10 p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="appointments-title" className="font-black">مواعيدك المسجّلة</h2>
        <button type="button" onClick={onAdd} className="text-sm font-bold text-uqu-accent inline-flex items-center gap-1">
          <CalendarPlus className="w-4 h-4" aria-hidden /> سجّل موعد
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground leading-6">سجّل اختبار أو تسليم بتاريخه، ويظهر في يومه هنا وفي «وقتي».</p>
      ) : (
        <ul className="divide-y divide-foreground/5">
          {list.map((t) => {
            const isPast = t.targetDate! < today;
            const [y, m, d] = t.targetDate!.split("-").map(Number);
            return (
              <li key={taskKey(t)} className={cn("flex items-center gap-3 py-2.5", isPast && "opacity-60")}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">
                    <span className="text-muted-foreground font-semibold me-1.5">{TYPE_LABEL[t.taskType ?? "other"] ?? "موعد"}</span>
                    {t.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmt.format(new Date(y, m - 1, d))}، {formatClock(t.suggestedTime)}
                  </div>
                </div>
                <button type="button" onClick={() => onEdit(t)} aria-label={`تعديل ${t.title}`} className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 inline-flex items-center justify-center">
                  <Pencil className="w-4 h-4" aria-hidden />
                </button>
                <button type="button" onClick={() => onDelete(t)} aria-label={`حذف ${t.title}`} className="w-8 h-8 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 inline-flex items-center justify-center">
                  <Trash2 className="w-4 h-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {past.length > 0 && (
        <button type="button" onClick={() => setShowPast((v) => !v)} className="text-xs font-bold text-muted-foreground hover:text-foreground">
          {showPast ? "أخفِ المواعيد السابقة" : `اعرض المواعيد السابقة (${past.length})`}
        </button>
      )}
    </section>
  );
}

function AboutPlan({
  overview,
  generatedAt,
  peak,
  strategy,
  focus,
  dayOff,
  onEditPrefs,
}: {
  overview: string;
  generatedAt: string | null;
  peak: string;
  strategy: string;
  focus: number;
  dayOff: string;
  onEditPrefs: () => void;
}) {
  const built = generatedAt
    ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" }).format(new Date(generatedAt))
    : null;
  return (
    <section aria-labelledby="about-title" className="rounded-3xl bg-foreground/[0.03] p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="about-title" className="font-black">كيف انبنت الخطة</h2>
        <button type="button" onClick={onEditPrefs} className="text-sm font-bold text-uqu-accent inline-flex items-center gap-1">
          <SlidersHorizontal className="w-4 h-4" aria-hidden /> تفضيلاتك
        </button>
      </div>
      {overview && <p className="text-sm leading-7">{overview}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">وقت نشاطك</dt>
          <dd className="font-bold">{peak}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">طريقة الترتيب</dt>
          <dd className="font-bold">{strategy}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">مدة التركيز</dt>
          <dd className="font-bold">{focus} دقيقة</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">يوم الراحة</dt>
          <dd className="font-bold">{dayOff}</dd>
        </div>
      </dl>
      {built && <p className="text-xs text-muted-foreground">بنيتها {built}. لو غيّرت تفضيلاتك، أعد بناء الأسبوع عشان تنطبق.</p>}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Before the first plan, and while building
// ═══════════════════════════════════════════════════════════════════════

function BuildPanel({
  courseCount,
  hasSchedule,
  peak,
  focus,
  dayOff,
  onEditPrefs,
  onBuild,
}: {
  courseCount: number;
  hasSchedule: boolean;
  peak: string;
  focus: number;
  dayOff: string | null;
  onEditPrefs: () => void;
  onBuild: () => void;
}) {
  return (
    <section aria-labelledby="build-title" className="rounded-3xl bg-foreground text-background p-6 md:p-8 space-y-5">
      <div className="space-y-1.5 max-w-xl">
        <h2 id="build-title" className="text-2xl font-black">ابنِ أسبوعك</h2>
        <p className="opacity-80 leading-7">نوزّع جلسات مراجعة على فراغات جدولك في وقت نشاطك، ونبعد عن محاضراتك ويوم راحتك.</p>
      </div>
      <ul className="space-y-2 text-sm">
        <Check3 ok text={`${courseCount} ${courseCount === 1 ? "مادة" : courseCount <= 10 ? "مواد" : "مادة"} من سجلك هذا الفصل`} />
        <Check3
          ok={hasSchedule}
          text={hasSchedule ? "جدول محاضراتك" : "جدول المحاضرات غير مرفوع — الخطة تنفع بدونه، بس أدق معه"}
          action={!hasSchedule ? { href: "/schedule", label: "ارفعه" } : undefined}
        />
        <li className="flex items-center gap-2.5">
          <Check className="w-4 h-4 shrink-0" aria-hidden />
          <span>
            نشاطك {peak}، جلسات {focus} دقيقة{dayOff ? `، وراحتك يوم ${dayOff}` : ""}
          </span>
          <button type="button" onClick={onEditPrefs} className="font-bold underline underline-offset-4 decoration-background/40">
            غيّرها
          </button>
        </li>
      </ul>
      <button type="button" onClick={onBuild} className="h-12 px-6 rounded-2xl bg-background text-foreground font-black hover:opacity-90">
        ابنِ خطة الأسبوع
      </button>
    </section>
  );
}

function Check3({ ok, text, action }: { ok: boolean; text: string; action?: { href: string; label: string } }) {
  return (
    <li className="flex items-center gap-2.5">
      {ok ? <Check className="w-4 h-4 shrink-0" aria-hidden /> : <span className="w-4 h-4 shrink-0 rounded-full border-2 border-background/50" aria-hidden />}
      <span className={ok ? "" : "opacity-80"}>{text}</span>
      {action && (
        <Link href={action.href} prefetch={false} className="font-bold underline underline-offset-4 decoration-background/40">
          {action.label}
        </Link>
      )}
    </li>
  );
}

function Building() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setStep((i) => Math.min(BUILD_STEPS.length - 1, i + 1)), 5000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <section aria-busy="true" className="rounded-3xl bg-foreground text-background p-6 md:p-8 space-y-4">
      <h2 className="text-2xl font-black">أبني أسبوعك</h2>
      <ol className="space-y-2 text-sm">
        {BUILD_STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2.5 transition-opacity", i > step && "opacity-35")}>
            {i < step ? (
              <Check className="w-4 h-4 shrink-0" aria-hidden />
            ) : (
              <span className={cn("w-4 h-4 shrink-0 rounded-full border-2 border-background/60", i === step && "motion-safe:animate-pulse bg-background/40")} aria-hidden />
            )}
            <span aria-live={i === step ? "polite" : undefined}>{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs opacity-70">قد تاخذ حتى دقيقة.</p>
    </section>
  );
}
