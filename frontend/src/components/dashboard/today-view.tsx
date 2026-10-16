"use client";

/**
 * The heart of «اليوم»:
 *
 *   • NextUpCard    — the one thing in progress or next, with its action
 *                     (the room / «غبت» for a lecture, «ابدأ» / «تم» for a
 *                     study session, the review plan for an exam).
 *   • TodayTimeline — today in time order; past items fade, every row can
 *                     be acted on in place.
 *   • WeekGlance    — the «وقتي» week strip, small; a day opens «وقتي» on it.
 *
 * All three read the same agenda as «وقتي» (lib/agenda.ts), so the home
 * page and the week never disagree.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, MapPin, Play } from "lucide-react";
import { buildAgenda, formatClock, formatMinutes, nextUp, nextUpWhen, roomHref, weekDates, type AgendaItem } from "@/lib/agenda";
import { EXAM_TYPE_LABELS, dayKey } from "@/lib/exams";
import { courseColors, weekPlan } from "@/lib/plan-week";
import { prayerTimesFor } from "@/lib/prayer-times";
import { cn } from "@/lib/utils";
import { useExamsStore } from "@/store/examsStore";
import { usePlanStore, type PlanTask } from "@/store/planStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useProfileStore } from "@/store/profileStore";
import { useScheduleStore } from "@/store/scheduleStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { LectureAbsence } from "@/components/time/parts";
import { WeekStrip } from "@/components/time/week-view";

const TYPE_LABEL: Record<string, string> = { study: "مذاكرة", exam: "اختبار", quiz: "كويز", assignment: "تسليم", project: "مشروع", other: "موعد" };
const DAY_OFF_INDEX: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/** The agenda input every block here reads. */
function useAgendaInput() {
  const schedule = useScheduleStore((s) => s.schedule);
  const plan = usePlanStore((s) => s.plan);
  const completed = usePlanStore((s) => s.completed);
  const exams = useExamsStore((s) => s.exams);
  return useMemo(() => ({ schedule, tasks: plan?.tasks ?? [], completed, exams }), [schedule, plan, completed, exams]);
}

function useStart() {
  const router = useRouter();
  const startTaskFromPlan = usePomodoroStore((s) => s.startTaskFromPlan);
  return (task: PlanTask, key: string) => {
    startTaskFromPlan(task, key);
    router.push("/pomodoro");
  };
}

// ── «التالي» ────────────────────────────────────────────────────────────

