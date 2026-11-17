"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A number that counts up to its value once, when first seen (the GPA on
 * «معدّلي»). The final value is in the HTML from the start; the digits run
 * up for under a second when the number scrolls into view, and not at all
 * with reduced motion or when the value is not a finite number.
 */
export function CountUp({
  value,
  decimals = 0,
  durationMs = 900,
  className,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const final = Number.isFinite(value) ? value.toFixed(decimals) : "—";

  useEffect(() => {
    const el = ref.current;
    // Write into React's own text node, so React keeps owning it.
    const text = el?.firstChild;
    if (!el || !text || text.nodeType !== Node.TEXT_NODE || !Number.isFinite(value) || value === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    let frame = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        text.nodeValue = (value * eased).toFixed(decimals);
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        run();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      text.nodeValue = final;
    };
  }, [value, decimals, durationMs, final]);

  return (
    <span ref={ref} className={cn("nums", className)}>
      {final}
    </span>
  );
}
