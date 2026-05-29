"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sparkles,
  Brain,
  AlertCircle,
  RefreshCw,
  Wand2,
  Calendar,
  Flame,
  Lightbulb,
  GraduationCap,
  Coffee,
  Plus,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { validatePlanTaskPlacement } from "@/lib/plan-task-conflicts";
import type { StudyGridBlock } from "@/lib/schedule-grid";
import { useTranscriptStore } from "@/store/transcriptStore";
import { useScheduleStore } from "@/store/scheduleStore";
import { useProfileStore } from "@/store/profileStore";
import {
  usePlanStore,
  taskKey,
  type GeneratePlanPayload,
  type PlanTask,
} from "@/store/planStore";
import { PlanTimetable } from "@/components/plan/PlanTimetable";
import { StudySessionDialog } from "@/components/plan/StudySessionDialog";
import { RegisteredEventsDialog } from "@/components/plan/RegisteredEventsDialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

function safeMinutes(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatStudyHours(totalMinutes: number): string {
  const hours = safeMinutes(totalMinutes) / 60;
  return `${hours.toFixed(1)}س`;
}

export default function PlanPage() {
  // ── Source stores ─────────────────────────────────────────────────
  const currentCourses = useTranscriptStore((s) => s.currentCourses);
  const studentName = useTranscriptStore((s) => s.name || s.nameEn);
  const schedule = useScheduleStore((s) => s.schedule);
  const profileBasic = useProfileStore((s) => s.basic);
  const profileGoals = useProfileStore((s) => s.goals);
  const preferences = useProfileStore((s) => s.preferences);

  // ── Plan store ────────────────────────────────────────────────────
  const plan = usePlanStore((s) => s.plan);
  const model = usePlanStore((s) => s.model);
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

  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDialogMode, setSessionDialogMode] = useState<"add" | "edit">("add");
  const [editingTask, setEditingTask] = useState<PlanTask | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [eventsDialogOpen, setEventsDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; title: string } | null>(
    null,
  );

  // ── Derived state ─────────────────────────────────────────────────
  const hasTranscript = currentCourses.length > 0;
  const hasSchedule = schedule.length > 0;
  const canGenerate = hasTranscript && !isGenerating;

  const totalMinutes = useMemo(
    () =>
      plan
        ? plan.tasks.reduce((acc, t) => acc + safeMinutes(t.durationMinutes), 0)
        : 0,
    [plan],
  );
  const totalSessions = plan?.tasks.length ?? 0;
  const completedCount = useMemo(
    () => (plan ? plan.tasks.filter((t) => completed.includes(taskKey(t))).length : 0),
    [plan, completed],
  );
  const progressPct = totalSessions > 0 ? Math.round((completedCount / totalSessions) * 100) : 0;

  // ── Generate handler ──────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!canGenerate) return;
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
      studentName: studentName || profileBasic.name || null,
      currentGpa: profileGoals.currentGpa || null,
      targetGpa: profileGoals.targetGpa || null,
    };
    await generatePlan(payload);
  };

  const existingTasks = plan?.tasks ?? [];

  const openAddSession = () => {
    setSessionDialogMode("add");
    setEditingTask(null);
    setEditingKey(null);
    setSessionDialogOpen(true);
  };

  const openEditSession = (block: StudyGridBlock) => {
    const task = existingTasks[block.taskIndex];
    if (!task) return;
    setSessionDialogMode("edit");
    setEditingTask(task);
    setEditingKey(block.taskKey);
    setSessionDialogOpen(true);
  };

  // Edit/delete entry points used by the registered-events dialog (it holds
  // the PlanTask directly rather than a grid block).
  const openEditTask = (task: PlanTask) => {
    setEventsDialogOpen(false);
    setSessionDialogMode("edit");
    setEditingTask(task);
    setEditingKey(taskKey(task));
    setSessionDialogOpen(true);
  };

  const openDeleteTask = (task: PlanTask) => {
    setEventsDialogOpen(false);
    setDeleteTarget({ key: taskKey(task), title: task.title });
  };

  const datedEventCount = existingTasks.filter((t) => !!t.targetDate).length;

  const openDeleteSession = (block: StudyGridBlock) => {
    const task = existingTasks[block.taskIndex];
    setDeleteTarget({
      key: block.taskKey,
      title: task?.title ?? block.title,
    });
  };

  const handleSessionSubmit = (task: PlanTask) => {
    if (sessionDialogMode === "add") {
      const err = validatePlanTaskPlacement({
        task,
        lectures: schedule,
        existingTasks,
      });
      if (err) {
        toast.error(err);
        return;
      }
      addTask(task);
      toast.success("تمت إضافة جلسة المذاكرة");
      setSessionDialogOpen(false);
      return;
    }

    if (!editingKey) return;
    const err = validatePlanTaskPlacement({
      task,
      lectures: schedule,
      existingTasks,
      excludeTaskKey: editingKey,
    });
    if (err) {
      toast.error(err);
      return;
    }
    updateTask(editingKey, task);
    toast.success("تم تحديث جلسة المذاكرة");
    setSessionDialogOpen(false);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    removeTask(deleteTarget.key);
    toast.success("تم حذف جلسة المذاكرة");
    setDeleteTarget(null);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="w-full max-w-[95vw] mx-auto pt-32 px-3 sm:px-5 lg:px-6 space-y-8" dir="rtl">
        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black tracking-tight mb-2">خطة المذاكرة</h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              جلسات مراجعة أسبوعية موزّعة حسب جدولك وتفضيلاتك.
            </p>
            {generatedAt && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/70">
                <span>
                  آخر توليد{" "}
                  {new Date(generatedAt).toLocaleString("ar-SA", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                {model && (
                  <>
                    <span className="text-muted-foreground/40" aria-hidden>
                      ·
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground/55 truncate max-w-[12rem]">
                      {model}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={cn(
              "rounded-2xl gap-2 px-5 py-5 text-base font-bold",
              "bg-uqu-accent hover:bg-uqu-accent/90 disabled:opacity-50",
              "shadow-[0_0_24px_-4px_hsla(245,78%,62%,0.6)]",
            )}
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                جاري التوليد...
              </>
            ) : plan ? (
              <>
                <Wand2 className="w-4 h-4" />
                توليد جلسات مراجعة جديدة
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                توليد جلسات المراجعة
              </>
            )}
          </Button>
        </header>

        {/* ── Prerequisite gates ──────────────────────────────────── */}
        {!hasTranscript && (
          <PrerequisiteCard
            title="ارفع سجلك الأكاديمي أولاً"
            description="نحتاج قائمة مواد ترمك الحالي حتى يتمكن الذكاء الاصطناعي من جدولة جلسات مراجعة مخصصة لك."
            icon={<GraduationCap className="w-6 h-6" />}
            href="/profile"
            cta="انتقل إلى الملف الأكاديمي"
          />
        )}
        {hasTranscript && !hasSchedule && (
          <PrerequisiteCard
            title="جدولك الدراسي غير مهيّأ"
            description="يمكنك المتابعة بدون جدول، لكن جلسات المراجعة ستكون أدق إذا عرف المساعد متى تكون مشغولاً في المحاضرات."
            icon={<Calendar className="w-6 h-6" />}
            href="/profile"
            cta="إضافة الجدول"
            tone="info"
          />
        )}

        {/* ── Error banner ────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <Card className="p-4 border-rose-500/40 bg-rose-500/10 text-rose-300 rounded-2xl text-sm flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="flex-1">{error}</div>
                <button
                  onClick={clearError}
                  className="text-rose-300/70 hover:text-rose-200 text-xs font-bold shrink-0"
                >
                  إخفاء
                </button>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Loading state ───────────────────────────────────────── */}
        {isGenerating && <LoadingState />}

        {/* ── Full-width timetable, cards below ─ */}
        {hasTranscript && !isGenerating && (
          <div className="flex flex-col gap-8 w-full">
            <section className="w-full min-w-0 max-w-full space-y-6">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground">
                  أضف أو عدّل جلسات المذاكرة يدوياً على الجدول
                </p>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEventsDialogOpen(true)}
                    className="rounded-xl gap-2.5 h-11 px-5 text-base font-bold border-uqu-accent/40 hover:bg-uqu-accent/15 shadow-sm"
                  >
                    <CalendarClock className="w-5 h-5" />
                    الأحداث المسجلة
                    {datedEventCount > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-uqu-accent/25 text-uqu-accent text-xs font-mono inline-flex items-center justify-center">
                        {datedEventCount}
                      </span>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openAddSession}
                    className="rounded-xl gap-2.5 h-11 px-5 text-base font-bold border-violet-500/40 hover:bg-violet-500/15 shadow-sm"
                  >
                    <Plus className="w-5 h-5" />
                    إضافة جلسة
                  </Button>
                </div>
              </div>
              <PlanTimetable
                tasks={plan?.tasks}
                completed={completed}
                onToggleTask={toggleTaskDone}
                interactiveStudy
                onEditStudyBlock={openEditSession}
                onDeleteStudyBlock={openDeleteSession}
              />

              {!plan && (
                <EmptyState onGenerate={handleGenerate} disabled={!canGenerate} />
              )}
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6 w-full">
              <Card className="glass rounded-2xl border-foreground/10 p-5 space-y-4 h-full">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-uqu-accent" />
                  <h3 className="font-bold text-sm">تقدّم الخطة</h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted">الجلسات المنجزة</span>
                    <span className="text-sm font-bold font-mono">
                      {completedCount}/{totalSessions}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-foreground/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-uqu-accent rounded-full shadow-[0_0_8px_var(--accent,#7c5fff)] transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted">{progressPct}% مكتمل</p>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-foreground/10">
                  <SidebarStat label="إجمالي الجلسات" value={String(totalSessions)} />
                  <SidebarStat
                    label="ساعات مذاكرة"
                    value={formatStudyHours(totalMinutes)}
                  />
                </div>
              </Card>

              <Card className="glass rounded-2xl border-foreground/10 p-5 space-y-3 h-full">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-sm">إعداداتك المعتمدة</h3>
                </div>
                <PrefRow label="ذروة الطاقة" value={energyPeakLabel(preferences.energyPeak)} />
                <PrefRow label="الاستراتيجية" value={strategyLabel(preferences.taskStrategy)} />
                <PrefRow
                  label="بومودورو (مؤقت)"
                  value={`${preferences.pomodoroFocus} د`}
                  mono
                />
                <PrefRow label="يوم الراحة" value={dayOffLabel(preferences.dayOff)} />
              </Card>
            </div>
          </div>
        )}
      </main>

      <StudySessionDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        mode={sessionDialogMode}
        initialTask={editingTask ?? undefined}
        courses={currentCourses}
        onSubmit={handleSessionSubmit}
      />

      <RegisteredEventsDialog
        open={eventsDialogOpen}
        onOpenChange={setEventsDialogOpen}
        tasks={existingTasks}
        onEdit={openEditTask}
        onDelete={openDeleteTask}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="حذف جلسة المذاكرة"
        description={
          deleteTarget
            ? `هل تريد حذف «${deleteTarget.title}»؟ لا يمكن التراجع عن هذا الإجراء.`
            : ""
        }
        confirmLabel="حذف"
        destructive
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

// ── States ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <Card className="glass rounded-[32px] border-uqu-accent/20 bg-uqu-accent/[0.04] p-12 flex flex-col items-center gap-5 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsla(245,78%,62%,0.2),transparent_70%)] pointer-events-none" />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        className="w-20 h-20 rounded-2xl bg-uqu-accent/15 border border-uqu-accent/40 flex items-center justify-center text-uqu-accent shadow-[0_0_40px_-4px_hsla(245,78%,62%,0.6)]"
      >
        <Brain className="w-10 h-10" />
      </motion.div>
      <div className="text-center space-y-2 relative">
        <h3 className="text-lg font-bold">🧠 الذكاء الاصطناعي يحلل جدولك وموادك...</h3>
        <p className="text-sm text-muted max-w-md leading-relaxed">
          نجدول جلسات مراجعة أسبوعية داخل وقت ذروتك الذهنية (حوالي 45–90 دقيقة لكل جلسة) مع
          تجنب تعارض المحاضرات. قد يستغرق ذلك حتى دقيقة.
        </p>
      </div>
      <div className="flex gap-2 mt-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-2 h-2 rounded-full bg-uqu-accent"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </Card>
  );
}

function EmptyState({
  onGenerate,
  disabled,
}: {
  onGenerate: () => void;
  disabled: boolean;
}) {
  return (
    <Card className="glass rounded-[32px] border-dashed border-foreground/10 p-12 flex flex-col items-center text-center gap-5">
      <div className="w-16 h-16 rounded-2xl bg-uqu-accent/10 border border-uqu-accent/30 flex items-center justify-center text-uqu-accent">
        <Wand2 className="w-7 h-7" />
      </div>
      <div className="space-y-2 max-w-md">
        <h3 className="text-lg font-bold">جاهز لتوليد جلسات المراجعة الأسبوعية</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          سيستخدم المساعد موادك ومحاضراتك وتفضيلاتك لاقتراح جلسات مراجعة موزّعة على الأسبوع —
          ويمكنك إضافة جلسات يدوياً لاحقاً.
        </p>
      </div>
      <Button
        onClick={onGenerate}
        disabled={disabled}
        className="rounded-2xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 px-6 py-5 font-bold"
      >
        <Sparkles className="w-4 h-4" />
        توليد جلسات المراجعة
      </Button>
    </Card>
  );
}

function PrerequisiteCard({
  title,
  description,
  icon,
  href,
  cta,
  tone = "warn",
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  cta: string;
  tone?: "warn" | "info";
}) {
  const palette =
    tone === "warn"
      ? {
          border: "border-amber-500/30",
          bg: "bg-amber-500/[0.05]",
          icon: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          btn: "bg-amber-500 hover:bg-amber-600 text-black",
        }
      : {
          border: "border-uqu-cyan/30",
          bg: "bg-uqu-cyan/[0.05]",
          icon: "bg-uqu-cyan/15 text-uqu-cyan border-uqu-cyan/30",
          btn: "bg-uqu-cyan hover:bg-uqu-cyan/90 text-black",
        };
  return (
    <Card
      className={cn(
        "rounded-2xl p-5 flex items-center gap-4 flex-wrap",
        palette.border,
        palette.bg,
      )}
    >
      <div
        className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center border shrink-0",
          palette.icon,
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-[200px]">
        <h3 className="text-sm font-bold mb-0.5">{title}</h3>
        <p className="text-xs text-muted leading-relaxed">{description}</p>
      </div>
      <a
        href={href}
        className={cn(
          "rounded-xl px-4 py-2 text-sm font-bold transition-colors shrink-0",
          palette.btn,
        )}
      >
        {cta}
      </a>
    </Card>
  );
}

function SidebarStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
        {label}
      </div>
      <div className="text-base font-black font-mono">{value}</div>
    </div>
  );
}

function PrefRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-muted">{label}</span>
      <span className={cn("font-bold text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}

// ── Preference label helpers ──────────────────────────────────────────

function energyPeakLabel(v: string): string {
  return { morning: "صباحي", afternoon: "مسائي", night: "ليلي" }[v] || v;
}
function strategyLabel(v: string): string {
  return { eat_frog: "أكل الضفدع", snowball: "كرة الثلج" }[v] || v;
}
function dayOffLabel(v: string): string {
  return (
    {
      sunday: "الأحد",
      monday: "الإثنين",
      tuesday: "الثلاثاء",
      wednesday: "الأربعاء",
      thursday: "الخميس",
      friday: "الجمعة",
      saturday: "السبت",
      none: "بدون",
    }[v] || v
  );
}

// Lucide Coffee isn't used directly but exported for the upcoming break-state
// integration; silence unused-import lint without removing the import.
void Coffee;
