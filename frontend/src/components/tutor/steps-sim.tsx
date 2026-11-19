"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ds/button";
import { cn } from "@/lib/utils";
import type { StepsVisual } from "@/lib/tutor";

/**
 * A small simulation: the state of a process after each step (a stack after
 * each push and pop, an array during a sort). The student steps through it —
 * or plays it — and sees what each step changed: new items are marked.
 * `stack` draws the items bottom to top (the top is the newest), `row` in a
 * line in reading order.
 */
export function StepsSim({ visual }: { visual: StepsVisual }) {
  const steps = visual.steps;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = steps.length - 1;

  // playing stops by itself at the last step
  const running = playing && i < last;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setI((k) => Math.min(last, k + 1)), 1400);
    return () => window.clearTimeout(t);
  }, [running, i, last]);

  const step = steps[i];
  const before = i > 0 ? steps[i - 1].items : [];
  // an item is "new" when this step added it (more of it than before)
  const count = (xs: string[], x: string) => xs.filter((y) => y === x).length;
  const isNew = step.items.map((x, k) => count(step.items.slice(0, k + 1), x) > count(before, x));
  const items = visual.layout === "stack" ? [...step.items].reverse() : step.items;
  const fresh = visual.layout === "stack" ? [...isNew].reverse() : isNew;

  return (
    <div className="space-y-3" role="group" aria-label={`محاكاة: ${visual.caption || "خطوة بخطوة"}`}>
      <div className="flex items-center justify-between gap-2 text-small">
        <span className="font-bold" aria-live="polite">
          <span className="nums text-ink-muted">الخطوة {i + 1} من {steps.length}: </span>
          <span dir="auto">{step.caption}</span>
        </span>
      </div>

      <div
        className={cn(
          "flex min-h-24 items-center justify-center gap-1.5 rounded-control bg-surface p-3",
          visual.layout === "stack" ? "flex-col justify-end" : "flex-wrap",
        )}
        dir={visual.layout === "row" ? "auto" : undefined}
      >
        {items.length === 0 ? (
          <span className="text-small text-ink-muted">فارغ</span>
        ) : (
          items.map((x, k) => (
            <span
              key={`${i}-${k}`}
              className={cn(
                "nums inline-flex min-w-12 items-center justify-center rounded-control border px-3 py-1.5 text-small font-bold transition-colors motion-reduce:transition-none",
                visual.layout === "stack" && "w-32",
                fresh[k] ? "border-info-line bg-info-soft text-info-ink" : "border-line-strong bg-canvas",
              )}
              dir="auto"
            >
              {x}
              {fresh[k] && <span className="sr-only"> (جديد)</span>}
            </span>
          ))
        )}
        {visual.layout === "stack" && items.length > 0 && <span className="mt-1 h-0.5 w-36 rounded-full bg-line-strong" aria-hidden />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setI((k) => Math.max(0, k - 1))} disabled={i === 0} aria-label="الخطوة السابقة">
          <ChevronRight aria-hidden /> السابقة
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setI((k) => Math.min(last, k + 1))} disabled={i === last} aria-label="الخطوة التالية">
          التالية <ChevronLeft aria-hidden />
        </Button>
        {i === last ? (
          <Button variant="quiet" size="sm" onClick={() => { setPlaying(false); setI(0); }}>
            <RotateCcw aria-hidden /> من البداية
          </Button>
        ) : (
          <Button variant="quiet" size="sm" onClick={() => setPlaying(!running)} aria-pressed={running}>
            {running ? <Pause aria-hidden /> : <Play aria-hidden />} {running ? "إيقاف" : "تشغيل"}
          </Button>
        )}
      </div>
    </div>
  );
}
