"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye,
  Hand,
  Upload,
  FileText,
  ArrowLeft,
  Loader2,
  Sparkles,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Calendar,
  Clock,
  MapPin,
  GraduationCap,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/api";
import type { EnrichedCourse } from "@/lib/transcript-parser";
import { useScheduleStore, WEEK_DAYS, type ScheduleSlot } from "@/store/scheduleStore";
import { ManualScheduleBuilder } from "./ManualScheduleBuilder";

interface Step2Props {
  currentCourses: EnrichedCourse[];
  onBack: () => void;
  onDone: (slots: ScheduleSlot[], source: "vision" | "manual") => void;
}

// "summary"   — render the saved schedule (initial view when store has data)
// "selection" — render the two build-method cards (Vision / Manual)
// "vision"    — upload PDF and let Gemini parse
// "manual"    — drag-and-drop builder
type ViewMode = "summary" | "selection" | "vision" | "manual";

/**
 * Step 2 — Schedule.
 *
 * Two entry paths:
 *   • Returning user (useScheduleStore.schedule already populated):
 *     Land on the SummaryView showing the saved timetable grouped by day.
 *     They can confirm and move to Step 3, or click "إعادة بناء الجدول"
 *     to open the manual builder directly.
 *   • First-time setup (store empty):
 *     Land directly on ManualScheduleBuilder.
 *
 * The Summary view's "Next" button reuses the existing schedule slots
 * and passes "manual" as the source — the schedule isn't being rebuilt,
 * just re-confirmed, so the wizard's final commit becomes a no-op
 * overwrite of the same data.
 */
export function Step2Schedule({ currentCourses, onBack, onDone }: Step2Props) {
  // Pull the saved schedule (committed in a previous wizard run) from the
  // store. We deliberately do NOT subscribe to lastUpdated changes —
  // editing the schedule mid-wizard goes through local state in
  // ManualScheduleBuilder, not the store.
  const savedSchedule = useScheduleStore((s) => s.schedule);
  const savedLastUpdated = useScheduleStore((s) => s.lastUpdated);

  // Initial view: summary if we already have a saved schedule, otherwise
  // the manual builder. useState init function — runs once on mount.
  const [mode, setMode] = useState<ViewMode>(() =>
    savedSchedule.length > 0 ? "summary" : "manual",
  );

  const backFromManual = () =>
    savedSchedule.length > 0 ? setMode("summary") : onBack();

  // ── Manual sub-flow (default for first-time setup) ────────────────
  if (mode === "manual") {
    return (
      <ManualScheduleBuilder
        currentCourses={currentCourses}
        onBack={backFromManual}
        onSave={(slots) => onDone(slots, "manual")}
      />
    );
  }

  // ── Summary view (saved-schedule landing) ───────────────────────
  if (mode === "summary") {
    return (
      <SummaryView
        schedule={savedSchedule}
        lastUpdated={savedLastUpdated}
        onRebuild={() => setMode("manual")}
        onNext={() => onDone(savedSchedule, "manual")}
        onBackToStep1={onBack}
      />
    );
  }

  // Legacy selection/vision modes — unreachable from the wizard UI; fall
  // back to manual so stale state never surfaces the AI chooser.
  return (
    <ManualScheduleBuilder
      currentCourses={currentCourses}
      onBack={backFromManual}
      onSave={(slots) => onDone(slots, "manual")}
    />
  );
}

// ── Summary view ─────────────────────────────────────────────────────

