"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, RotateCcw, CheckCircle2, Loader2, FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePomodoroStore } from "@/store/pomodoroStore";
import {
  getFocusDurationMinutesForLog,
  getFocusDurationSeconds,
  isPomodoroTestDurationActive,
  logPomodoroSession,
  todayYmd,
} from "@/lib/pomodoro";

interface ConnectedPomodoroProps {
  taskName?: string;
  duration?: number; // in minutes
  density?: "single" | "compact";
}

export function ConnectedPomodoro({
  taskName = "مذاكرة مركزة",
  duration = 25,
  density = "compact"
}: ConnectedPomodoroProps) {
  // Rich layout only when the column has room to breathe (single widget). Otherwise the
  // compact horizontal row keeps the widget short enough to leave space for the sibling.
  const layoutMode: "rich" | "compact" = density === "single" ? "rich" : "compact";
  const totalSeconds = getFocusDurationSeconds(duration);

  const {
    timeLeft, setTimeLeft,
    timerState: state, setTimerState: setState,
    incrementSession, completedSessions
  } = usePomodoroStore();

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isPomodoroTestDurationActive()) return;
    if (state === "idle" || state === "paused") {
      setTimeLeft(getFocusDurationSeconds(duration));
    }
  }, [duration, state, setTimeLeft]);

  useEffect(() => {
    if (state === "running") {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(intervalRef.current!);
            handleSessionComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleSessionComplete = async () => {
    setState("saving");
    incrementSession();
    try {
      await logPomodoroSession({
        courseCode: "",
        courseName: taskName || "مذاكرة عامة",
        duration: getFocusDurationMinutesForLog(duration),
        type: "focus",
        date: todayYmd(),
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[connected-pomodoro] logPomodoroSession failed:", err);
    }
    setState("completed");
  };

  const toggleTimer = () => {
    if (state === "idle" || state === "paused") setState("running");
    else if (state === "running") setState("paused");
  };

  const resetTimer = () => {
    setState("idle");
    setTimeLeft(totalSeconds);
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const progress = timeLeft / totalSeconds; // 1 to 0

  const circumference = 2 * Math.PI * 120; // r=120
  const strokeDashoffset = circumference - progress * circumference;

  // Adaptive UI - Rich View
  if (layoutMode === "rich") {
    return (
      <motion.div layout className="w-full h-fit shrink-0 flex flex-col gap-4" dir="rtl">
        {/* Main Timer Card */}
        <div className="w-full p-6 bg-card border border-foreground/10 rounded-[32px] flex flex-col items-center justify-center gap-6 relative overflow-hidden shadow-2xl">
          <div className="text-center space-y-1 w-full">
            <h3 className="text-xl font-bold text-foreground tracking-tight">{taskName}</h3>
            <p className="text-muted text-sm">جلسة تركيز ({duration} دقيقة)</p>
          </div>
          
          <div className="relative w-64 h-64 flex items-center justify-center shrink-0">
            <AnimatePresence mode="wait">
              {state === "saving" && (
                <motion.div key="saving" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-card/80 backdrop-blur-md rounded-full">
                  <Loader2 className="w-10 h-10 text-[#0066cc] animate-spin" />
                  <p className="text-foreground text-sm font-medium text-center">جاري الحفظ...</p>
                </motion.div>
              )}
              {state === "completed" && (
                <motion.div key="completed" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-card/80 backdrop-blur-md rounded-full">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </div>
                  <p className="text-emerald-400 text-sm font-medium text-center px-4 leading-relaxed">تمت إضافة {duration} دقيقة<br/>لإحصائياتك اليومية</p>
                </motion.div>
              )}
            </AnimatePresence>

            <svg className="w-full h-full transform -rotate-90">
              <circle cx="128" cy="128" r="120" className="text-white/5" stroke="currentColor" strokeWidth="6" fill="transparent" />
              <motion.circle cx="128" cy="128" r="120" className="text-[#0066cc]" stroke="currentColor" strokeWidth="6" fill="transparent" strokeLinecap="round" initial={{ strokeDashoffset: 0 }} animate={{ strokeDashoffset }} transition={{ duration: 0.5, ease: "linear" }} style={{ strokeDasharray: circumference }} />
            </svg>

            <div className="absolute flex flex-col items-center justify-center mt-2">
              <span className={cn("text-5xl font-mono font-black tracking-tighter transition-colors duration-300", state === "running" ? "text-foreground" : "text-muted")}>
                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-4 w-full">
            <div className="flex items-center justify-center gap-4 bg-card/50 p-2 rounded-full border border-foreground/10 mx-auto">
              <button onClick={resetTimer} disabled={state === "saving" || state === "idle"} className="w-12 h-12 rounded-full flex items-center justify-center text-muted hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-30 disabled:hover:bg-transparent">
                <RotateCcw className="w-5 h-5" />
              </button>
              <button onClick={toggleTimer} disabled={state === "saving" || state === "completed"} className="w-14 h-14 rounded-full bg-[#0066cc] flex items-center justify-center text-foreground hover:bg-[#005bb5] transition-all active:scale-95 disabled:opacity-50">
                {state === "running" ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
              </button>
              <div className="w-12 h-12 flex items-center justify-center">
                {state === "running" ? (
                  <span className="flex gap-1 h-4 items-center">
                    <span className="w-1 h-2 bg-[#0066cc] animate-pulse rounded-full" />
                    <span className="w-1 h-4 bg-[#0066cc] animate-pulse rounded-full [animation-delay:0.2s]" />
                    <span className="w-1 h-3 bg-[#0066cc] animate-pulse rounded-full [animation-delay:0.4s]" />
                  </span>
                ) : (
                  <span className="w-1.5 h-1.5 bg-foreground/5 rounded-full" />
                )}
              </div>
            </div>
            {(state === "running" || state === "idle" || state === "paused") && (
              <Button onClick={() => handleSessionComplete()} variant="outline" size="sm" className="mx-auto bg-transparent border-foreground/10 text-muted hover:text-foreground hover:bg-foreground/5 text-[11px] gap-2 rounded-xl mt-2">
                <FastForward className="w-3 h-3" />
                تخطي ومحاكاة الإنتهاء (Test)
              </Button>
            )}
          </div>
        </div>

        {/* Daily Stats Mini Card */}
        <div className="w-full p-5 bg-card border border-foreground/10 rounded-[24px] shadow-lg flex flex-col gap-4">
          <div className="flex items-center justify-between">
             <span className="text-muted text-xs font-bold">التقدم اليومي للتركيز</span>
             <span className="text-[#0066cc] font-bold text-sm">{completedSessions} جلسات</span>
          </div>
          <div className="w-full h-2 bg-foreground/5 rounded-full overflow-hidden">
             <motion.div className="h-full bg-gradient-to-r from-[#0066cc] to-cyan-500 rounded-full" initial={{ width: 0 }} animate={{ width: `${Math.min((completedSessions / 4) * 100, 100)}%` }} transition={{ duration: 1 }} />
          </div>
          <p className="text-muted text-[10px] text-center">أكمل 4 جلسات للحصول على إنجاز اليوم 🏆</p>
        </div>
      </motion.div>
    );
  }

  // Adaptive UI - Compact View
  return (
    <motion.div layout className="w-full h-fit shrink-0 flex flex-row items-center justify-between p-4 bg-card border border-foreground/10 rounded-[24px] gap-4 shadow-lg" dir="rtl">
        <motion.div layout="position" className="flex flex-col items-start gap-1">
          <span className="text-muted text-[11px] font-bold tracking-tight">{taskName}</span>
          <span className={cn(
            "text-3xl font-mono font-black tracking-tighter transition-colors duration-300",
            state === "running" ? "text-foreground" : "text-muted"
          )}>
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </span>
        </motion.div>

        <motion.div layout="position" className="flex items-center gap-2">
          <button 
            onClick={resetTimer}
            disabled={state === "saving" || state === "idle"}
            className="w-10 h-10 rounded-full flex items-center justify-center text-muted hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          
          <button 
            onClick={toggleTimer}
            disabled={state === "saving" || state === "completed"}
            className="w-12 h-12 rounded-full bg-[#0066cc] flex items-center justify-center text-foreground hover:bg-[#005bb5] transition-all active:scale-95 disabled:opacity-50"
          >
            {state === "running" ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
          </button>
        </motion.div>
    </motion.div>
  );
}
