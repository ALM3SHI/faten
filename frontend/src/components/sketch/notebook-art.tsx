"use client";

/**
 * Empty-state drawings in the notebook style: a ruled page and a doodle, in
 * the design tokens' colours so both themes work. Decorative (aria-hidden);
 * the empty state's own words carry the meaning. They draw themselves in once
 * when seen (see components/sketch), and are simply there with reduced motion.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function Page({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.setAttribute("data-sketch", "wait");
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      el.setAttribute("data-sketch", "draw");
      io.disconnect();
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <svg ref={ref} aria-hidden viewBox="0 0 160 110" className={cn("illustration sketch h-24 w-36", className)} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* the page: a slight tilt, a ruled margin and lines */}
      <g transform="rotate(-3 80 55)">
        <rect x="30" y="10" width="100" height="90" rx="6" className="fill-surface stroke-line-strong" strokeWidth="2" />
        <path d="M46 12 V 98" className="stroke-danger-line" strokeWidth="1.5" pathLength={1} />
        <path d="M34 30 H 126 M34 44 H 126 M34 58 H 126 M34 72 H 126 M34 86 H 126" className="stroke-line" strokeWidth="1.2" pathLength={1} />
      </g>
      {children}
    </svg>
  );
}

const DOODLE = { className: "stroke-brand", strokeWidth: 2.5, pathLength: 1 } as const;

/** A day with nothing scheduled: a cup of tea on the page. */
export function RestDayArt({ className }: { className?: string }) {
  return (
    <Page className={className}>
      <path {...DOODLE} d="M62 52 H 96 V 70 C 96 80, 88 86, 79 86 C 70 86, 62 80, 62 70 Z" />
      <path {...DOODLE} d="M96 58 C 106 57, 108 70, 96 72" />
      <path {...DOODLE} className="stroke-ink-muted" strokeWidth={2} d="M72 46 C 68 40, 76 37, 72 30 M84 46 C 80 40, 88 37, 84 30" />
    </Page>
  );
}

/** Nothing uploaded yet: a blank page and a pencil ready to write. */
export function BlankLectureArt({ className }: { className?: string }) {
  return (
    <Page className={className}>
      <path {...DOODLE} d="M96 84 L 132 40 L 140 47 L 104 91 L 94 94 Z" />
      <path {...DOODLE} d="M127 46 L 135 53" />
      <path {...DOODLE} className="stroke-ink-muted" strokeWidth={2} d="M54 44 C 62 40, 70 48, 78 44 S 90 40, 96 44" />
    </Page>
  );
}

/** No academic record yet: a page with an empty grade column and a question mark. */
export function EmptyRecordArt({ className }: { className?: string }) {
  return (
    <Page className={className}>
      <path {...DOODLE} className="stroke-ink-muted" strokeWidth={2} d="M58 37 H 90 M58 51 H 84 M58 65 H 92" />
      <path {...DOODLE} d="M104 36 C 104 28, 118 28, 118 36 C 118 43, 110 43, 110 50" />
      <path {...DOODLE} d="M110 58 L 110.5 58.5" />
    </Page>
  );
}