export function NextUpCard({ now }: { now: Date }) {
  const input = useAgendaInput();
  const toggle = usePlanStore((s) => s.toggleTaskDone);
  const start = useStart();
  const next = useMemo(() => nextUp(now, input), [now, input]);
  const today = dayKey(now);

  if (!next) {
    const nothingAtAll = input.schedule.length === 0 && input.tasks.length === 0;
    return (
      <section aria-labelledby="next-title" className="rounded-3xl bg-foreground text-background p-6 md:p-7 space-y-3">
        <h2 id="next-title" className="text-sm font-bold opacity-70">التالي</h2>
        <p className="text-2xl font-black">{nothingAtAll ? "رتّب أسبوعك وخلّ فطن يذكّرك" : "ما فيه شي قدامك هالأسبوع"}</p>
        <p className="opacity-80 leading-7 max-w-lg">
          {nothingAtAll
            ? "ارفع جدولك الدراسي وابنِ خطة مذاكرة، ويصير هنا أول شي عليك: المحاضرة الجاية أو جلسة المذاكرة."
            : "استغلها: ابنِ خطة مذاكرة للأسبوع أو أضف جلسة."}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {input.schedule.length === 0 && (
            <Link href="/schedule" prefetch={false} className="h-11 px-5 rounded-xl bg-background text-foreground font-bold inline-flex items-center">
              ارفع جدولك
            </Link>
          )}
          <Link href="/time" prefetch={false} className="h-11 px-5 rounded-xl border border-background/30 font-bold inline-flex items-center">
            ابنِ خطتك
          </Link>
        </div>
      </section>
    );
  }

  const { item } = next;
  const when = nextUpWhen(next, now);
  let kind = "";
  let title = "";
  let detail = "";
  if (item.kind === "lecture") {
    kind = "محاضرة";
    title = item.slot.course_name || item.slot.course_code;
    detail = [`حتى ${formatMinutes(item.end)}`, item.slot.room ? `قاعة ${item.slot.room}` : null].filter(Boolean).join("، ");
  } else if (item.kind === "task") {
    kind = item.task.targetDate ? TYPE_LABEL[item.task.taskType ?? "other"] ?? "موعد" : "جلسة مذاكرة";
    title = item.task.title;
    detail = [item.task.courseName || item.task.courseCode, item.task.targetDate ? null : `${item.task.durationMinutes} دقيقة`].filter(Boolean).join("، ");
  } else {
    kind = EXAM_TYPE_LABELS[item.exam.exam_type] ?? "اختبار";
    title = item.exam.subject;
    detail = [`${item.exam.duration_minutes} دقيقة`, item.exam.location].filter(Boolean).join("، ");
  }

  return (
    <section aria-labelledby="next-title" className="rounded-3xl bg-foreground text-background p-6 md:p-7 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 id="next-title" className="text-sm font-bold opacity-70">
            التالي: {kind}
          </h2>
          <p className="text-2xl md:text-3xl font-black leading-tight">{title}</p>
          {detail && <p className="opacity-75">{detail}</p>}
        </div>
        <span className={cn("shrink-0 rounded-full px-3 py-1 text-sm font-black", next.now ? "bg-uqu-accent text-white" : "bg-background/15")}>{when}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {item.kind === "lecture" && (
          <>
            <Link href={roomHref(item.slot.room)} prefetch={false} className="h-11 px-4 rounded-xl bg-background text-foreground font-bold inline-flex items-center gap-1.5">
              <MapPin className="w-4 h-4" aria-hidden /> وين القاعة؟
            </Link>
            {next.dayOffset === 0 && (
              <span className="[&_button]:h-11 [&_button]:px-4 [&_button]:text-sm [&_button]:border-background/30 [&_button]:text-background">
                <LectureAbsence code={item.slot.course_code} date={today} today={today} compact />
              </span>
            )}
          </>
        )}
        {item.kind === "task" && !item.task.targetDate && (
          <>
            <button type="button" onClick={() => start(item.task, item.key)} className="h-11 px-5 rounded-xl bg-background text-foreground font-bold inline-flex items-center gap-1.5">
              <Play className="w-4 h-4 fill-current" aria-hidden /> ابدأ الجلسة
            </button>
            <button type="button" onClick={() => toggle(item.key)} className="h-11 px-4 rounded-xl border border-background/30 font-bold inline-flex items-center gap-1.5">
              <Check className="w-4 h-4" aria-hidden /> خلّصتها
            </button>
          </>
        )}
        {item.kind === "exam" && (
          <Link href="/exams" prefetch={false} className="h-11 px-5 rounded-xl bg-background text-foreground font-bold inline-flex items-center">
            خطة المراجعة
          </Link>
        )}
      </div>
    </section>
  );
}

// ── today, in order ─────────────────────────────────────────────────────

