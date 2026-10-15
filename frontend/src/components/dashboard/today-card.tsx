"use client";

import Link from "next/link";
import { CalendarClock, ChevronLeft, Clock, ListChecks, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";
import { dayKey, daysBetween, findConflicts, upcomingExams, whenLabel } from "@/lib/exams";
import { lectureWhen, lecturesLeftToday, nextLecture } from "@/lib/today";
import { useExamsStore } from "@/store/examsStore";
import { useScheduleStore } from "@/store/scheduleStore";
import { usePlanAdherence } from "@/components/dashboard/adherence";
import { useAttendanceRows } from "@/components/dashboard/use-attendance-rows";

type Tone = "accent" | "rose" | "amber" | "emerald" | "muted";

const TONE: Record<Tone, string> = {
  accent: "text-uqu-accent",
  rose: "text-rose-700 dark:text-rose-300",
  amber: "text-amber-800 dark:text-amber-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  muted: "text-muted-foreground",
};

function Row({
  href,
  icon: Icon,
  iconTone = "accent",
  title,
  detail,
  badge,
  badgeTone = "accent",
}: {
  href: string;
  icon: typeof Clock;
  iconTone?: Tone;
  title: string;
  detail?: string;
  badge?: string;
  badgeTone?: Tone;
}) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className="group flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-foreground/5 transition-colors"
      >
        <span className="w-9 h-9 rounded-xl bg-foreground/5 flex items-center justify-center shrink-0">
          <Icon className={cn("w-4.5 h-4.5", TONE[iconTone])} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold truncate">{title}</span>
          {detail && <span className="block text-xs text-muted-foreground truncate">{detail}</span>}
        </span>
        {badge && <span className={cn("text-xs font-black shrink-0", TONE[badgeTone])}>{badge}</span>}
        <ChevronLeft className="w-4 h-4 text-muted-foreground/60 shrink-0 group-hover:text-foreground" aria-hidden />
      </Link>
    </li>
  );
}

/** The day at a glance: next lecture, next exam, absences and today's plan tasks. */
export function TodayCard() {
  const mounted = useHydrated();
  const schedule = useScheduleStore((s) => s.schedule);
  const exams = useExamsStore((s) => s.exams);
  const attendance = useAttendanceRows();
  const { hasPlan, perDay } = usePlanAdherence();

  if (!mounted) {
    return (
      <Card className="glass rounded-[24px] border-foreground/10 p-2 gap-0">
        <div className="h-[248px] rounded-2xl bg-foreground/5 animate-pulse" />
      </Card>
    );
  }

  const now = new Date();
  const today = dayKey(now);

  // Lecture
  const lecture = nextLecture(schedule, now);
  const leftToday = lecturesLeftToday(schedule, now);

  // Exam
  const upcoming = upcomingExams(exams, today);
  const exam = upcoming[0];
  const examDays = exam ? daysBetween(today, exam.date) : 0;
  const clash = findConflicts(upcoming).some((c) => c.kind === "overlap");

  // Attendance (most at risk first)
  const worst = attendance[0];
  const atRisk = attendance.filter((r) => r.st.level !== "safe").length;

  // Plan tasks for today (Sun=0 … Sat=6, the order of perDay)
  const todayTasks = perDay[now.getDay()];

  return (
    <Card className="glass rounded-[24px] border-foreground/10 p-2 gap-0">
      <ul className="divide-y divide-foreground/5">
        {lecture ? (
          <Row
            href="/time"
            icon={Clock}
            title={lecture.slot.course_name || lecture.slot.course_code}
            detail={[
              lecture.dayOffset === 0 ? `${leftToday} ${leftToday === 1 ? "محاضرة باقية اليوم" : "محاضرات باقية اليوم"}` : "ما عندك محاضرات باقية اليوم",
              lecture.slot.room,
            ]
              .filter(Boolean)
              .join(" · ")}
            badge={lectureWhen(lecture, now)}
          />
        ) : (
          <Row href="/schedule" icon={Clock} iconTone="muted" title="ارفع جدولك الدراسي" detail="نذكّرك بمحاضرة اليوم ونحسب غيابك منه" />
        )}

        {exam ? (
          <Row
            href="/exams"
            icon={CalendarClock}
            iconTone={examDays <= 3 ? "rose" : "accent"}
            title={`اختبار ${exam.subject}`}
            detail={clash ? "⚠️ عندك تعارض في مواعيد الاختبارات" : upcoming.length > 1 ? `و${upcoming.length - 1} ${upcoming.length - 1 === 1 ? "اختبار آخر" : "اختبارات أخرى"} قادمة` : undefined}
            badge={whenLabel(examDays)}
            badgeTone={examDays <= 3 ? "rose" : "accent"}
          />
        ) : (
          <Row href="/exams" icon={CalendarClock} iconTone="muted" title="أضف مواعيد اختباراتك" detail="عدّ تنازلي وتنبيه للتعارض وخطة مذاكرة" />
        )}

        {worst &&
          (atRisk > 0 ? (
            <Row
              href="/attendance"
              icon={ShieldAlert}
              iconTone={worst.st.level === "warning" ? "amber" : "rose"}
              title={worst.st.level === "deprived" ? `تجاوزت حد الغياب في ${worst.name}` : `باقي لك ${worst.st.remaining} ${worst.st.remaining === 1 ? "غياب" : "غيابات"} في ${worst.name}`}
              detail={atRisk > 1 ? `${atRisk} مقررات تحتاج انتباه` : "بدون عذر قبل الحرمان"}
            />
          ) : (
            <Row href="/attendance" icon={ShieldCheck} iconTone="emerald" title="غيابك بأمان في كل مقرراتك" detail={`${attendance.length} مقررات في جدولك`} />
          ))}

        {hasPlan ? (
          <Row
            href="/time"
            icon={ListChecks}
            iconTone={todayTasks && todayTasks.total > 0 && todayTasks.done === todayTasks.total ? "emerald" : "accent"}
            title={todayTasks && todayTasks.total > 0 ? `مهام اليوم: ${todayTasks.done} من ${todayTasks.total}` : "ما عندك مهام اليوم في الخطة"}
            detail="من خطة المذاكرة لهذا الأسبوع"
          />
        ) : (
          <Row href="/plan" icon={ListChecks} iconTone="muted" title="ولّد خطة مذاكرة لهذا الأسبوع" detail="جلسات موزّعة على فراغات جدولك" />
        )}
      </ul>
    </Card>
  );
}
