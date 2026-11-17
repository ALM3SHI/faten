"use client";

/**
 * Hand-drawn marks in the "student notebook" style: an underline, a loop
 * around a word, an arrow, a tick. Each is an SVG stroke that draws itself
 * once, the first time it scrolls into view (styles in globals.css, `.sketch`).
 *
 * - The static HTML ships every stroke fully drawn: no JS, no hidden content.
 * - With reduced motion nothing animates; the marks are simply there.
 * - Decorative: always aria-hidden. Meaning stays in the text around them.
 * - One meaningful motion per screen (phase 6 rule): use them sparingly.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Draws the element's strokes when it first becomes visible. */
function useDrawOnView<T extends Element>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.setAttribute("data-sketch", "wait");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.setAttribute("data-sketch", "draw");
        io.disconnect();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  pathLength: 1,
};

/** A wobbly highlighter line under its children. Colour via `className` (text-*). */
export function SketchUnderline({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useDrawOnView<SVGSVGElement>();
  return (
    <span className="relative inline-block">
      {children}
      <svg
        ref={ref}
        aria-hidden
        className={cn("sketch pointer-events-none absolute inset-x-0 -bottom-[0.18em] h-[0.32em] w-full text-brand", className)}
        viewBox="0 0 200 12"
        preserveAspectRatio="none"
      >
        <path {...STROKE} strokeWidth={4} vectorEffect="non-scaling-stroke" d="M3 8 C 40 3, 90 11, 130 6 S 185 4, 197 7" />
      </svg>
    </span>
  );
}

/** A loose hand-drawn loop around its children (a number, a word). */
export function SketchCircle({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useDrawOnView<SVGSVGElement>();
  return (
    // The loop reaches past the text, so the wrapper keeps that much room around it.
    <span className="relative mx-[0.35em] inline-block px-[0.2em]">
      {children}
      <svg
        ref={ref}
        aria-hidden
        className={cn("sketch pointer-events-none absolute -inset-x-[0.35em] -inset-y-[0.3em] h-[calc(100%+0.6em)] w-[calc(100%+0.7em)] text-brand", className)}
        viewBox="0 0 100 60"
        preserveAspectRatio="none"
      >
        <path
          {...STROKE}
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
          d="M52 5 C 80 3, 97 15, 96 31 C 95 48, 72 57, 47 56 C 20 55, 3 45, 4 29 C 5 14, 25 5, 60 8"
        />
      </svg>
    </span>
  );
}

/** A curved arrow. Points left by default (reading direction is RTL). */
export function SketchArrow({ className, flip = false }: { className?: string; flip?: boolean }) {
  const ref = useDrawOnView<SVGSVGElement>();
  return (
    <svg
      ref={ref}
      aria-hidden
      className={cn("sketch h-8 w-16 text-brand", flip && "-scale-x-100", className)}
      viewBox="0 0 80 40"
    >
      <path {...STROKE} strokeWidth={2.5} d="M76 8 C 60 30, 30 34, 8 24" />
      <path {...STROKE} strokeWidth={2.5} d="M18 16 L 7 24 L 19 31" />
    </svg>
  );
}

/** A quick hand-drawn tick. Draws when it mounts in view: mount it when the thing is done. */
export function SketchCheck({ className }: { className?: string }) {
  const ref = useDrawOnView<SVGSVGElement>();
  return (
    <svg ref={ref} aria-hidden className={cn("sketch size-6 text-success-ink", className)} viewBox="0 0 24 24">
      <path {...STROKE} strokeWidth={2.8} d="M4 13 C 6 15, 8 17, 10 19 C 13 13, 16 9, 21 5" />
    </svg>
  );
}
