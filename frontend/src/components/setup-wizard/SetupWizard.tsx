"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EnrichedCourse } from "@/lib/transcript-parser";
import type { ScheduleSlot } from "@/store/scheduleStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { useScheduleStore } from "@/store/scheduleStore";
import { useProfileStore } from "@/store/profileStore";
import { Step1Transcript } from "./Step1Transcript";
import { Step2Schedule } from "./Step2Schedule";
import { Step3Complete } from "./Step3Complete";

/**
 * Academic Setup Wizard — 3-step flow that replaces the disjointed
 * transcript/schedule analyzer pages.
 *
 *   Step 1  Upload transcript (local pdfjs) → filter to current-semester
 *           courses → confirm.
 *   Step 2  Either run Vision schedule extraction OR build the timetable
 *           manually via drag-and-drop using the courses from Step 1.
 *   Step 3  Success summary → commit to Zustand stores → redirect.
 *
 * Both transcript + schedule data are held in the wizard's LOCAL state
 * until Step 3, so the user can back out at any point without polluting
 * the persisted stores.
 */

export type WizardStep = 1 | 2 | 3;
export type ScheduleSource = "vision" | "manual";

interface SetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export function SetupWizard({ isOpen, onClose, onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  // Data held until the final commit on Step 3 — backing out at any
  // earlier step leaves the persisted stores untouched.
  const [currentCourses, setCurrentCourses] = useState<EnrichedCourse[]>([]);
  // ParsedTranscript shape lives in lib/transcript-parser; type kept loose
  // because we just forward it to setTranscript() unchanged at commit time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [transcriptRaw, setTranscriptRaw] = useState<any>(null);
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlot[]>([]);
  const [scheduleSource, setScheduleSource] = useState<ScheduleSource | null>(null);

  const setTranscript = useTranscriptStore((s) => s.setTranscript);
  const setSchedule = useScheduleStore((s) => s.setSchedule);

  // ── Step transitions ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleStep1Confirmed = (parsed: any, courses: EnrichedCourse[]) => {
    setTranscriptRaw(parsed);
    setCurrentCourses(courses);
    setStep(2);
  };

  const handleStep2Done = (slots: ScheduleSlot[], source: ScheduleSource) => {
    setScheduleSlots(slots);
    setScheduleSource(source);
    setStep(3);
  };

  const handleFinalCommit = () => {
    if (transcriptRaw) {
      setTranscript(transcriptRaw);
      // Auto-sync identity + current GPA into the profile store so the
      // dashboard / profile page don't sit empty after a fresh upload.
      // We only patch the fields the transcript can supply, leaving
      // targetGpa, preferences, and any other profile fields untouched.
      const profile = useProfileStore.getState();
      const basicPatch: Partial<{
        name: string;
        major: string;
        studentId: string;
        totalPlanHours: number;
      }> = {};
      const displayName: string | null =
        transcriptRaw.name || transcriptRaw.nameEn || null;
      if (displayName) basicPatch.name = displayName;
      if (transcriptRaw.major) basicPatch.major = transcriptRaw.major;
      if (transcriptRaw.studentId) basicPatch.studentId = transcriptRaw.studentId;
      if (typeof transcriptRaw.planHours === "number" && transcriptRaw.planHours > 0) {
        basicPatch.totalPlanHours = transcriptRaw.planHours;
      }
      if (Object.keys(basicPatch).length > 0) profile.setBasic(basicPatch);

      if (typeof transcriptRaw.gpa === "number" && transcriptRaw.gpa > 0) {
        profile.setGoals({ currentGpa: transcriptRaw.gpa });
      }
    }
    setSchedule(scheduleSlots);
    onComplete?.();
    onClose();
  };

  const handleClose = () => {
    // Reset internal state so re-opening starts fresh.
    setStep(1);
    setCurrentCourses([]);
    setTranscriptRaw(null);
    setScheduleSlots([]);
    setScheduleSource(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="wizard-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            key="wizard-modal"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed inset-4 md:inset-x-auto md:inset-y-12 md:left-1/2 md:-translate-x-1/2 md:w-[min(1100px,calc(100%-2rem))] z-50 bg-card/95 backdrop-blur-2xl border border-foreground/10 rounded-[28px] shadow-2xl flex flex-col overflow-hidden"
            dir="rtl"
            role="dialog"
            aria-label="معالج الإعداد الأكاديمي"
          >
            <StepIndicator step={step} onClose={handleClose} />

            <div className="flex-1 overflow-y-auto p-6 md:p-8 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
              {step === 1 && (
                <Step1Transcript onConfirm={handleStep1Confirmed} />
              )}
              {step === 2 && (
                <Step2Schedule
                  currentCourses={currentCourses}
                  onBack={() => setStep(1)}
                  onDone={handleStep2Done}
                />
              )}
              {step === 3 && (
                <Step3Complete
                  source={scheduleSource}
                  slotsCount={scheduleSlots.length}
                  coursesCount={currentCourses.length}
                  onCommit={handleFinalCommit}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Top progress bar ────────────────────────────────────────────────
function StepIndicator({ step, onClose }: { step: WizardStep; onClose: () => void }) {
  const labels: Array<{ n: WizardStep; title: string; sub: string }> = [
    { n: 1, title: "السجل الأكاديمي", sub: "استخراج مواد الترم الحالي" },
    { n: 2, title: "الجدول الدراسي", sub: "بناء الجدول يدوياً" },
    { n: 3, title: "اكتمل الإعداد", sub: "حفظ والمتابعة" },
  ];

  return (
    <div className="flex items-center justify-between p-5 border-b border-foreground/10 shrink-0">
      <div className="flex items-center gap-3 md:gap-6">
        {labels.map((l, i) => {
          const isDone = step > l.n;
          const isActive = step === l.n;
          return (
            <div key={l.n} className="flex items-center gap-3">
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all shrink-0",
                  isDone
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : isActive
                      ? "bg-uqu-accent text-white shadow-[0_0_18px_hsla(245,78%,62%,0.5)]"
                      : "bg-foreground/5 text-muted border border-foreground/10",
                )}
              >
                {isDone ? <CheckCircle2 className="w-4 h-4" /> : l.n}
              </div>
              <div className="hidden md:flex flex-col">
                <span
                  className={cn(
                    "text-[13px] font-bold tracking-tight",
                    isActive ? "text-foreground" : isDone ? "text-emerald-400" : "text-muted",
                  )}
                >
                  {l.title}
                </span>
                <span className="text-[10px] text-muted font-medium">{l.sub}</span>
              </div>
              {i < labels.length - 1 && (
                <div
                  className={cn(
                    "h-px w-6 md:w-10 transition-colors",
                    step > l.n ? "bg-emerald-500/40" : "bg-foreground/5",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="w-9 h-9 rounded-full hover:bg-foreground/5 text-muted hover:text-foreground shrink-0"
        aria-label="إغلاق"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