function SummaryView({
  schedule,
  lastUpdated,
  onRebuild,
  onNext,
  onBackToStep1,
}: {
  schedule: ScheduleSlot[];
  lastUpdated: string | null;
  onRebuild: () => void;
  onNext: () => void;
  onBackToStep1: () => void;
}) {
  // Group slots by day, preserving WEEK_DAYS order. Days with no
  // entries are skipped — Friday/Saturday are typically empty for UQU
  // students and don't deserve their own card.
  const byDay = new Map<string, ScheduleSlot[]>();
  for (const day of WEEK_DAYS) byDay.set(day, []);
  for (const slot of schedule) {
    const list = byDay.get(String(slot.day));
    if (list) list.push(slot);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  const populatedDays = WEEK_DAYS.filter((d) => (byDay.get(d) ?? []).length > 0);

  const totalSlots = schedule.length;
  const totalHours = computeTotalHours(schedule);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="space-y-6"
      dir="rtl"
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-2xl font-black tracking-tight">جدولك الدراسي المحفوظ</h2>
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]"
            >
              <ShieldCheck className="w-3 h-3 ml-1" />
              محفوظ
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <strong className="text-emerald-400">{totalSlots}</strong> محاضرة موزعة على{" "}
            <strong className="text-emerald-400">{populatedDays.length}</strong> أيام
            {lastUpdated && (
              <span className="text-muted mr-1">
                · آخر تحديث {new Date(lastUpdated).toLocaleDateString("ar-SA")}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRebuild}
          className="rounded-xl glass border-foreground/10 gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          إعادة بناء الجدول 🔄
        </Button>
      </header>

      {/* Stats strip */}
      <Card className="glass rounded-2xl border-foreground/10 p-4">
        <div className="grid grid-cols-3 gap-3">
          <StatTile
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="أيام دراسة"
            value={String(populatedDays.length)}
          />
          <StatTile
            icon={<GraduationCap className="w-3.5 h-3.5" />}
            label="محاضرات"
            value={String(totalSlots)}
          />
          <StatTile
            icon={<Clock className="w-3.5 h-3.5" />}
            label="ساعات أسبوعية"
            value={`${totalHours.toFixed(1)}س`}
            mono
          />
        </div>
      </Card>

      {/* Day groups */}
      {populatedDays.length === 0 ? (
        <Card className="rounded-2xl border-dashed border-foreground/10 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            الجدول محفوظ لكنه فارغ — أعد بناءه لإضافة المحاضرات.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {populatedDays.map((day) => (
            <DayCard key={day} day={day} slots={byDay.get(day) ?? []} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
        <Button
          variant="ghost"
          onClick={onBackToStep1}
          className="rounded-xl text-muted hover:text-foreground gap-2"
        >
          <ArrowLeft className="w-4 h-4 rotate-180" />
          العودة للخطوة السابقة
        </Button>
        <Button
          onClick={onNext}
          className={cn(
            "rounded-2xl bg-[#0066cc] hover:bg-[#005bb5] gap-2 px-6 py-6 text-base font-bold mr-auto",
            "shadow-[0_0_24px_rgba(0,102,204,0.4)]",
          )}
        >
          التالي: حفظ والمتابعة
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>
    </motion.div>
  );
}

function DayCard({ day, slots }: { day: string; slots: ScheduleSlot[] }) {
  const totalMins = slots.reduce((acc, s) => {
    const dur = diffMinutes(s.start_time, s.end_time);
    return acc + Math.max(0, dur);
  }, 0);

  return (
    <Card className="glass rounded-2xl border-foreground/10 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-uqu-accent/10 border border-uqu-accent/20 flex items-center justify-center text-uqu-accent">
            <Calendar className="w-3.5 h-3.5" />
          </div>
          <h3 className="font-bold text-[15px]">{day}</h3>
        </div>
        <span className="text-[10px] text-muted font-mono">
          {slots.length} محاضرة · {formatHours(totalMins)}
        </span>
      </div>

      <div className="space-y-2">
        {slots.map((s, i) => (
          <SlotRow key={`${s.start_time}-${i}`} slot={s} />
        ))}
      </div>
    </Card>
  );
}

function SlotRow({ slot }: { slot: ScheduleSlot }) {
  const isLab = slot.type === "عملي";
  return (
    <div
      className={cn(
        "rounded-xl p-3 border flex items-start gap-3",
        isLab
          ? "bg-amber-500/[0.06] border-amber-500/20"
          : "bg-[#0066cc]/[0.06] border-[#0066cc]/20",
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
          isLab
            ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
            : "bg-[#0066cc]/15 text-[#0066cc] border border-[#0066cc]/30",
        )}
      >
        {isLab ? <FlaskConical className="w-4 h-4" /> : <GraduationCap className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-[13px] font-bold truncate">
            {slot.course_name || slot.course_code || "—"}
          </span>
          <span className="text-[10px] font-mono text-muted shrink-0">
            {slot.course_code}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted font-mono flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {slot.start_time} – {slot.end_time}
          </span>
          {(slot.building || slot.room) && (
            <span className="inline-flex items-center gap-1 text-muted">
              <MapPin className="w-3 h-3" />
              {[slot.building, slot.room].filter(Boolean).join(" · ")}
            </span>
          )}
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-[9px] font-bold",
              isLab
                ? "bg-amber-500/15 text-amber-300"
                : "bg-[#0066cc]/15 text-[#0066cc]",
            )}
          >
            {isLab ? "عملي" : "نظري"}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn("text-lg font-black", mono && "font-mono")}>{value}</div>
    </div>
  );
}

