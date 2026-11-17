"use client";

/**
 * Small pieces shared by «وقتي» (components/time/week-view.tsx) and
 * «اليوم» (app/dashboard/page.tsx): the next-exam banner, the absence
 * button on a lecture, the room link, and the list of «وقتي» tools.
 */

import Link from "next/link";
import { Button } from "@/components/ds/button";
import { CalendarClock, CalendarDays, ChevronLeft, MapPin, ShieldCheck, Timer } from "lucide-react";
import { formatClock, roomHref } from "@/lib/agenda";
import { EXAM_TYPE_LABELS, daysBetween, upcomingExams, weekdayAr } from "@/lib/exams";
import type { AbsenceLevel } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useExamsStore } from "@/store/examsStore";
import { useAttendanceRows } from "@/components/dashboard/use-attendance-rows";

const LEVEL_TONE: Record<AbsenceLevel, string> = {
  safe: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  deprived: "text-danger-ink",
};

/** «أقرب اختبار» with a day countdown; nothing when no exam is ahead. */
export function NextExam({ today, className }: { today: string; className?: string }) {
  const exams = useExamsStore((s) => s.exams);
  const exam = upcomingExams(exams, today)[0];
  if (!exam) return null;
  const days = daysBetween(today, exam.date);
  return (
    <Link
      href="/exams"
      prefetch={false}
      className={cn(
 "flex items-center justify-between gap-4 rounded-card bg-warning-soft border border-warning-line px-5 py-4 hover:bg-warning-soft transition-colors",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-caption font-bold text-warning-ink">أقرب اختبار</div>
        <div className="font-bold truncate">
          {exam.subject} — {EXAM_TYPE_LABELS[exam.exam_type] ?? "اختبار"}
        </div>
        <div className="text-caption text-ink-muted">
          {weekdayAr(exam.date)} {exam.date.split("-").reverse().slice(0, 2).join("/")}
          {exam.time ? `، ${formatClock(exam.time)}` : ""}
        </div>
      </div>
      <div className="text-center shrink-0 text-warning-ink">
        {days <= 1 ? (
          <div className="text-subheading font-bold">{days <= 0 ? "اليوم" : "غداً"}</div>
        ) : (
          <>
            <div className="text-title font-bold leading-none">{days}</div>
            <div className="text-caption">{days === 1 ? "يوم" : days <= 10 ? "أيام" : "يوماً"}</div>
          </>
        )}
      </div>
    </Link>
  );
}

/**
 * Absence status of a lecture's course and the «غبت» toggle for that date.
 * Only dates up to today can be marked.
 */
export function LectureAbsence({ code, date, today, compact = false }: { code: string; date: string; today: string; compact?: boolean }) {
  // Select the stored object itself: a fresh `?? []` would be a new value on
  // every render and loop the store subscription forever.
  const record = useAttendanceStore((s) => s.courses[code]);
  const addAbsence = useAttendanceStore((s) => s.addAbsence);
  const removeAbsence = useAttendanceStore((s) => s.removeAbsence);
  const row = useAttendanceRows().find((r) => r.code === code);
  const marked = record?.entries.find((e) => e.date === date);
  const canMark = date <= today;

  return (
    <span className="flex items-center justify-between gap-3">
      {row && !compact ? (
        <span className={cn("text-caption font-bold", LEVEL_TONE[row.st.level])}>
          {row.st.level === "deprived" ? "تجاوزت حد الغياب" : `الغياب ${row.st.unexcused} من ${row.st.maxUnexcused} بدون عذر`}
        </span>
      ) : (
        <span />
      )}
      {canMark && (
        <Button variant="bare"
          type="button"
          onClick={() => (marked ? removeAbsence(code, marked.id) : addAbsence(code, date, false))}
          aria-pressed={!!marked}
          className={cn(
 "h-8 px-3 rounded-full border text-caption font-bold transition-colors shrink-0",
            marked
              ? "border-danger-line bg-danger-soft text-danger-ink"
              : "border-line-strong text-ink-muted hover:text-ink hover:bg-surface-sunken",
          )}
        >
          {marked ? "سُجّل غياب ✓" : "غبت"}
        </Button>
      )}
    </span>
  );
}

/** «وين القاعة؟» — opens the indoor map on the room when it is numbered. */
export function RoomLink({ room, className }: { room?: string | null; className?: string }) {
  return (
    <Link
      href={roomHref(room)}
      prefetch={false}
      aria-label="وين القاعة؟"
      title="وين القاعة؟"
      className={cn("w-9 h-9 shrink-0 rounded-control bg-surface-sunken hover:bg-surface-sunken flex items-center justify-center", className)}
    >
      <MapPin className="w-4 h-4" aria-hidden />
    </Link>
  );
}

const TOOLS = [
  { href: "/schedule", label: "الجدول الكامل", detail: "رفع PDF وأوقات الصلاة وتصدير للتقويم", Icon: CalendarDays },
  { href: "/exams", label: "الاختبارات", detail: "المواعيد والتعارضات وخطة المراجعة", Icon: CalendarClock },
  { href: "/attendance", label: "الغياب", detail: "كل المقررات والأعذار", Icon: ShieldCheck },
  { href: "/pomodoro", label: "جلسة تركيز", detail: "بومودورو بدون جلسة محددة", Icon: Timer },
];

/** The detail pages of «وقتي», one tap away. */
export function TimeTools() {
  return (
    <section aria-labelledby="tools-title">
      <h2 id="tools-title" className="font-bold mb-3">كل أدوات وقتي</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {TOOLS.map(({ href, label, detail, Icon }) => (
          <li key={href}>
            <Link href={href} prefetch={false} className="group flex items-center gap-3 rounded-card border border-line px-4 py-3 hover:bg-surface-sunken transition-colors">
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
  );
}
