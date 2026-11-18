"use client";

import { useEffect, useRef, useState } from "react";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The time left in a timed final exam. Counts from the server's deadline
 * (corrected by the clock difference), so leaving the page or another device
 * does not stop it; at zero it tells the page once, which closes the exam.
 */
export function ExamClock({ deadline, skewMs, onTimeUp }: { deadline: string; skewMs: number; onTimeUp: () => void }) {
  const end = new Date(deadline).getTime();
  const left = () => Math.max(0, Math.round((end - (Date.now() + skewMs)) / 1000));
  const [secs, setSecs] = useState(left);
  const fired = useRef(false);

  useEffect(() => {
    const t = window.setInterval(() => setSecs(left()), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, skewMs]);

  useEffect(() => {
    if (secs === 0 && !fired.current) {
      fired.current = true;
      onTimeUp();
    }
  }, [secs, onTimeUp]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const low = secs <= 60;
  return (
    <span
      role="timer"
      aria-label={`الوقت المتبقي في الاختبار ${Math.floor(secs / 60)} دقيقة و${secs % 60} ثانية`}
      className={cn(
        "nums inline-flex h-8 items-center gap-1.5 rounded-control border px-2.5 text-small font-bold",
        low ? "border-danger-line bg-danger-soft text-danger-ink" : "border-info-line bg-info-soft text-info-ink",
      )}
    >
      <Hourglass className="size-3.5" aria-hidden />
      <span aria-hidden>
        {mm}:{ss}
      </span>
    </span>
  );
}
