"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
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
import type { EnrichedCourse } from "@/lib/transcript-parser";
import { useScheduleStore, WEEK_DAYS, type ScheduleSlot } from "@/store/scheduleStore";
import { ManualScheduleBuilder } from "./ManualScheduleBuilder";
import { formatDay } from "@/lib/format-date";

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
            <h2 className="text-heading font-bold tracking-tight">جدولك الدراسي المحفوظ</h2>
            <Badge
              variant="outline"
              className="bg-success-soft text-success-ink border-success-line text-caption"
            >
              <ShieldCheck className="w-3 h-3 ml-1" />
              محفوظ
            </Badge>
          </div>
          <p className="text-small text-ink-muted">
            <strong className="text-success-ink">{totalSlots}</strong> محاضرة موزعة على{" "}
            <strong className="text-success-ink">{populatedDays.length}</strong> أيام
            {lastUpdated && (
              <span className="text-ink-muted mr-1">
                · آخر تحديث {formatDay(lastUpdated)}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRebuild}
          className="rounded-control border border-line bg-surface shadow-card gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          إعادة بناء الجدول 🔄
        </Button>
      </header>

      {/* Stats strip */}
      <Card className="border border-line bg-surface shadow-card rounded-card p-4">
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
        <Card className="rounded-card border-dashed border-line p-10 text-center">
          <p className="text-small text-ink-muted">
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
          className="rounded-control text-ink-muted hover:text-ink gap-2"
        >
          <ArrowLeft className="w-4 h-4 rotate-180" />
          العودة للخطوة السابقة
        </Button>
        <Button
          onClick={onNext}
          className={cn(
            "rounded-card bg-brand hover:bg-brand-hover gap-2 px-6 py-6 text-body font-bold mr-auto",
            "",
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
    <Card className="border border-line bg-surface shadow-card rounded-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-control bg-info-soft border border-info-line flex items-center justify-center text-info-ink">
            <Calendar className="w-3.5 h-3.5" />
          </div>
          <h3 className="font-bold text-body">{day}</h3>
        </div>
        <span className="text-caption text-ink-muted font-mono">
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
        "rounded-control p-3 border flex items-start gap-3",
        isLab
          ? "bg-warning-soft border-warning-line"
          : "bg-info-soft border-info-line",
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-control flex items-center justify-center shrink-0",
          isLab
            ? "bg-warning-soft text-warning-ink border border-warning-line"
            : "bg-info-soft text-info-ink border border-info-line",
        )}
      >
        {isLab ? <FlaskConical className="w-4 h-4" /> : <GraduationCap className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-small font-bold truncate">
            {slot.course_name || slot.course_code || "—"}
          </span>
          <span className="text-caption font-mono text-ink-muted shrink-0">
            {slot.course_code}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-caption text-ink-muted font-mono flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {slot.start_time} – {slot.end_time}
          </span>
          {(slot.building || slot.room) && (
            <span className="inline-flex items-center gap-1 text-ink-muted">
              <MapPin className="w-3 h-3" />
              {[slot.building, slot.room].filter(Boolean).join(" · ")}
            </span>
          )}
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-caption font-bold",
              isLab
                ? "bg-warning-soft text-warning-ink "
                : "bg-info-soft text-info-ink",
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
    <div className="rounded-control bg-surface-sunken border border-line p-3">
      <div className="flex items-center gap-1 text-caption font-bold uppercase tracking-wider text-ink-muted mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn("text-subheading font-bold", mono && "font-mono")}>{value}</div>
    </div>
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
