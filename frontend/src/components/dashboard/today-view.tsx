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
import { Button, IconButton, buttonClass } from "@/components/ds/button";
import { EmptyState } from "@/components/ds/states";
import { RestDayArt } from "@/components/sketch/notebook-art";
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
      <section aria-labelledby="next-title" className="rounded-card bg-brand p-5 text-on-brand shadow-card md:p-7 space-y-3">
        <h2 id="next-title" className="text-small font-semibold text-white/85">التالي</h2>
        <p className="font-heading text-title font-bold">{nothingAtAll ? "رتّب أسبوعك وخلّ فطن يذكّرك" : "ما فيه شي قدامك هالأسبوع"}</p>
        <p className="max-w-lg text-body text-white/90">
          {nothingAtAll
            ? "ارفع جدولك الدراسي وابنِ خطة مذاكرة، ويصير هنا أول شي عليك: المحاضرة الجاية أو جلسة المذاكرة."
            : "استغلها: ابنِ خطة مذاكرة للأسبوع أو أضف جلسة."}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {input.schedule.length === 0 && (
            <Link href="/schedule" prefetch={false} className={buttonClass({ className: "border-transparent bg-white text-brand hover:bg-white/90" })}>
              ارفع جدولك
            </Link>
          )}
          <Link href="/time" prefetch={false} className={buttonClass({ className: "border-white/40 bg-transparent text-white hover:bg-white/10" })}>
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
    <section aria-labelledby="next-title" className="rounded-card bg-brand p-5 text-on-brand shadow-card md:p-7 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 id="next-title" className="text-small font-semibold text-white/85">
            التالي: {kind}
          </h2>
          <p className="font-heading text-title font-bold text-balance">{title}</p>
          {detail && <p className="text-body text-white/90">{detail}</p>}
        </div>
        <span className={cn("nums shrink-0 rounded-full px-3 py-1 text-small font-semibold", next.now ? "bg-white text-brand" : "bg-white/15 text-white")}>{when}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {item.kind === "lecture" && (
          <>
            <Link href={roomHref(item.slot.room)} prefetch={false} className={buttonClass({ className: "border-transparent bg-white text-brand hover:bg-white/90" })}>
              <MapPin aria-hidden /> وين القاعة؟
            </Link>
            {next.dayOffset === 0 && (
              <span className="[&_button]:h-11 [&_button]:border-white/40 [&_button]:bg-transparent [&_button]:px-4 [&_button]:text-white [&_button]:hover:bg-white/10 [&_button[aria-pressed=true]]:bg-white [&_button[aria-pressed=true]]:text-brand">
                <LectureAbsence code={item.slot.course_code} date={today} today={today} compact />
              </span>
            )}
          </>
        )}
        {item.kind === "task" && !item.task.targetDate && (
          <>
            <Button onClick={() => start(item.task, item.key)} className="border-transparent bg-white text-brand hover:bg-white/90">
              <Play className="fill-current" aria-hidden /> ابدأ الجلسة
            </Button>
            <Button onClick={() => toggle(item.key)} className="border-white/40 bg-transparent text-white hover:bg-white/10">
              <Check aria-hidden /> خلّصتها
            </Button>
          </>
        )}
        {item.kind === "exam" && (
          <Link href="/exams" prefetch={false} className={buttonClass({ className: "border-transparent bg-white text-brand hover:bg-white/90" })}>
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
        <h2 id="today-title" className="text-subheading font-bold">اليوم</h2>
        <Link href="/time" prefetch={false} className="inline-flex items-center gap-0.5 rounded-control text-small font-semibold text-info-ink hover:underline focus-ring">
          الأسبوع كامل <ChevronLeft className="size-4" aria-hidden />
        </Link>
      </div>
      {items.length === 0 ? (
        <EmptyState art={<RestDayArt />} title={isDayOff ? "يوم راحتك — ما فيه شي مجدول. ارتاح." : "ما عندك محاضرات ولا جلسات اليوم."} className="py-8" />
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
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
      <li className="bg-surface-sunken px-4 py-1.5 text-center text-caption text-ink-muted">
        {item.name} {formatClock(item.time)}
      </li>
    );
  }
  const time = (
    <span className="nums w-14 shrink-0 pt-0.5 text-body font-semibold leading-tight">
      {formatMinutes(item.start).split(" ")[0]}
      <span className="block text-caption font-normal text-ink-muted">{formatMinutes(item.start).split(" ")[1]}</span>
    </span>
  );
  return (
    <li className={cn("flex items-start gap-2 px-4 py-3", past ? "text-ink-muted" : "text-ink")}>
      {time}
      <div className="flex-1 min-w-0">
        {item.kind === "lecture" && (
          <div className="space-y-1.5">
            <p className="text-body">
              <span className="font-semibold">{item.slot.course_name || item.slot.course_code}</span>
              <span className="text-ink-muted"> محاضرة حتى {formatMinutes(item.end)}{item.slot.room ? `، قاعة ${item.slot.room}` : ""}</span>
            </p>
            <LectureAbsence code={item.slot.course_code} date={today} today={today} compact />
          </div>
        )}
        {item.kind === "exam" && (
          <p className="text-body font-semibold text-warning-ink">
            {EXAM_TYPE_LABELS[item.exam.exam_type] ?? "اختبار"} {item.exam.subject}
          </p>
        )}
        {item.kind === "task" && item.task.targetDate && (
          <p className="text-body">
            <span className="font-medium text-ink-muted">{TYPE_LABEL[item.task.taskType ?? "other"] ?? "موعد"} </span>
            <span className="font-semibold">{item.task.title}</span>
          </p>
        )}
        {item.kind === "task" && !item.task.targetDate && (
          <div className="flex items-center gap-1">
            {/* A 44px target around a 24px circle, pulled into the gutter of the row. */}
            <IconButton
              label={item.done ? `إلغاء إنجاز ${item.task.title}` : `تم: ${item.task.title}`}
              onClick={() => onToggle(item.key)}
              aria-pressed={item.done}
              className="group -my-2 -ms-2.5 shrink-0 rounded-full hover:bg-transparent"
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border-2 motion-fast transition-colors",
                  item.done ? "border-brand bg-brand text-on-brand" : "border-line-strong group-hover:border-brand",
                )}
              >
                {item.done && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
              </span>
            </IconButton>
            <p className={cn("min-w-0 flex-1 text-body", item.done && "text-ink-muted line-through")}>
              <span className="font-semibold">{item.task.title}</span>
              <span className="text-ink-muted"> {item.task.durationMinutes} د</span>
            </p>
            {!item.done && !past && (
              <Button variant="primary" size="sm" onClick={() => onStart(item.task, item.key)} className="shrink-0">
                <Play className="fill-current" aria-hidden /> ابدأ
              </Button>
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