// ── Selection view (extracted to a component) ──────────────────────────

function SelectionView({
  currentCourses,
  hasSavedSchedule,
  onVision,
  onManual,
  onBackToSummary,
  onBackToStep1,
}: {
  currentCourses: EnrichedCourse[];
  hasSavedSchedule: boolean;
  onVision: () => void;
  onManual: () => void;
  onBackToSummary: () => void;
  onBackToStep1: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="space-y-8"
    >
      <header className="space-y-2">
        <h2 className="text-2xl font-black tracking-tight">
          {hasSavedSchedule ? "إعادة بناء الجدول" : "الخطوة 2 — الجدول الدراسي"}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {hasSavedSchedule ? (
            <>
              ⚠️ سيستبدل الجدول الجديد الجدول المحفوظ حالياً. لدينا{" "}
              <strong className="text-emerald-400">{currentCourses.length}</strong> مادة مسجلة —
              كيف تود إعادة بنائه؟
            </>
          ) : (
            <>
              ممتاز! وجدنا <strong className="text-emerald-400">{currentCourses.length}</strong> مادة
              مسجلة في ترمك الحالي. كيف تود بناء جدولك الأسبوعي؟
            </>
          )}
        </p>
      </header>

      <div className="grid md:grid-cols-5 gap-4">
        {/* Primary: Vision (4/5 cols on desktop = ~80% weight) */}
        <button
          onClick={onVision}
          className={cn(
            "md:col-span-4 text-right p-8 rounded-[32px] transition-all group relative overflow-hidden",
            "bg-gradient-to-br from-[#0066cc]/15 via-[#0066cc]/8 to-cyan-500/10",
            "border border-[#0066cc]/30 hover:border-[#0066cc]/60",
            "shadow-[0_0_40px_rgba(0,102,204,0.15)] hover:shadow-[0_0_60px_rgba(0,102,204,0.3)]",
            "active:scale-[0.99]",
          )}
        >
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-[#0066cc]/20 blur-3xl group-hover:bg-[#0066cc]/30 transition-colors" />
          <div className="relative flex items-start gap-5">
            <div className="w-16 h-16 rounded-2xl bg-[#0066cc] flex items-center justify-center shrink-0 shadow-lg shadow-[#0066cc]/40">
              <Eye className="w-8 h-8 text-foreground" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xl font-black tracking-tight">التحليل البصري الذكي</h3>
                <Sparkles className="w-5 h-5 text-amber-400" />
              </div>
              <p className="text-sm text-muted leading-relaxed mb-3">
                ارفع PDF الجدول وسنستخرج كل المحاضرات بصرياً عبر نموذج ذكاء بصري متعدد الوسائط —
                أيام وأوقات وقاعات بدقة عالية.
              </p>
              <div className="inline-flex items-center gap-2 text-[#0066cc] font-bold text-sm">
                <span>الخيار الموصى به</span>
                <ArrowLeft className="w-4 h-4" />
              </div>
            </div>
          </div>
        </button>

        {/* Secondary: Manual (1/5 cols = ~20% weight) */}
        <button
          onClick={onManual}
          className={cn(
            "md:col-span-1 text-right p-6 rounded-[24px] transition-all",
            "bg-foreground/5 border border-foreground/10 hover:bg-foreground/5 hover:border-foreground/10",
            "flex flex-col items-center text-center gap-3 active:scale-[0.99]",
          )}
        >
          <div className="w-12 h-12 rounded-xl bg-foreground/5 flex items-center justify-center">
            <Hand className="w-6 h-6 text-muted" />
          </div>
          <div>
            <h3 className="text-sm font-bold mb-1">بناء يدوي</h3>
            <p className="text-[11px] text-muted leading-relaxed">سحب وإفلات المواد على الشبكة</p>
          </div>
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <AnimatePresence>
          {hasSavedSchedule && (
            <motion.div
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
            >
              <Button
                variant="ghost"
                onClick={onBackToSummary}
                className="rounded-xl text-muted hover:text-foreground gap-2"
                size="sm"
              >
                <ArrowLeft className="w-4 h-4 rotate-180" />
                عودة للملخص
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <Button
          variant="ghost"
          onClick={onBackToStep1}
          className="rounded-xl text-muted hover:text-foreground gap-2 mr-auto"
        >
          <ArrowLeft className="w-4 h-4 rotate-180" />
          العودة للخطوة السابقة
        </Button>
      </div>
    </motion.div>
  );
}

// ── Vision sub-flow (unchanged behavior) ───────────────────────────────
function VisionUpload({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: (slots: ScheduleSlot[]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) {
      setFile(picked);
      setError(null);
    }
  };

  const run = async () => {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const data = await fetchWithAuth("/api/schedule/analyze-vision", {
        method: "POST",
        body: fd,
      });
      const slots: ScheduleSlot[] = Array.isArray(data?.schedule) ? data.schedule : [];
      if (slots.length === 0) {
        setError("لم نجد أي محاضرات في الملف. جرّب الوضع اليدوي أو ملف PDF آخر.");
        return;
      }
      onDone(slots);
    } catch (err) {
      const e = err as Error;
      setError(e.message || "تعذّر تحليل الجدول. حاول مرة أخرى أو استخدم الوضع اليدوي.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-black tracking-tight mb-1">التحليل البصري للجدول</h2>
          <p className="text-sm text-muted-foreground">
            سيُمرَّر الملف على نموذج بصري متعدد الوسائط يقرأ شبكة الأيام والأوقات كما يراها الإنسان.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onBack}
          size="sm"
          className="rounded-xl glass border-foreground/10 gap-2"
        >
          <ArrowLeft className="w-4 h-4 rotate-180" />
          خيار آخر
        </Button>
      </header>

      {error && (
        <Card className="p-4 border-rose-500/40 bg-rose-500/10 text-rose-400 rounded-2xl text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>{error}</div>
        </Card>
      )}

      {isUploading ? (
        <Card className="glass border-foreground/10 rounded-[32px] p-16 flex flex-col items-center gap-6">
          <Loader2 className="w-12 h-12 text-uqu-accent animate-spin" />
          <p className="text-lg font-bold">⏳ جاري قراءة أوقات المحاضرات بالذكاء البصري...</p>
          <p className="text-xs text-muted-foreground">قد تستغرق العملية 5–15 ثانية.</p>
        </Card>
      ) : (
        <Card
          className="glass border-dashed border-foreground/10 rounded-[32px] p-10 text-center flex flex-col items-center gap-5 hover:border-uqu-accent/30 transition-colors cursor-pointer"
          onClick={() => document.getElementById("wizard-schedule-file")?.click()}
        >
          <div className="w-20 h-20 rounded-3xl bg-uqu-accent/10 flex items-center justify-center">
            <Upload className="w-9 h-9 text-uqu-accent" />
          </div>
          <div>
            <h3 className="text-lg font-bold mb-1">ارفع جدول المحاضرات (PDF)</h3>
            <p className="text-xs text-muted-foreground">انقر للاختيار أو اسحب الملف هنا</p>
          </div>
          <input
            id="wizard-schedule-file"
            type="file"
            className="hidden"
            accept=".pdf"
            onChange={onPick}
          />
          {file && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10">
              <FileText className="w-4 h-4 text-uqu-cyan" />
              <span className="text-sm font-medium truncate max-w-[260px]">{file.name}</span>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  run();
                }}
                size="sm"
                className="mr-2 rounded-lg bg-uqu-accent hover:bg-uqu-accent/90"
              >
                تحليل الآن
              </Button>
            </div>
          )}
        </Card>
      )}
    </motion.div>
  );
}

// ── Time helpers (small + local; not worth extracting to lib/) ──────────

function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return 0;
  return eh * 60 + em - (sh * 60 + sm);
}

function formatHours(mins: number): string {
  if (mins <= 0) return "0س";
  const hours = mins / 60;
  return hours >= 1 ? `${hours.toFixed(1)}س` : `${mins}د`;
}

function computeTotalHours(slots: ScheduleSlot[]): number {
  let total = 0;
  for (const s of slots) total += Math.max(0, diffMinutes(s.start_time, s.end_time));
  return total / 60;
}
