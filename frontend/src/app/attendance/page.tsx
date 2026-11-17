"use client";

import { useMemo, useState } from "react";
import { Button as DsButton } from "@/components/ds/button";
import { useHydrated } from "@/lib/use-hydrated";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarX2,
  CheckCircle2,
  ChevronDown,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useScheduleStore } from "@/store/scheduleStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { useAttendanceStore } from "@/store/attendanceStore";
import { getCurrentTerm } from "@/lib/academic-term";
import {
  absenceStatus,
  coursesFromSchedule,
  estimateSessions,
  type AbsenceLevel,
  type TrackedCourse,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";

const LEVEL_UI: Record<AbsenceLevel, { label: string; tone: string; bar: string; Icon: typeof ShieldCheck }> = {
  safe: { label: "وضعك آمن", tone: "text-success-ink bg-success-soft border-success-line", bar: "bg-success-ink", Icon: ShieldCheck },
  warning: { label: "انتبه", tone: "text-warning-ink bg-warning-soft border-warning-line", bar: "bg-warning-ink", Icon: AlertTriangle },
  danger: { label: "آخر حد", tone: "text-warning-ink bg-warning-soft border-warning-line", bar: "bg-warning-ink", Icon: ShieldAlert },
  deprived: { label: "تجاوزت الحد — حرمان", tone: "text-danger-ink bg-danger-soft border-danger-line", bar: "bg-danger-ink", Icon: ShieldAlert },
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DATE_AR = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" });

function formatIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return DATE_AR.format(new Date(y, m - 1, d));
}

export default function AttendancePage() {
  const router = useRouter();
  const mounted = useHydrated();

  const schedule = useScheduleStore((s) => s.schedule);
  const currentCourses = useTranscriptStore((s) => s.currentCourses);

  const term = useMemo(() => getCurrentTerm(new Date()), []);

  const courses: TrackedCourse[] = useMemo(() => {
    const fromSchedule = coursesFromSchedule(schedule);
    const known = new Set(fromSchedule.map((c) => c.code));
    // Registered courses missing from the timetable still get a card.
    const extra = (currentCourses ?? [])
      .filter((c) => c.code && !known.has(c.code))
      .map((c) => ({ code: c.code, name: c.nameAr || c.name || c.code, sessionsPerWeek: 0, weekdays: [] }));
    return [...fromSchedule, ...extra];
  }, [schedule, currentCourses]);

  return (
    <div className="ds-page min-h-screen bg-canvas text-ink pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 max-w-5xl">
        <SectionTabs className="mb-6" />
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-control border border-line bg-surface shadow-card" aria-label="رجوع">
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-heading md:text-title font-bold flex items-center gap-3">
              <CalendarX2 className="w-7 h-7 text-info-ink" />
              متابعة الغياب
            </h1>
            <p className="text-ink-muted text-small">سجّل غيابك أولاً بأول، ونبّهك قبل ما توصل للحرمان.</p>
          </div>
        </div>

        {/* The rule in one line; the full text opens on demand. */}
        <details className="group border border-line bg-surface shadow-card rounded-card mb-6 text-small">
          <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3 font-bold [&::-webkit-details-marker]:hidden">
            <span>
              حد الحرمان: <span className="text-danger-ink">15% بدون عذر</span> أو{" "}
              <span className="text-warning-ink">25% بالمجموع</span>
            </span>
            <span className="text-caption text-info-ink shrink-0 group-open:hidden">التفاصيل</span>
            <span className="text-caption text-info-ink shrink-0 hidden group-open:inline">إخفاء</span>
          </summary>
          <div className="px-4 pb-4 leading-7 space-y-1">
          <p>
            <span className="font-bold">حسب لائحة الدراسة والاختبارات (القاعدة التنفيذية للمادة 14):</span>{" "}
            يُحرم الطالب من دخول الاختبار النهائي إذا زاد غيابه <b>بدون عذر عن 15%</b>، أو زاد مجموع غيابه{" "}
            <b>بعذر عن 25%</b> من محاضرات المقرر، ويُرصد له تقدير محروم (DN).
          </p>
          <p className="text-caption text-ink-muted">
            الأرقام هنا تقديرية من جدولك؛ المرجع الرسمي هو سجل الحضور عند أستاذ المقرر.
          </p>
          </div>
        </details>

        {!mounted ? null : courses.length === 0 ? (
          <Card className="border border-line bg-surface shadow-card border-dashed border-line-strong rounded-card p-10 text-center flex flex-col items-center gap-4">
            <Upload className="w-10 h-10 text-info-ink" />
            <div>
              <h2 className="text-heading font-bold mb-1">ارفع جدولك أولاً</h2>
              <p className="text-ink-muted text-small max-w-sm">
                نحسب عدد محاضرات كل مقرر في الفصل من جدولك الدراسي، بعدها تقدر تسجّل غيابك.
              </p>
            </div>
            <Link href="/schedule">
              <Button className="rounded-control bg-brand hover:bg-brand-hover text-on-brand">رفع الجدول</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {courses.map((c) => (
              <CourseCard key={c.code} course={c} estimated={estimateSessions(c, term)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function CourseCard({ course, estimated }: { course: TrackedCourse; estimated: number }) {
  const record = useAttendanceStore((s) => s.courses[course.code]);
  const addAbsence = useAttendanceStore((s) => s.addAbsence);
  const removeAbsence = useAttendanceStore((s) => s.removeAbsence);
  const toggleExcused = useAttendanceStore((s) => s.toggleExcused);
  const setTotalOverride = useAttendanceStore((s) => s.setTotalOverride);

  const [date, setDate] = useState(todayIso);
  const [open, setOpen] = useState(false);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalDraft, setTotalDraft] = useState("");

  const entries = record?.entries ?? [];
  const total = record?.totalOverride ?? estimated;
  const st = absenceStatus(entries, total);
  const ui = LEVEL_UI[st.level];
  const unexcusedFill = st.maxUnexcused ? Math.min(100, (st.unexcused / st.maxUnexcused) * 100) : 0;
  const totalFill = st.maxTotal ? Math.min(100, ((st.excused + st.unexcused) / st.maxTotal) * 100) : 0;

  return (
    <Card className="border border-line bg-surface shadow-card rounded-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-caption font-mono font-bold text-ink-muted">{course.code}</div>
          <h2 className="font-bold leading-snug">{course.name}</h2>
        </div>
        <span className={cn("shrink-0 text-caption font-bold px-2.5 py-1 rounded-control border flex items-center gap-1", ui.tone)}>
          <ui.Icon className="w-3.5 h-3.5" />
          {ui.label}
        </span>
      </div>

      <div className="text-small">
        {st.level === "deprived" ? (
          <p className="font-bold text-danger-ink">
            تجاوزت نسبة الغياب المسموحة. راجع أستاذ المقرر أو الكلية فوراً — رفع الحرمان ممكن بعذر مقبول إذا لم يقل حضورك عن 65%.
          </p>
        ) : (
          <p>
            يتبقى لك <b className="text-subheading">{st.remaining}</b> {st.remaining === 1 ? "غياب" : "غيابات"} بدون عذر قبل الحرمان.
          </p>
        )}
      </div>

      <div className="space-y-2.5">
        <Meter label="بدون عذر" value={st.unexcused} max={st.maxUnexcused} pct={unexcusedFill} bar={ui.bar} />
        <Meter label="المجموع (مع العذر)" value={st.excused + st.unexcused} max={st.maxTotal} pct={totalFill} bar={ui.bar} />
      </div>

      <div className="flex items-center gap-2 text-caption text-ink-muted">
        {editingTotal ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(totalDraft, 10);
              setTotalOverride(course.code, Number.isFinite(n) ? n : null);
              setEditingTotal(false);
            }}
          >
            <span>عدد المحاضرات في الفصل:</span>
            <Input
              type="number"
              min={1}
              max={200}
              value={totalDraft}
              onChange={(e) => setTotalDraft(e.target.value)}
              className="h-8 w-20 rounded-control"
              autoFocus
            />
            <Button type="submit" size="sm" className="h-8 rounded-control bg-brand hover:bg-brand-hover text-on-brand">حفظ</Button>
            {record?.totalOverride != null && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 rounded-control"
                onClick={() => {
                  setTotalOverride(course.code, null);
                  setEditingTotal(false);
                }}
              >
                استخدم التقدير
              </Button>
            )}
          </form>
        ) : (
          <>
            <span>
              عدد المحاضرات في الفصل: <b className="text-ink">{total}</b>
              {record?.totalOverride == null && " (تقدير من جدولك)"}
            </span>
            <DsButton variant="bare"
              type="button"
              className="inline-flex items-center gap-1 text-info-ink font-bold hover:underline"
              onClick={() => {
                setTotalDraft(String(total));
                setEditingTotal(true);
              }}
            >
              <Pencil className="w-3 h-3" /> تعديل
            </DsButton>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
        <Input
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 w-auto rounded-control mt-3"
          aria-label="تاريخ الغياب"
        />
        <Button
          size="sm"
          className="h-9 rounded-control mt-3 border border-danger-line bg-danger-soft hover:border-danger-ink text-danger-ink"
          onClick={() => date && addAbsence(course.code, date, false)}
        >
          + غياب بدون عذر
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 rounded-control mt-3 border-line-strong"
          onClick={() => date && addAbsence(course.code, date, true)}
        >
          + غياب بعذر
        </Button>
      </div>

      {entries.length > 0 && (
        <div>
          <DsButton variant="bare"
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center justify-between text-caption font-bold text-ink-muted hover:text-ink"
            aria-expanded={open}
          >
            السجل ({entries.length})
            <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
          </DsButton>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 text-caption rounded-control bg-surface-sunken px-3 py-2">
                  <span>{formatIso(e.date)}</span>
                  <span className="flex items-center gap-1">
                    <DsButton variant="bare"
                      type="button"
                      onClick={() => toggleExcused(course.code, e.id)}
                      className={cn(
                        "px-2 py-0.5 rounded-md border font-bold",
                        e.excused
                          ? "border-info-line text-info-ink bg-info-soft"
                          : "border-danger-line text-danger-ink bg-danger-soft",
                      )}
                      title="تبديل نوع الغياب"
                    >
                      {e.excused ? "بعذر" : "بدون عذر"}
                    </DsButton>
                    <DsButton variant="bare"
                      type="button"
                      onClick={() => removeAbsence(course.code, e.id)}
                      className="p-1 rounded-md text-ink-muted hover:text-danger-ink"
                      aria-label="حذف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </DsButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {entries.length === 0 && (
        <p className="text-caption text-ink-muted flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-success-ink" /> ما سجّلت أي غياب في هذا المقرر.
        </p>
      )}
    </Card>
  );
}

function Meter({ label, value, max, pct, bar }: { label: string; value: number; max: number; pct: number; bar: string }) {
  return (
    <div>
      <div className="flex justify-between text-caption mb-1">
        <span className="text-ink-muted font-medium">{label}</span>
        <span className="font-mono font-bold">
          {value} / {max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
