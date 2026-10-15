"use client";

/**
 * «وقتي» — what's coming up, on one screen.
 *
 *   • Next exam        — countdown banner (opens /exams)
 *   • Week strip       — Sunday → Saturday of this week
 *   • Day agenda       — lectures, study sessions, exams and prayer dividers
 *       lecture  → «غبت» records an absence for that date, room → indoor map
 *       session  → tick it done, or «ابدأ» to focus on it (/pomodoro)
 *   • Add (+)          — exam, study plan, timetable, free focus session
 *   • All tools        — the detail pages, one tap away
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ListChecks,
  MapPin,
  Play,
  Plus,
  ShieldCheck,
  Timer,
  Upload,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";
import { buildAgenda, formatClock, formatMinutes, roomHref, weekDates, type AgendaItem } from "@/lib/agenda";
import { EXAM_TYPE_LABELS, dayKey, daysBetween, upcomingExams, weekdayAr } from "@/lib/exams";
import { prayerTimesFor } from "@/lib/prayer-times";
import { termWeek } from "@/lib/today";
import type { AbsenceLevel } from "@/lib/attendance";
import { useScheduleStore } from "@/store/scheduleStore";
import { usePlanStore } from "@/store/planStore";
import { useExamsStore } from "@/store/examsStore";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useAttendanceRows } from "@/components/dashboard/use-attendance-rows";

const SHORT_DAYS = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

const LEVEL_TONE: Record<AbsenceLevel, string> = {
  safe: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-800 dark:text-amber-300",
  danger: "text-rose-700 dark:text-rose-300",
  deprived: "text-rose-700 dark:text-rose-300",
};

const TOOLS = [
  { href: "/schedule", label: "الجدول الكامل", detail: "رفع PDF · أوقات الصلاة · تصدير للتقويم", Icon: CalendarDays },
  { href: "/plan", label: "خطة المذاكرة", detail: "توليد الخطة وتعديل الجلسات", Icon: ListChecks },
  { href: "/exams", label: "الاختبارات", detail: "المواعيد والتعارضات وخطة المراجعة", Icon: CalendarClock },
  { href: "/attendance", label: "الغياب", detail: "كل المقررات والأعذار", Icon: ShieldCheck },
  { href: "/pomodoro", label: "جلسة تركيز", detail: "بومودورو حرّ", Icon: Timer },
];

export function TimeView() {
  const mounted = useHydrated();
  if (!mounted) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="h-20 rounded-3xl bg-foreground/5 animate-pulse" />
        <div className="h-16 rounded-3xl bg-foreground/5 animate-pulse" />
        <div className="h-64 rounded-3xl bg-foreground/5 animate-pulse" />
      </div>
    );
  }
  return <TimeViewReady />;
}

function TimeViewReady() {
  const now = useMemo(() => new Date(), []);
  const today = dayKey(now);
  const days = useMemo(() => weekDates(now), [now]);
  const [selected, setSelected] = useState(now.getDay());

  const schedule = useScheduleStore((s) => s.schedule);
  const plan = usePlanStore((s) => s.plan);
  const completed = usePlanStore((s) => s.completed);
  const exams = useExamsStore((s) => s.exams);

  const input = useMemo(
    () => ({ schedule, tasks: plan?.tasks ?? [], completed, exams }),
    [schedule, plan, completed, exams],
  );

  // Dots under the days that have something on them.
  const busy = useMemo(() => days.map((d) => buildAgenda(d, input).length > 0), [days, input]);

  const date = days[selected];
  const items = useMemo(
    () => buildAgenda(date, { ...input, prayers: prayerTimesFor(date, ["dhuhr", "asr", "maghrib", "isha"]) }),
    [date, input],
  );

  const week = termWeek(now);
  const range = `${days[0].getDate()}–${days[6].getDate()} ${new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "long" }).format(days[6])}`;
  const nothingYet = schedule.length === 0 && !plan && upcomingExams(exams, today).length === 0;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black">وقتي</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {[week ? `الأسبوع ${week.week} من ${week.term}` : null, range].filter(Boolean).join(" · ")}
          </p>
        </div>
        <AddMenu />
      </header>

      <NextExam today={today} />

      {nothingYet ? (
        <GetStarted />
      ) : (
        <>
          <div role="tablist" aria-label="أيام الأسبوع" className="grid grid-cols-7 gap-1.5">
            {days.map((d, i) => {
              const on = i === selected;
              const isToday = dayKey(d) === today;
              return (
                <button
                  key={i}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  aria-label={`${weekdayAr(dayKey(d))} ${d.getDate()}${isToday ? " (اليوم)" : ""}`}
                  onClick={() => setSelected(i)}
                  className={cn(
                    "h-16 rounded-2xl border flex flex-col items-center justify-center transition-colors",
                    on
                      ? "bg-foreground text-background border-foreground"
                      : "border-foreground/10 hover:bg-foreground/5",
                  )}
                >
                  <span className={cn("text-[11px] font-bold", !on && "text-muted-foreground")}>{SHORT_DAYS[i]}</span>
                  <span className="text-lg font-black leading-tight">{d.getDate()}</span>
                  <span
                    className={cn(
                      "w-1 h-1 rounded-full mt-0.5",
                      busy[i] ? (on ? "bg-background" : isToday ? "bg-uqu-accent" : "bg-foreground/40") : "bg-transparent",
                    )}
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>

          <section aria-label={`مواعيد ${weekdayAr(dayKey(date))}`} className="space-y-2.5">
            {items.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground rounded-3xl border border-dashed border-foreground/10">
                يوم خفيف — ما فيه شيء مجدول.
                {!plan && (
                  <Link href="/plan" prefetch={false} className="block mt-2 font-bold text-uqu-accent">
                    ولّد خطة مذاكرة للأسبوع
                  </Link>
                )}
              </div>
            ) : (
              items.map((item, i) => <AgendaRow key={`${item.kind}-${item.start}-${i}`} item={item} date={date} today={today} />)
            )}
          </section>
        </>
      )}

      <section aria-labelledby="tools-title" className="pt-2">
        <h2 id="tools-title" className="text-sm font-black text-muted-foreground px-1 mb-2">كل أدوات وقتي</h2>
        <ul className="rounded-3xl border border-foreground/10 divide-y divide-foreground/5 overflow-hidden">
          {TOOLS.map(({ href, label, detail, Icon }) => (
            <li key={href}>
              <Link href={href} prefetch={false} className="group flex items-center gap-3 px-4 py-3 hover:bg-foreground/5 transition-colors">
                <Icon className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold">{label}</span>
                  <span className="block text-xs text-muted-foreground truncate">{detail}</span>
                </span>
                <ChevronLeft className="w-4 h-4 text-muted-foreground/60 group-hover:text-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────

function TimeCell({ start }: { start: number }) {
  const [clock, half] = formatMinutes(start).split(" ");
  return (
    <div className="w-14 shrink-0 pt-3 text-center leading-tight">
      <div className="text-sm font-black">{clock}</div>
      <div className="text-[11px] text-muted-foreground">{half}</div>
    </div>
  );
}

function AgendaRow({ item, date, today }: { item: AgendaItem; date: Date; today: string }) {
  if (item.kind === "prayer") {
    return (
      <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground" role="separator" aria-label={`${item.name} ${formatClock(item.time)}`}>
        <span className="flex-1 h-px bg-foreground/10" />
        <span>
          {item.name} {formatClock(item.time)}
        </span>
        <span className="flex-1 h-px bg-foreground/10" />
      </div>
    );
  }
  if (item.kind === "lecture") return <LectureRow item={item} date={date} today={today} />;
  if (item.kind === "task") return <TaskRow item={item} />;
  return <ExamRow item={item} />;
}

function LectureRow({ item, date, today }: { item: Extract<AgendaItem, { kind: "lecture" }>; date: Date; today: string }) {
  const { slot } = item;
  const code = slot.course_code;
  const key = dayKey(date);
  // Select the stored object itself: a fresh `?? []` here would be a new
  // value on every render and loop the store subscription forever.
  const record = useAttendanceStore((s) => s.courses[code]);
  const addAbsence = useAttendanceStore((s) => s.addAbsence);
  const removeAbsence = useAttendanceStore((s) => s.removeAbsence);
  const row = useAttendanceRows().find((r) => r.code === code);
  const marked = record?.entries.find((e) => e.date === key);
  const canMark = key <= today;

  return (
    <div className="flex gap-2">
      <TimeCell start={item.start} />
      <div className="flex-1 min-w-0 rounded-3xl border border-foreground/10 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold truncate">{slot.course_name || code}</div>
            <div className="text-xs text-muted-foreground">
              {[`${slot.type || "محاضرة"} · حتى ${formatMinutes(item.end)}`, slot.room ? `قاعة ${slot.room}` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <Link
            href={roomHref(slot.room)}
            prefetch={false}
            aria-label="وين القاعة؟"
            title="وين القاعة؟"
            className="w-9 h-9 shrink-0 rounded-xl bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center"
          >
            <MapPin className="w-4 h-4" aria-hidden />
          </Link>
        </div>
        <div className="flex items-center justify-between gap-3">
          {row ? (
            <span className={cn("text-xs font-bold", LEVEL_TONE[row.st.level])}>
              {row.st.level === "deprived"
                ? "تجاوزت حد الغياب"
                : `الغياب ${row.st.unexcused} من ${row.st.maxUnexcused} بدون عذر`}
            </span>
          ) : (
            <span />
          )}
          {canMark && (
            <button
              type="button"
              onClick={() => (marked ? removeAbsence(code, marked.id) : addAbsence(code, key, false))}
              aria-pressed={!!marked}
              className={cn(
                "h-8 px-3 rounded-full border text-xs font-bold transition-colors",
                marked
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  : "border-foreground/15 text-muted-foreground hover:text-foreground hover:bg-foreground/5",
              )}
            >
              {marked ? "سُجّل غياب ✓" : "غبت"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ item }: { item: Extract<AgendaItem, { kind: "task" }> }) {
  const router = useRouter();
  const toggle = usePlanStore((s) => s.toggleTaskDone);
  const startTaskFromPlan = usePomodoroStore((s) => s.startTaskFromPlan);
  const { task, done, key } = item;

  return (
    <div className="flex gap-2">
      <TimeCell start={item.start} />
      <div className="flex-1 min-w-0 rounded-3xl bg-uqu-accent/[0.06] border border-uqu-accent/15 p-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => toggle(key)}
          aria-pressed={done}
          aria-label={done ? `إلغاء إنجاز ${task.title}` : `تم: ${task.title}`}
          className={cn(
            "w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors",
            done ? "bg-uqu-accent border-uqu-accent text-white" : "border-foreground/25 hover:border-uqu-accent",
          )}
        >
          {done && <Check className="w-4 h-4" strokeWidth={3} aria-hidden />}
        </button>
        <div className="flex-1 min-w-0">
          <div className={cn("font-bold truncate", done && "line-through text-muted-foreground")}>{task.title}</div>
          <div className="text-xs text-muted-foreground truncate">
            {["جلسة مذاكرة", `${task.durationMinutes} د`, task.courseName || task.courseCode].filter(Boolean).join(" · ")}
          </div>
        </div>
        {!done && (
          <button
            type="button"
            onClick={() => {
              startTaskFromPlan(task, key);
              router.push("/pomodoro");
            }}
            className="h-9 px-3 shrink-0 rounded-xl bg-uqu-accent text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-uqu-accent/90"
          >
            <Play className="w-3.5 h-3.5 fill-current" aria-hidden />
            ابدأ
          </button>
        )}
      </div>
    </div>
  );
}

function ExamRow({ item }: { item: Extract<AgendaItem, { kind: "exam" }> }) {
  const { exam } = item;
  return (
    <div className="flex gap-2">
      <TimeCell start={item.start} />
      <Link
        href="/exams"
        prefetch={false}
        className="flex-1 min-w-0 rounded-3xl bg-amber-500/10 border border-amber-500/25 p-4 hover:bg-amber-500/15 transition-colors"
      >
        <div className="text-xs font-bold text-amber-800 dark:text-amber-300">{EXAM_TYPE_LABELS[exam.exam_type] ?? "اختبار"}</div>
        <div className="font-black truncate">{exam.subject}</div>
        <div className="text-xs text-muted-foreground">
          {[`${exam.duration_minutes} دقيقة`, exam.location].filter(Boolean).join(" · ")}
        </div>
      </Link>
    </div>
  );
}

// ── Blocks ───────────────────────────────────────────────────────────

function NextExam({ today }: { today: string }) {
  const exams = useExamsStore((s) => s.exams);
  const exam = upcomingExams(exams, today)[0];
  if (!exam) return null;
  const days = daysBetween(today, exam.date);
  return (
    <Link
      href="/exams"
      prefetch={false}
      className="flex items-center justify-between gap-4 rounded-3xl bg-amber-500/10 border border-amber-500/20 px-5 py-4 hover:bg-amber-500/15 transition-colors"
    >
      <div className="min-w-0">
        <div className="text-xs font-bold text-amber-800 dark:text-amber-300">أقرب اختبار</div>
        <div className="font-black truncate">
          {exam.subject} — {EXAM_TYPE_LABELS[exam.exam_type] ?? "اختبار"}
        </div>
        <div className="text-xs text-muted-foreground">
          {[weekdayAr(exam.date), exam.date.split("-").reverse().slice(0, 2).join("/"), exam.time ? formatClock(exam.time) : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="text-center shrink-0">
        {days <= 0 ? (
          <div className="text-lg font-black text-amber-800 dark:text-amber-300">اليوم</div>
        ) : (
          <>
            <div className="text-3xl font-black leading-none text-amber-800 dark:text-amber-300">{days}</div>
            <div className="text-xs text-amber-800 dark:text-amber-300">{days === 1 ? "يوم" : days <= 10 ? "أيام" : "يوماً"}</div>
          </>
        )}
      </div>
    </Link>
  );
}

function GetStarted() {
  const steps = [
    { href: "/schedule", label: "ارفع جدولك الدراسي", detail: "PDF من البوابة — تظهر محاضراتك هنا ونحسب غيابك منها", Icon: Upload },
    { href: "/exams", label: "أضف مواعيد اختباراتك", detail: "عدّ تنازلي وتنبيه للتعارض وخطة مراجعة", Icon: CalendarClock },
    { href: "/plan", label: "ولّد خطة مذاكرة", detail: "جلسات موزّعة على فراغات جدولك", Icon: ListChecks },
  ];
  return (
    <section className="rounded-3xl border border-foreground/10 p-5 space-y-4">
      <div>
        <h2 className="font-black text-lg">نرتّب وقتك في ثلاث خطوات</h2>
        <p className="text-sm text-muted-foreground">كل شيء يجتمع هنا بعدها: المحاضرات والمذاكرة والاختبارات.</p>
      </div>
      <ol className="space-y-2">
        {steps.map(({ href, label, detail, Icon }, i) => (
          <li key={href}>
            <Link href={href} prefetch={false} className="flex items-center gap-3 p-3 rounded-2xl bg-foreground/[0.03] hover:bg-foreground/5 transition-colors">
              <span className="w-9 h-9 rounded-xl bg-uqu-accent/10 text-uqu-accent flex items-center justify-center shrink-0 font-black text-sm">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold">{label}</span>
                <span className="block text-xs text-muted-foreground">{detail}</span>
              </span>
              <Icon className="w-4 h-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AddMenu() {
  const router = useRouter();
  const items = [
    { href: "/exams", label: "اختبار" },
    { href: "/plan", label: "جلسة مذاكرة أو خطة للأسبوع" },
    { href: "/schedule", label: "رفع الجدول الدراسي" },
    { href: "/attendance", label: "غياب بتاريخ سابق" },
    { href: "/pomodoro", label: "جلسة تركيز حرّة" },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="إضافة"
        className="h-11 px-4 shrink-0 rounded-2xl bg-foreground text-background font-bold text-sm inline-flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-uqu-accent/50"
      >
        <Plus className="w-4 h-4" strokeWidth={2.6} aria-hidden />
        إضافة
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] p-1.5">
        {items.map((it) => (
          <DropdownMenuItem key={it.href} onClick={() => router.push(it.href)} className="px-2.5 py-2 text-sm font-semibold">
            {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
