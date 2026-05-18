"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sparkles,
  Brain,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Wand2,
  Calendar,
  Flame,
  Lightbulb,
  GraduationCap,
  Coffee,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranscriptStore } from "@/store/transcriptStore";
import { useScheduleStore, WEEK_DAYS } from "@/store/scheduleStore";
import { useProfileStore } from "@/store/profileStore";
import {
  usePlanStore,
  taskKey,
  type PlanTask,
  type GeneratePlanPayload,
} from "@/store/planStore";

// Friday + Saturday are valid plan days too (the schedule store only
// covers Sun–Thu lecture days, but the AI plan covers the whole week).
const ALL_WEEK_DAYS_AR = [...WEEK_DAYS, "الجمعة", "السبت"];

const PRIORITY_META: Record<
  PlanTask["priority"],
  { label: string; ring: string; chip: string; dot: string }
> = {
  high: {
    label: "أولوية عالية",
    ring: "border-rose-500/40 hover:border-rose-500/60",
    chip: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    dot: "bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]",
  },
  medium: {
    label: "متوسط",
    ring: "border-uqu-accent/30 hover:border-uqu-accent/50",
    chip: "bg-uqu-accent/15 text-uqu-accent border-uqu-accent/30",
    dot: "bg-uqu-accent shadow-[0_0_8px_hsla(245,78%,62%,0.6)]",
  },
  low: {
    label: "خفيف",
    ring: "border-emerald-500/30 hover:border-emerald-500/50",
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]",
  },
};

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
  const clearError = usePlanStore((s) => s.clearError);

  // ── Derived state ─────────────────────────────────────────────────
  const hasTranscript = currentCourses.length > 0;
  const hasSchedule = schedule.length > 0;
  const canGenerate = hasTranscript && !isGenerating;

  // Group tasks by suggestedDay, preserving Sun→Sat order. Days with
  // no tasks are skipped — the UI shouldn't show empty cards for
  // dayOff or untouched weekends.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, PlanTask[]>();
    if (!plan) return map;
    for (const t of plan.tasks) {
      const list = map.get(t.suggestedDay) ?? [];
      list.push(t);
      map.set(t.suggestedDay, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.suggestedTime.localeCompare(b.suggestedTime));
    }
    return map;
  }, [plan]);

  const orderedDays = useMemo(
    () => ALL_WEEK_DAYS_AR.filter((d) => tasksByDay.has(d)),
    [tasksByDay],
  );

  const summaryByDay = useMemo(() => {
    const m = new Map<string, { summary: string; totalMinutes: number }>();
    if (!plan) return m;
    for (const s of plan.dailySummary) {
      m.set(s.day, { summary: s.summary, totalMinutes: s.totalMinutes });
    }
    return m;
  }, [plan]);

  const totalMinutes = useMemo(
    () => (plan ? plan.tasks.reduce((acc, t) => acc + t.durationMinutes, 0) : 0),
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

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-32 px-4 max-w-6xl space-y-8" dir="rtl">
        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-black tracking-tight">خطة المذاكرة الذكية</h1>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-uqu-accent/15 text-uqu-accent border border-uqu-accent/30 inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Gemini AI
              </span>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl">
              خطة أسبوعية يبنيها الذكاء الاصطناعي بناءً على موادك، جدولك، ووقت ذروتك الذهنية —
              مقسّمة على جلسات بومودورو من {preferences.pomodoroFocus} دقيقة.
            </p>
            {generatedAt && (
              <p className="text-[11px] text-muted mt-2 font-mono">
                آخر توليد · {new Date(generatedAt).toLocaleString("ar-SA")}
                {model && <span className="mr-2 px-1.5 py-0.5 rounded bg-foreground/5">{model}</span>}
              </p>
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
                توليد خطة جديدة
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                توليد خطتي الذكية
              </>
            )}
          </Button>
        </header>

        {/* ── Prerequisite gates ──────────────────────────────────── */}
        {!hasTranscript && (
          <PrerequisiteCard
            title="ارفع سجلك الأكاديمي أولاً"
            description="نحتاج قائمة مواد ترمك الحالي حتى يتمكن الذكاء الاصطناعي من بناء خطة مخصصة لك."
            icon={<GraduationCap className="w-6 h-6" />}
            href="/profile"
            cta="انتقل إلى الملف الأكاديمي"
          />
        )}
        {hasTranscript && !hasSchedule && (
          <PrerequisiteCard
            title="جدولك الدراسي غير مهيّأ"
            description="يمكنك المتابعة بدون جدول، لكن الخطة ستكون أدق إذا عرف المساعد متى تكون مشغولاً في المحاضرات."
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
        {isGenerating && <LoadingState pomodoro={preferences.pomodoroFocus} />}

        {/* ── Empty state ─────────────────────────────────────────── */}
        {!isGenerating && !plan && hasTranscript && (
          <EmptyState onGenerate={handleGenerate} disabled={!canGenerate} />
        )}

        {/* ── Plan view ───────────────────────────────────────────── */}
        {!isGenerating && plan && (
          <div className="grid lg:grid-cols-[1fr_320px] gap-6">
            <div className="space-y-6">
              {/* Overview */}
              <Card className="glass rounded-[28px] border-uqu-accent/20 bg-uqu-accent/[0.04] p-6 relative overflow-hidden">
                <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-uqu-accent/20 blur-3xl pointer-events-none" />
                <div className="relative flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-uqu-accent text-foreground flex items-center justify-center shrink-0 shadow-[0_0_18px_hsla(245,78%,62%,0.55)]">
                    <Brain className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-bold mb-1">رؤية الذكاء الاصطناعي للأسبوع</h2>
                    <p className="text-sm text-foreground leading-relaxed">{plan.overview}</p>
                  </div>
                </div>
              </Card>

              {/* Day groups */}
              {orderedDays.length === 0 && (
                <Card className="rounded-2xl border-dashed border-foreground/10 p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    لم يولّد الذكاء الاصطناعي أي مهام — قد تكون أوقاتك الحرة محدودة.
                  </p>
                </Card>
              )}
              {orderedDays.map((day) => (
                <DayGroup
                  key={day}
                  day={day}
                  tasks={tasksByDay.get(day) ?? []}
                  summary={summaryByDay.get(day)}
                  completed={completed}
                  onToggle={toggleTaskDone}
                />
              ))}
            </div>

            {/* Sidebar */}
            <aside className="space-y-4 lg:sticky lg:top-28 h-fit">
              <Card className="glass rounded-2xl border-foreground/10 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-uqu-accent" />
                  <h3 className="font-bold text-sm">تقدّم الخطة</h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted">المهام المنجزة</span>
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
                    value={`${(totalMinutes / 60).toFixed(1)}س`}
                  />
                </div>
              </Card>

              <Card className="glass rounded-2xl border-foreground/10 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-sm">إعداداتك المعتمدة</h3>
                </div>
                <PrefRow label="ذروة الطاقة" value={energyPeakLabel(preferences.energyPeak)} />
                <PrefRow label="الاستراتيجية" value={strategyLabel(preferences.taskStrategy)} />
                <PrefRow label="نمط التعلم" value={learningLabel(preferences.learningStyle)} />
                <PrefRow
                  label="جلسة التركيز"
                  value={`${preferences.pomodoroFocus} د`}
                  mono
                />
                <PrefRow label="يوم الراحة" value={dayOffLabel(preferences.dayOff)} />
              </Card>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

// ── DayGroup ──────────────────────────────────────────────────────────

function DayGroup({
  day,
  tasks,
  summary,
  completed,
  onToggle,
}: {
  day: string;
  tasks: PlanTask[];
  summary: { summary: string; totalMinutes: number } | undefined;
  completed: string[];
  onToggle: (key: string) => void;
}) {
  const doneCount = tasks.filter((t) => completed.includes(taskKey(t))).length;
  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-black tracking-tight">{day}</h3>
          {summary && (
            <p className="text-xs text-muted mt-0.5 leading-relaxed">{summary.summary}</p>
          )}
        </div>
        <div className="text-[11px] font-mono text-muted shrink-0">
          {doneCount}/{tasks.length} · {summary ? `${summary.totalMinutes} د` : ""}
        </div>
      </div>
      <div className="space-y-3">
        {tasks.map((t, idx) => (
          // taskKey() can collide when the model schedules the same course
          // at the same slot twice. Disambiguate the React key with `idx`
          // (taskKey itself is unchanged because it's persisted in the
          // completed[] set — both duplicates intentionally toggle together).
          <TaskCard
            key={`${taskKey(t)}#${idx}`}
            task={t}
            done={completed.includes(taskKey(t))}
            onToggle={() => onToggle(taskKey(t))}
          />
        ))}
      </div>
    </section>
  );
}

// ── TaskCard ──────────────────────────────────────────────────────────

function TaskCard({
  task,
  done,
  onToggle,
}: {
  task: PlanTask;
  done: boolean;
  onToggle: () => void;
}) {
  const meta = PRIORITY_META[task.priority];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <Card
        className={cn(
          "glass rounded-2xl border p-5 transition-all relative overflow-hidden",
          meta.ring,
          done && "opacity-60",
        )}
      >
        <div className="flex items-start gap-4">
          {/* Checkbox */}
          <button
            onClick={onToggle}
            className={cn(
              "w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all shrink-0 mt-0.5",
              done
                ? "bg-uqu-accent border-uqu-accent shadow-[0_0_12px_hsla(245,78%,62%,0.6)]"
                : "border-foreground/10 hover:border-uqu-accent/60",
            )}
            aria-label={done ? "إلغاء الإتمام" : "وضع علامة منجز"}
          >
            {done && <CheckCircle2 className="w-4 h-4 text-foreground" />}
          </button>

          {/* Body */}
          <div className="flex-1 min-w-0 space-y-2.5">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <h4
                className={cn(
                  "font-bold text-[15px] leading-snug",
                  done && "line-through text-muted",
                )}
              >
                {task.title}
              </h4>
              <span
                className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full border inline-flex items-center gap-1 shrink-0",
                  meta.chip,
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                {meta.label}
              </span>
            </div>

            <div className="flex items-center gap-4 text-[11px] text-muted flex-wrap font-mono">
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {task.suggestedTime} · {task.durationMinutes} د
              </span>
              <span className="inline-flex items-center gap-1 text-foreground">
                <GraduationCap className="w-3 h-3" />
                {task.courseCode}
                {task.courseName && (
                  <span className="text-muted font-sans">· {task.courseName}</span>
                )}
              </span>
            </div>

            {task.reason && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-foreground/5 border border-foreground/10">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted leading-relaxed">{task.reason}</p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

// ── States ────────────────────────────────────────────────────────────

function LoadingState({ pomodoro }: { pomodoro: number }) {
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
          نبني خطة أسبوعية تحترم وقت ذروتك الذهنية وتقسّم المذاكرة على جلسات من {pomodoro} دقيقة.
          قد يستغرق ذلك حتى دقيقة.
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
        <h3 className="text-lg font-bold">جاهز لتوليد خطتك الأسبوعية</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          سيستخدم المساعد موادك، أوقات محاضراتك، وتفضيلاتك لرسم خطة دقيقة موزّعة على الأسبوع.
        </p>
      </div>
      <Button
        onClick={onGenerate}
        disabled={disabled}
        className="rounded-2xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 px-6 py-5 font-bold"
      >
        <Sparkles className="w-4 h-4" />
        ابدأ التوليد الآن
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
  return { morning: "🌅 صباحي", afternoon: "🌇 مسائي", night: "🦉 ليلي" }[v] || v;
}
function strategyLabel(v: string): string {
  return { eat_frog: "🐸 أكل الضفدع", snowball: "⛄ كرة الثلج" }[v] || v;
}
function learningLabel(v: string): string {
  return (
    { visual: "👀 بصري", auditory: "🎧 سمعي", kinesthetic: "🏃 حركي", reading: "📖 قرائي" }[v] ||
    v
  );
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
