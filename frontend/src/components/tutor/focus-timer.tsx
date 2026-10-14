"use client";

import { useEffect, useRef, useState } from "react";
import { Coffee, Pause, Play, Settings2, Square, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  finishPeriod,
  mmss,
  nowWithSkew,
  pauseFocus,
  remainingSec,
  resumeFocus,
  startFocus,
  stopFocus,
  type FocusState,
} from "@/lib/tutor";

/**
 * Optional Pomodoro for the study session. Never blocks the tutor: the
 * student can keep answering during a break. Times are absolute and saved on
 * the server, so a closed tab or another device shows the right time.
 */
export function FocusTimer({
  focus,
  skewMs,
  onChange,
  onFocusCompleted,
}: {
  focus: FocusState;
  skewMs: number;
  onChange: (next: FocusState) => void;
  onFocusCompleted: (minutes: number) => void;
}) {
  const [now, setNow] = useState(() => nowWithSkew(skewMs));
  const [settings, setSettings] = useState(false);
  const finishing = useRef(false);

  const running = focus.mode !== "idle" && !focus.pausedAt;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(nowWithSkew(skewMs)), 1000);
    return () => window.clearInterval(id);
  }, [running, skewMs]);

  const left = remainingSec(focus, focus.mode === "idle" ? now : running ? now : nowWithSkew(skewMs));

  useEffect(() => {
    if (focus.mode === "idle" || focus.pausedAt || left > 0 || finishing.current) return;
    finishing.current = true;
    const { next, completedFocus } = finishPeriod(focus, nowWithSkew(skewMs));
    if (completedFocus) onFocusCompleted(focus.focusMin);
    onChange(next);
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(completedFocus ? "انتهت جلسة التركيز — خذ استراحة قصيرة" : "انتهت الاستراحة — نكمل؟");
      }
    } catch {
      /* notifications unavailable */
    }
  }, [left, focus, skewMs, onChange, onFocusCompleted]);

  useEffect(() => {
    finishing.current = false;
  }, [focus.startedAt, focus.mode]);

  const t = () => nowWithSkew(skewMs);

  return (
    <div className="relative">
      <div className={cn("flex items-center gap-1 h-9 rounded-xl border px-1.5", focus.mode === "break" ? "border-emerald-500/40 bg-emerald-500/10" : focus.mode === "focus" ? "border-uqu-accent/40 bg-uqu-accent/10" : "border-foreground/10")}>
        {focus.mode === "idle" ? (
          <button type="button" onClick={() => onChange(startFocus(focus, t()))} className="flex items-center gap-1.5 px-2 text-[12.5px] font-bold" aria-label="ابدأ جلسة تركيز">
            <Timer className="w-4 h-4 text-uqu-accent" aria-hidden />
            <span className="hidden sm:inline">جلسة تركيز {focus.focusMin} د</span>
            <span className="sm:hidden">{focus.focusMin}:00</span>
          </button>
        ) : (
          <>
            {focus.mode === "break" ? <Coffee className="w-4 h-4 text-emerald-600 mx-1" aria-hidden /> : <Timer className="w-4 h-4 text-uqu-accent mx-1" aria-hidden />}
            <span className="font-mono font-bold text-[13px] tabular-nums" aria-live="off" aria-label={focus.mode === "break" ? "وقت الاستراحة المتبقي" : "وقت التركيز المتبقي"}>
              {mmss(left)}
            </span>
            <button type="button" onClick={() => onChange(focus.pausedAt ? resumeFocus(focus, t()) : pauseFocus(focus, t()))} className="p-1.5 rounded-lg hover:bg-foreground/10" aria-label={focus.pausedAt ? "استئناف المؤقت" : "إيقاف المؤقت مؤقتاً"}>
              {focus.pausedAt ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={() => onChange(stopFocus(focus))} className="p-1.5 rounded-lg hover:bg-foreground/10" aria-label="إنهاء المؤقت">
              <Square className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        <button type="button" onClick={() => setSettings((s) => !s)} className="p-1.5 rounded-lg hover:bg-foreground/10" aria-label="مدة الجلسات" aria-expanded={settings}>
          <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
      {settings && (
        <div className="absolute left-0 top-11 z-30 w-60 rounded-2xl border border-foreground/10 bg-popover p-3 shadow-xl space-y-3 text-[13px]" dir="rtl">
          <Stepper label="التركيز (دقيقة)" value={focus.focusMin} min={5} max={120} step={5} onChange={(v) => onChange({ ...focus, focusMin: v })} />
          <Stepper label="الاستراحة (دقيقة)" value={focus.breakMin} min={1} max={60} step={1} onChange={(v) => onChange({ ...focus, breakMin: v })} />
          <p className="text-[11px] text-muted-foreground leading-5">المؤقت اختياري؛ تقدر تكمل مع المعلم حتى أثناء الاستراحة. الجلسات المكتملة تُسجّل في صفحة البومودورو. ({focus.completedFocus} جلسة في هذه المحاضرة)</p>
        </div>
      )}
    </div>
  );
}

function Stepper({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" className="w-7 h-7 rounded-lg border border-foreground/10" onClick={() => onChange(Math.max(min, value - step))} aria-label={`تقليل ${label}`}>−</button>
        <span className="w-8 text-center font-bold tabular-nums">{value}</span>
        <button type="button" className="w-7 h-7 rounded-lg border border-foreground/10" onClick={() => onChange(Math.min(max, value + step))} aria-label={`زيادة ${label}`}>+</button>
      </div>
    </div>
  );
}
