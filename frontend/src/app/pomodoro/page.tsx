"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  RotateCcw,
  Coffee,
  Brain,
  Zap,
  Volume2,
  VolumeX,
  X,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  usePomodoroStore,
  type PomodoroMode,
} from "@/store/pomodoroStore";
import { useProfileStore } from "@/store/profileStore";
import { usePlanStore } from "@/store/planStore";
import {
  getFocusDurationMinutesForLog,
  getFocusDurationSeconds,
  isPomodoroTestDurationActive,
  logPomodoroSession,
  todayYmd,
} from "@/lib/pomodoro";

export default function PomodoroPage() {
  // ── Pomodoro store ────────────────────────────────────────────────
  const timeLeft = usePomodoroStore((s) => s.timeLeft);
  const timerState = usePomodoroStore((s) => s.timerState);
  const mode = usePomodoroStore((s) => s.mode);
  const activeTask = usePomodoroStore((s) => s.activeTask);
  const completedSessions = usePomodoroStore((s) => s.completedSessions);
  const setTimeLeft = usePomodoroStore((s) => s.setTimeLeft);
  const setTimerState = usePomodoroStore((s) => s.setTimerState);
  const setMode = usePomodoroStore((s) => s.setMode);
  const setActiveTask = usePomodoroStore((s) => s.setActiveTask);
  const incrementSession = usePomodoroStore((s) => s.incrementSession);

  // ── Preferences ───────────────────────────────────────────────────
  const pomodoroFocus = useProfileStore((s) => s.preferences.pomodoroFocus);
  const pomodoroShortBreak = useProfileStore((s) => s.preferences.pomodoroShortBreak);
  const pomodoroLongBreak = useProfileStore((s) => s.preferences.pomodoroLongBreak);

  const isRunning = timerState === "running";
  const canEditDuration = !isRunning;

  const MIN_DURATION_MINUTES = 1;
  const MAX_DURATION_MINUTES = 180;

  // ── Local UI state ────────────────────────────────────────────────
  const [muted, setMuted] = useState(false);
  const [minutesDraft, setMinutesDraft] = useState<string | null>(null);
  // SSR/hydration guard for the timer value — useProfileStore is
  // persisted, so the first paint can show stale defaults before
  // rehydration. Show "--:--" until the client takes over.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (isRunning) setMinutesDraft(null);
  }, [isRunning]);

  useEffect(() => {
    setMinutesDraft(null);
  }, [mode]);

  useEffect(() => {
    if (!hydrated || !isPomodoroTestDurationActive()) return;
    if (mode === "focus" && timerState === "idle") {
      setTimeLeft(
        getFocusDurationSeconds(activeTask?.durationMinutes ?? pomodoroFocus),
      );
    }
  }, [
    hydrated,
    mode,
    timerState,
    activeTask,
    pomodoroFocus,
    setTimeLeft,
  ]);

  // ── Default duration helper (in seconds) ──────────────────────────
  // For focus mode, an active task's duration overrides the profile
  // default — the user opted into a specific session length.
  const modeDuration = (m: PomodoroMode): number => {
    if (m === "focus") {
      return getFocusDurationSeconds(activeTask?.durationMinutes ?? pomodoroFocus);
    }
    if (m === "shortBreak") return pomodoroShortBreak * 60;
    return pomodoroLongBreak * 60;
  };

  // ── Countdown engine ──────────────────────────────────────────────
  // The completion handler captures a lot of state that changes during
  // a session (mode, activeTask, completedSessions, muted). To keep
  // the running interval from going stale we stash the freshest
  // version in a ref and call it through that.
  const handleCompleteRef = useRef<() => void>(() => {});
  handleCompleteRef.current = () => {
    setTimerState("idle");
    if (!muted) playBeep();

    if (mode === "focus") {
      // Mark the linked plan task done in the global plan store. If
      // there's no linked task (free focus session), this is a no-op.
      if (activeTask?.planTaskKey) {
        usePlanStore.getState().toggleTaskDone(activeTask.planTaskKey);
      }
      // Clear the active task — break time isn't tied to any specific
      // study session, and the user can launch a new task afterwards.
      setActiveTask(null);

      // Increment first, then decide which break to switch to. Standard
      // Pomodoro: long break after every 4th focus session.
      const justFinished = completedSessions + 1;
      incrementSession();
      const durationMin = getFocusDurationMinutesForLog(
        activeTask?.durationMinutes ?? pomodoroFocus,
      );
      void logPomodoroSession({
        courseCode: activeTask?.courseCode ?? "",
        courseName: activeTask?.courseName ?? activeTask?.title ?? "مذاكرة عامة",
        duration: durationMin,
        type: "focus",
        date: todayYmd(),
        completedAt: new Date().toISOString(),
      }).catch((err) => {
        console.error("[pomodoro] logPomodoroSession failed:", err);
      });
      const nextMode: PomodoroMode =
        justFinished > 0 && justFinished % 4 === 0 ? "longBreak" : "shortBreak";
      setMode(nextMode);
      setTimeLeft(
        (nextMode === "longBreak" ? pomodoroLongBreak : pomodoroShortBreak) * 60,
      );
    } else {
      // Break → next focus block.
      setMode("focus");
      setTimeLeft(getFocusDurationSeconds(pomodoroFocus));
    }
  };

  // The interval itself only depends on whether the timer is running.
  // We deliberately don't list other deps — completion is routed
  // through the ref above so the interval body stays stable.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          // Stop the clock and fire completion AFTER the state
          // update lands, so handleComplete sees the final 0.
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setTimeout(() => handleCompleteRef.current(), 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // ── Controls ──────────────────────────────────────────────────────
  const toggleTimer = () => {
    if (timeLeft <= 0) {
      // Edge case: timer hit 0 but user wants to start again — reset
      // to the current mode's default first.
      setTimeLeft(modeDuration(mode));
    }
    setTimerState(isRunning ? "paused" : "running");
  };

  const resetTimer = () => {
    setTimerState("idle");
    setTimeLeft(modeDuration(mode));
  };

  const switchMode = (next: PomodoroMode) => {
    setTimerState("idle");
    setMode(next);
    setTimeLeft(modeDuration(next));
  };

  // Clear without resetting the timer per spec — user might want to
  // keep counting down even though the link is gone.
  const clearActiveTask = () => setActiveTask(null);

  const secondsToMinutes = (seconds: number) =>
    Math.min(
      MAX_DURATION_MINUTES,
      Math.max(MIN_DURATION_MINUTES, Math.ceil(Math.max(0, seconds) / 60)),
    );

  const commitDurationMinutes = (raw: string) => {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setMinutesDraft(null);
      return;
    }
    const clamped = Math.min(
      MAX_DURATION_MINUTES,
      Math.max(MIN_DURATION_MINUTES, parsed),
    );
    setTimeLeft(clamped * 60);
    setMinutesDraft(null);
  };

  const durationMinutesDisplay =
    minutesDraft ?? String(secondsToMinutes(timeLeft));

  // ── Visual mode tokens ────────────────────────────────────────────
  const isBreak = mode !== "focus";
  const isLongBreak = mode === "longBreak";

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      <div className="aurora">
        <div
          className={cn(
            "aurora-blob blob-1 opacity-20 transition-colors duration-1000",
            isBreak ? "bg-emerald-500/20" : "bg-uqu-accent/20",
          )}
        />
        <div
          className={cn(
            "aurora-blob blob-2 opacity-20 transition-colors duration-1000",
            isBreak ? "bg-teal-500/20" : "bg-uqu-cyan/20",
          )}
        />
      </div>

      <main className="container mx-auto pt-32 px-4 flex flex-col items-center">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black mb-4">بومودورو</h1>
          <p className="text-muted-foreground">
            استخدم تقنية البومودورو لزيادة تركيزك وإنجاز مهامك الأكاديمية.
          </p>
        </div>

        {/* ── Active task card (or free-session text) ─────────────── */}
        <div className="w-full max-w-xl mb-6">
          <AnimatePresence mode="wait">
            {activeTask && mode === "focus" ? (
              <motion.div
                key="active-task"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="glass rounded-2xl border-uqu-accent/30 bg-uqu-accent/[0.05] p-4 relative overflow-hidden">
                  <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-uqu-accent/20 blur-3xl pointer-events-none" />
                  <div className="relative flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-uqu-accent/15 border border-uqu-accent/30 flex items-center justify-center text-uqu-accent shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-uqu-accent">
                          مهمة نشطة
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-uqu-accent/15 text-uqu-accent border border-uqu-accent/30 font-mono">
                          {activeTask.courseCode}
                        </span>
                        {activeTask.courseName && (
                          <span className="text-[10px] text-muted truncate">
                            · {activeTask.courseName}
                          </span>
                        )}
                      </div>
                      <h2 className="font-bold text-[15px] leading-snug truncate">
                        {activeTask.title}
                      </h2>
                      <p className="text-[11px] text-muted mt-0.5 font-mono">
                        {activeTask.durationMinutes} دقيقة · جلسة بومودورو واحدة
                      </p>
                    </div>
                    <button
                      onClick={clearActiveTask}
                      className="text-muted hover:text-foreground text-[11px] font-bold inline-flex items-center gap-1 shrink-0 px-2 py-1 rounded-lg hover:bg-foreground/5 transition-colors"
                      aria-label="إلغاء الارتباط بالمهمة"
                    >
                      <X className="w-3 h-3" />
                      إلغاء الارتباط
                    </button>
                  </div>
                </Card>
              </motion.div>
            ) : mode === "focus" ? (
              <motion.div
                key="free-session"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center justify-center gap-2 text-muted text-sm font-bold"
              >
                <Sparkles className="w-4 h-4" />
                جلسة تركيز
              </motion.div>
            ) : (
              <motion.div
                key="break-banner"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-bold"
              >
                <Coffee className="w-4 h-4" />
                {isLongBreak ? "وقت استراحة طويلة" : "وقت استراحة"}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Timer card ─────────────────────────────────────────── */}
        <Card className="glass p-12 rounded-[48px] border-foreground/10 flex flex-col items-center gap-10 w-full max-w-xl shadow-2xl relative overflow-hidden">
          {/* Mode switcher */}
          <div className="flex bg-foreground/5 p-1.5 rounded-2xl relative z-10">
            <ModeBtn label="تركيز" active={mode === "focus"} accent="uqu" onClick={() => switchMode("focus")} />
            <ModeBtn
              label="استراحة"
              active={mode === "shortBreak"}
              accent="emerald"
              onClick={() => switchMode("shortBreak")}
            />
            <ModeBtn
              label="استراحة طويلة"
              active={mode === "longBreak"}
              accent="teal"
              onClick={() => switchMode("longBreak")}
            />
          </div>

          {/* Timer display */}
          <div className="relative flex flex-col items-center gap-3">
            <div
              className={cn(
                "text-[120px] font-black tracking-tighter leading-none select-none font-mono transition-colors",
                isBreak ? "text-emerald-400" : "text-foreground",
              )}
            >
              {hydrated ? formatTime(timeLeft) : "--:--"}
            </div>
            {hydrated && canEditDuration && (
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <label htmlFor="pomodoro-duration-minutes" className="sr-only">
                  المدة بالدقائق
                </label>
                <input
                  id="pomodoro-duration-minutes"
                  type="number"
                  inputMode="numeric"
                  min={MIN_DURATION_MINUTES}
                  max={MAX_DURATION_MINUTES}
                  step={1}
                  value={durationMinutesDisplay}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^\d]/g, "");
                    setMinutesDraft(next);
                    if (next !== "") {
                      commitDurationMinutes(next);
                    }
                  }}
                  onBlur={() => {
                    if (minutesDraft === null || minutesDraft === "") {
                      setMinutesDraft(null);
                      return;
                    }
                    commitDurationMinutes(minutesDraft);
                  }}
                  className="w-16 rounded-xl border border-foreground/10 bg-foreground/5 px-2 py-1 text-center font-mono text-foreground outline-none focus:border-uqu-accent/40"
                  aria-label="المدة بالدقائق"
                />
                <span>دقيقة</span>
              </div>
            )}
            <div className="absolute -top-4 -right-4">
              {mode === "focus" ? (
                <Brain
                  className={cn(
                    "w-8 h-8 text-uqu-accent",
                    isRunning && "animate-pulse",
                  )}
                />
              ) : (
                <Coffee
                  className={cn(
                    "w-8 h-8 text-emerald-500",
                    isRunning && "animate-bounce",
                  )}
                />
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-6">
            <Button
              onClick={resetTimer}
              variant="outline"
              className="w-16 h-16 rounded-3xl border-foreground/10 glass text-muted-foreground hover:text-foreground"
              aria-label="إعادة الضبط"
            >
              <RotateCcw className="w-6 h-6" />
            </Button>

            <Button
              onClick={toggleTimer}
              className={cn(
                "w-24 h-24 rounded-[32px] shadow-2xl transition-all scale-110",
                isBreak
                  ? "bg-emerald-500 hover:bg-emerald-500/90 shadow-emerald-500/20"
                  : "bg-uqu-accent hover:bg-uqu-accent/90 shadow-uqu-accent/20",
              )}
              aria-label={isRunning ? "إيقاف مؤقت" : "تشغيل"}
            >
              {isRunning ? (
                <Pause className="w-10 h-10 fill-white" />
              ) : (
                <Play className="w-10 h-10 fill-white ml-1" />
              )}
            </Button>

            <Button
              onClick={() => setMuted(!muted)}
              variant="outline"
              className="w-16 h-16 rounded-3xl border-foreground/10 glass text-muted-foreground hover:text-foreground"
              aria-label={muted ? "تشغيل الصوت" : "كتم الصوت"}
            >
              {muted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </Button>
          </div>

          {/* Session counter */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground/5 border border-foreground/10 text-xs font-bold text-muted-foreground">
            <Zap className="w-3 h-3 text-amber-500" />
            <span>
              أكملت {completedSessions}{" "}
              {completedSessions === 1 ? "جلسة تركيز" : "جلسات تركيز"} اليوم!
            </span>
            {completedSessions >= 4 && (
              <span className="text-emerald-400 mr-1">
                · 🏆 استحقيت {Math.floor(completedSessions / 4)} استراحة طويلة
              </span>
            )}
          </div>

        </Card>

        {/* Tips */}
        <div className="grid md:grid-cols-3 gap-6 mt-16 max-w-4xl w-full">
          <TipCard
            title={`قاعدة ${pomodoroFocus}:${pomodoroShortBreak}`}
            desc={`${pomodoroFocus} دقيقة من العمل العميق تليها ${pomodoroShortBreak} دقائق من الراحة التامة.`}
          />
          <TipCard
            title="الاستراحة الحقيقية"
            desc="ابتعد عن الشاشات تماماً خلال وقت الاستراحة لتحفيز عقلك."
          />
          <TipCard
            title="تجنب المشتتات"
            desc="أغلق إشعارات الجوال وضع هاتفك بعيداً عن منطقة الدراسة."
          />
        </div>
      </main>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Short pleasant chime via the Web Audio API — no external asset
 * required, no CORS, no network call. Falls through silently on
 * browsers that block audio without a user gesture.
 */
function playBeep() {
  if (typeof window === "undefined") return;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const tones = [880, 660]; // two-note descent — "ding-dong" feel
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.start(start);
      osc.stop(start + 0.45);
    });
    // Close after a beat so we don't leak audio contexts.
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* user-gesture missing or audio blocked — no-op */
  }
}

// ── Sub-components ─────────────────────────────────────────────────────

function ModeBtn({
  label,
  active,
  accent,
  onClick,
}: {
  label: string;
  active: boolean;
  accent: "uqu" | "emerald" | "teal";
  onClick: () => void;
}) {
  const accentClass =
    accent === "uqu"
      ? "bg-uqu-accent text-foreground shadow-lg shadow-uqu-accent/20"
      : accent === "emerald"
        ? "bg-emerald-500 text-foreground shadow-lg shadow-emerald-500/20"
        : "bg-teal-500 text-foreground shadow-lg shadow-teal-500/20";

  return (
    <button
      onClick={onClick}
      className={cn(
        "px-5 py-2 rounded-xl text-[12px] font-bold transition-all whitespace-nowrap",
        active ? accentClass : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function TipCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="glass p-6 rounded-[28px] border-foreground/10 space-y-2">
      <h4 className="font-bold text-sm text-uqu-accent">{title}</h4>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