export function TodayTimeline({ now }: { now: Date }) {
  const input = useAgendaInput();
  const toggle = usePlanStore((s) => s.toggleTaskDone);
  const start = useStart();
  const items = useMemo(() => buildAgenda(now, { ...input, prayers: prayerTimesFor(now, ["dhuhr", "asr", "maghrib", "isha"]) }), [now, input]);
  const dayOff = useProfileStore((s) => s.preferences.dayOff);
  const isDayOff = DAY_OFF_INDEX[dayOff] === now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = dayKey(now);

  return (
    <section aria-labelledby="today-title" className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 id="today-title" className="font-black">اليوم</h2>
        <Link href="/time" prefetch={false} className="text-sm font-bold text-uqu-accent inline-flex items-center gap-0.5">
          الأسبوع كامل <ChevronLeft className="w-4 h-4" aria-hidden />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-foreground/15 px-5 py-8 text-center text-muted-foreground">
          {isDayOff ? "يوم راحتك — ما فيه شي مجدول. ارتاح." : "ما عندك محاضرات ولا جلسات اليوم."}
        </p>
      ) : (
        <ol className="rounded-3xl border border-foreground/10 divide-y divide-foreground/5 overflow-hidden">
          {items.map((it, i) => (
            <TimelineRow key={`${it.kind}-${it.start}-${i}`} item={it} past={it.end <= nowMin && it.kind !== "prayer"} today={today} onToggle={toggle} onStart={start} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineRow({
  item,
  past,
  today,
  onToggle,
  onStart,
}: {
  item: AgendaItem;
  past: boolean;
  today: string;
  onToggle: (key: string) => void;
  onStart: (task: PlanTask, key: string) => void;
}) {
  if (item.kind === "prayer") {
    return (
      <li className="px-4 py-1.5 text-xs text-muted-foreground text-center bg-foreground/[0.02]">
        {item.name} {formatClock(item.time)}
      </li>
    );
  }
  const time = (
    <span className="w-14 shrink-0 text-sm font-black leading-tight pt-0.5">
      {formatMinutes(item.start).split(" ")[0]}
      <span className="block text-[11px] font-normal text-muted-foreground">{formatMinutes(item.start).split(" ")[1]}</span>
    </span>
  );
  return (
    <li className={cn("flex items-start gap-2 px-4 py-3", past && "opacity-55")}>
      {time}
      <div className="flex-1 min-w-0">
        {item.kind === "lecture" && (
          <div className="space-y-1.5">
            <p className="text-sm leading-6">
              <span className="font-bold">{item.slot.course_name || item.slot.course_code}</span>
              <span className="text-muted-foreground"> محاضرة حتى {formatMinutes(item.end)}{item.slot.room ? `، قاعة ${item.slot.room}` : ""}</span>
            </p>
            <LectureAbsence code={item.slot.course_code} date={today} today={today} compact />
          </div>
        )}
        {item.kind === "exam" && (
          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
            {EXAM_TYPE_LABELS[item.exam.exam_type] ?? "اختبار"} {item.exam.subject}
          </p>
        )}
        {item.kind === "task" && item.task.targetDate && (
          <p className="text-sm">
            <span className="text-muted-foreground font-bold">{TYPE_LABEL[item.task.taskType ?? "other"] ?? "موعد"} </span>
            <span className="font-bold">{item.task.title}</span>
          </p>
        )}
        {item.kind === "task" && !item.task.targetDate && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onToggle(item.key)}
              aria-pressed={item.done}
              aria-label={item.done ? `إلغاء إنجاز ${item.task.title}` : `تم: ${item.task.title}`}
              className={cn(
                "w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center",
                item.done ? "bg-uqu-accent border-uqu-accent text-white" : "border-foreground/25 hover:border-uqu-accent",
              )}
            >
              {item.done && <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden />}
            </button>
            <p className={cn("flex-1 min-w-0 text-sm leading-6", item.done && "line-through text-muted-foreground")}>
              <span className="font-bold">{item.task.title}</span>
              <span className="text-muted-foreground"> {item.task.durationMinutes} د</span>
            </p>
            {!item.done && !past && (
              <button type="button" onClick={() => onStart(item.task, item.key)} className="h-8 px-3 shrink-0 rounded-lg bg-uqu-accent text-white text-xs font-bold inline-flex items-center gap-1">
                <Play className="w-3 h-3 fill-current" aria-hidden /> ابدأ
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ── the week, at a glance ───────────────────────────────────────────────

export function WeekGlance({ now }: { now: Date }) {
  const router = useRouter();
  const input = useAgendaInput();
  const currentCourses = useTranscriptStore((s) => s.currentCourses);
  const dayOff = useProfileStore((s) => s.preferences.dayOff);
  const days = useMemo(() => weekDates(now), [now]);
  const week = useMemo(() => weekPlan(days, input), [days, input]);
  const colors = useMemo(
    () => courseColors([...currentCourses.map((c) => c.code), ...input.tasks.map((t) => t.courseCode), ...input.schedule.map((s) => s.course_code)]),
    [currentCourses, input],
  );
  return (
    <WeekStrip
      compact
      days={days}
      week={week}
      colors={colors}
      selected={-1}
      today={now.getDay()}
      dayOff={DAY_OFF_INDEX[dayOff] ?? -1}
      onSelect={(i) => router.push(`/time?day=${i}`)}
      title="أسبوعك"
    />
  );
}
