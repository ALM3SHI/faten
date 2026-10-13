"use client";

import { useMemo, useState } from "react";
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
  safe: { label: "وضعك آمن", tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20", bar: "bg-emerald-500", Icon: ShieldCheck },
  warning: { label: "انتبه", tone: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20", bar: "bg-amber-500", Icon: AlertTriangle },
  danger: { label: "آخر حد", tone: "text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/25", bar: "bg-orange-500", Icon: ShieldAlert },
  deprived: { label: "تجاوزت الحد — حرمان", tone: "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/25", bar: "bg-rose-500", Icon: ShieldAlert },
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
    <div className="min-h-screen bg-background pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 max-w-5xl">
        <SectionTabs className="mb-6" />
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-xl glass border-foreground/10" aria-label="رجوع">
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-black flex items-center gap-3">
              <CalendarX2 className="w-7 h-7 text-uqu-accent" />
              متابعة الغياب
            </h1>
            <p className="text-muted-foreground text-sm">سجّل غيابك أولاً بأول، ونبّهك قبل ما توصل للحرمان.</p>
          </div>
        </div>

        {/* The rule in one line; the full text opens on demand. */}
        <details className="group glass border border-foreground/10 rounded-2xl mb-6 text-sm">
          <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3 font-bold [&::-webkit-details-marker]:hidden">
            <span>
              حد الحرمان: <span className="text-rose-700 dark:text-rose-300">15% بدون عذر</span> أو{" "}
              <span className="text-amber-800 dark:text-amber-300">25% بالمجموع</span>
            </span>
            <span className="text-xs text-uqu-accent shrink-0 group-open:hidden">التفاصيل</span>
            <span className="text-xs text-uqu-accent shrink-0 hidden group-open:inline">إخفاء</span>
          </summary>
          <div className="px-4 pb-4 leading-7 space-y-1">
          <p>
            <span className="font-bold">حسب لائحة الدراسة والاختبارات (القاعدة التنفيذية للمادة 14):</span>{" "}
            يُحرم الطالب من دخول الاختبار النهائي إذا زاد غيابه <b>بدون عذر عن 15%</b>، أو زاد مجموع غيابه{" "}
            <b>بعذر عن 25%</b> من محاضرات المقرر، ويُرصد له تقدير محروم (DN).
          </p>
          <p className="text-xs text-muted-foreground">
            الأرقام هنا تقديرية من جدولك؛ المرجع الرسمي هو سجل الحضور عند أستاذ المقرر.
          </p>
          </div>
        </details>

        {!mounted ? null : courses.length === 0 ? (
          <Card className="glass border-dashed border-foreground/15 rounded-[32px] p-10 text-center flex flex-col items-center gap-4">
            <Upload className="w-10 h-10 text-uqu-accent" />
            <div>
              <h2 className="text-xl font-bold mb-1">ارفع جدولك أولاً</h2>
              <p className="text-muted-foreground text-sm max-w-sm">
                نحسب عدد محاضرات كل مقرر في الفصل من جدولك الدراسي، بعدها تقدر تسجّل غيابك.
              </p>
            </div>
            <Link href="/schedule">
              <Button className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white">رفع الجدول</Button>
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
    <Card className="glass border-foreground/10 rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-mono font-bold text-muted-foreground">{course.code}</div>
          <h2 className="font-bold leading-snug">{course.name}</h2>
        </div>
        <span className={cn("shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg border flex items-center gap-1", ui.tone)}>
          <ui.Icon className="w-3.5 h-3.5" />
          {ui.label}
        </span>
      </div>

      <div className="text-sm">
        {st.level === "deprived" ? (
          <p className="font-bold text-rose-600 dark:text-rose-400">
            تجاوزت نسبة الغياب المسموحة. راجع أستاذ المقرر أو الكلية فوراً — رفع الحرمان ممكن بعذر مقبول إذا لم يقل حضورك عن 65%.
          </p>
        ) : (
          <p>
            يتبقى لك <b className="text-lg">{st.remaining}</b> {st.remaining === 1 ? "غياب" : "غيابات"} بدون عذر قبل الحرمان.
          </p>
        )}
      </div>

      <div className="space-y-2.5">
        <Meter label="بدون عذر" value={st.unexcused} max={st.maxUnexcused} pct={unexcusedFill} bar={ui.bar} />
        <Meter label="المجموع (مع العذر)" value={st.excused + st.unexcused} max={st.maxTotal} pct={totalFill} bar={ui.bar} />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
              className="h-8 w-20 rounded-lg"
              autoFocus
            />
            <Button type="submit" size="sm" className="h-8 rounded-lg bg-uqu-accent hover:bg-uqu-accent/90 text-white">حفظ</Button>
            {record?.totalOverride != null && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg"
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
              عدد المحاضرات في الفصل: <b className="text-foreground">{total}</b>
              {record?.totalOverride == null && " (تقدير من جدولك)"}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-uqu-accent font-bold hover:underline"
              onClick={() => {
                setTotalDraft(String(total));
                setEditingTotal(true);
              }}
            >
              <Pencil className="w-3 h-3" /> تعديل
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-foreground/10">
        <Input
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 w-auto rounded-xl mt-3"
          aria-label="تاريخ الغياب"
        />
        <Button
          size="sm"
          className="h-9 rounded-xl mt-3 bg-rose-600 hover:bg-rose-600/90 text-white"
          onClick={() => date && addAbsence(course.code, date, false)}
        >
          + غياب بدون عذر
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 rounded-xl mt-3 border-foreground/15"
          onClick={() => date && addAbsence(course.code, date, true)}
        >
          + غياب بعذر
        </Button>
      </div>

      {entries.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-bold text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            السجل ({entries.length})
            <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 text-xs rounded-xl bg-foreground/5 px-3 py-2">
                  <span>{formatIso(e.date)}</span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleExcused(course.code, e.id)}
                      className={cn(
                        "px-2 py-0.5 rounded-md border font-bold",
                        e.excused
                          ? "border-sky-500/30 text-sky-600 dark:text-sky-400 bg-sky-500/10"
                          : "border-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-500/10",
                      )}
                      title="تبديل نوع الغياب"
                    >
                      {e.excused ? "بعذر" : "بدون عذر"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAbsence(course.code, e.id)}
                      className="p-1 rounded-md text-muted-foreground hover:text-rose-500"
                      aria-label="حذف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> ما سجّلت أي غياب في هذا المقرر.
        </p>
      )}
    </Card>
  );
}

function Meter({ label, value, max, pct, bar }: { label: string; value: number; max: number; pct: number; bar: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="font-mono font-bold">
          {value} / {max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
