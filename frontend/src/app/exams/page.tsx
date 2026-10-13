"use client";

/**
 * Exam timetable (/exams): the student's own exam dates with a live
 * countdown, clash warnings, and a study plan spread over the days before
 * each exam. The same exams are visible to the agent ("متى اختباري الجاي؟").
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Plus } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ExamCard, formatExamDate } from "@/components/exams/exam-card";
import { ExamFormDialog } from "@/components/exams/exam-form";
import { NextExamHero } from "@/components/exams/next-exam";
import { ExamStudyPlanCard } from "@/components/exams/study-plan";
import { useHydrated } from "@/lib/use-hydrated";
import { buildStudyPlan, dayKey, findConflicts, sortExams, upcomingExams, type Exam } from "@/lib/exams";
import { refreshExams } from "@/lib/firebase/sync";
import { buildCreditsResolver } from "@/lib/transcript-utils";
import { useExamsStore } from "@/store/examsStore";
import { useTranscriptStore } from "@/store/transcriptStore";

export default function ExamsPage() {
  const mounted = useHydrated();
  const exams = useExamsStore((s) => s.exams);
  const addExam = useExamsStore((s) => s.addExam);
  const updateExam = useExamsStore((s) => s.updateExam);
  const removeExam = useExamsStore((s) => s.removeExam);
  const studyDone = useExamsStore((s) => s.studyDone);
  const toggleSession = useExamsStore((s) => s.toggleSession);
  const dailyMinutes = useExamsStore((s) => s.dailyMinutes);
  const setDailyMinutes = useExamsStore((s) => s.setDailyMinutes);
  const completed = useTranscriptStore((s) => s.completedCourses);
  const current = useTranscriptStore((s) => s.currentCourses);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Exam | null>(null);
  const [deleting, setDeleting] = useState<Exam | null>(null);

  // Pick up exams the agent added since sign-in.
  useEffect(() => {
    refreshExams().catch((err) => console.warn("[exams] refresh failed:", err));
  }, []);

  const today = mounted ? dayKey(new Date()) : "";
  const upcoming = useMemo(() => (today ? upcomingExams(exams, today) : []), [exams, today]);
  const past = useMemo(
    () => (today ? sortExams(exams.filter((e) => e.done || e.date < today)).reverse() : []),
    [exams, today],
  );
  const conflicts = useMemo(() => findConflicts(upcoming), [upcoming]);
  const clashOf = (id: string) =>
    conflicts.find((c) => c.kind === "overlap" && c.exams.some((e) => e.id === id))?.kind ??
    conflicts.find((c) => c.exams.some((e) => e.id === id))?.kind;

  const creditsByCode = useMemo(() => {
    const resolve = buildCreditsResolver(completed);
    return Object.fromEntries(current.filter((c) => c.code).map((c) => [c.code, resolve(c.creditHours, c.code)]));
  }, [completed, current]);
  const plan = useMemo(
    () => (today ? buildStudyPlan(upcoming, today, { dailyMinutes, creditsByCode }) : null),
    [upcoming, today, dailyMinutes, creditsByCode],
  );

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="min-h-screen bg-background pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 max-w-4xl space-y-6">
        <SectionTabs />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black flex items-center gap-3">
              <CalendarClock className="w-8 h-8 text-uqu-accent" aria-hidden />
              جدول الاختبارات
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              مواعيد اختباراتك، كم باقي لكل واحد، وخطة مذاكرة موزعة قبلها. تقدر تسأل فطن: «متى اختباري الجاي؟»
            </p>
          </div>
          <Button onClick={openNew} className="rounded-2xl h-11 bg-uqu-accent hover:bg-uqu-accent/90 text-white gap-2">
            <Plus className="w-4 h-4" aria-hidden />
            إضافة اختبار
          </Button>
        </div>

        {!mounted ? (
          <div className="h-48 rounded-[32px] bg-foreground/5 animate-pulse" />
        ) : upcoming.length === 0 ? (
          <Card className="glass rounded-[32px] border-foreground/10 p-10 text-center space-y-4">
            <CalendarClock className="w-12 h-12 mx-auto text-uqu-accent" aria-hidden />
            <h2 className="text-xl font-black">ما في اختبارات قادمة</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-7">
              أضف مواعيد اختباراتك من جدول الاختبارات الرسمي — أو قلها لفطن في الدردشة وبيسجّلها لك.
            </p>
            <Button onClick={openNew} className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white gap-2">
              <Plus className="w-4 h-4" aria-hidden />
              أضف أول اختبار
            </Button>
          </Card>
        ) : (
          <>
            <NextExamHero exam={upcoming[0]} />

            {conflicts.length > 0 && (
              <div role="alert" className="space-y-2">
                {conflicts.map((c) => (
                  <p
                    key={c.exams.map((e) => e.id).join("|")}
                    className={
                      c.kind === "overlap"
                        ? "flex items-start gap-2 text-sm font-bold text-rose-700 dark:text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3"
                        : "flex items-start gap-2 text-sm font-bold text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3"
                    }
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                    {c.kind === "overlap"
                      ? `تعارض: ${c.exams[0].subject} و${c.exams[1].subject} في نفس الوقت (${formatExamDate(c.date)}) — راجع القسم.`
                      : `${c.exams[0].subject} و${c.exams[1].subject} في نفس اليوم (${formatExamDate(c.date)}).`}
                  </p>
                ))}
              </div>
            )}

            <section aria-labelledby="upcoming-title" className="space-y-3">
              <h2 id="upcoming-title" className="text-lg font-black">
                القادمة ({upcoming.length})
              </h2>
              <ul className="space-y-3">
                {upcoming.map((e) => (
                  <ExamCard
                    key={e.id}
                    exam={e}
                    today={today}
                    clash={clashOf(e.id)}
                    onEdit={() => {
                      setEditing(e);
                      setFormOpen(true);
                    }}
                    onDelete={() => setDeleting(e)}
                    onToggleDone={() => updateExam(e.id, { done: !e.done })}
                  />
                ))}
              </ul>
            </section>

            {plan && plan.days.length > 0 && (
              <ExamStudyPlanCard
                plan={plan}
                today={today}
                dailyMinutes={dailyMinutes}
                onDailyMinutes={setDailyMinutes}
                done={studyDone}
                onToggle={toggleSession}
              />
            )}
          </>
        )}

        {mounted && past.length > 0 && (
          <details className="rounded-2xl border border-foreground/10 p-4">
            <summary className="cursor-pointer font-bold text-sm">اختبارات سابقة ({past.length})</summary>
            <ul className="space-y-3 mt-3">
              {past.map((e) => (
                <ExamCard
                  key={e.id}
                  exam={e}
                  today={today}
                  onEdit={() => {
                    setEditing(e);
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleting(e)}
                  onToggleDone={() => updateExam(e.id, { done: !e.done })}
                />
              ))}
            </ul>
          </details>
        )}
      </main>

      <ExamFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        others={exams}
        onSave={(input) => (editing ? updateExam(editing.id, input) : addExam(input))}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="حذف الاختبار؟"
        description={deleting ? `سيُحذف اختبار ${deleting.subject} من جدولك على كل أجهزتك.` : ""}
        confirmLabel="حذف"
        destructive
        onConfirm={() => deleting && removeExam(deleting.id)}
      />
    </div>
  );
}
