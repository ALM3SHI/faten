"use client";

import { useEffect, type ReactNode } from "react";
import { ArrowRight, PanelRightClose, PanelRightOpen, ListTree } from "lucide-react";
import { Button } from "@/components/ds/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/** Marks the page as a focus page while mounted (globals.css: no tab bar space). */
export function useFocusPage(): void {
  useEffect(() => {
    document.documentElement.dataset.focus = "";
    return () => {
      delete document.documentElement.dataset.focus;
    };
  }, []);
}

/**
 * The only bar on a lecture page (focus mode): the way back, where you are,
 * ONE progress line along its bottom edge, and the session's tools. It
 * replaces the app's top bar, sidebar and bottom bar while studying.
 */
export function CourseBar({
  title,
  subtitle,
  progress,
  progressLabel,
  onExit,
  outlineOpen,
  onToggleOutline,
  onOpenTopics,
  tools,
}: {
  title: string;
  subtitle: string;
  /** 0..1 — mastered units out of all */
  progress: number;
  progressLabel: string;
  onExit: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onOpenTopics: () => void;
  /** the timer, the chalkboard, pause — rendered ONCE (the timer runs effects); compact on phones */
  tools: ReactNode;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <header className="relative z-40 shrink-0 border-b border-line bg-surface">
      <div className="flex h-14 items-center gap-2 px-2 sm:gap-3 sm:px-4">
        <Button variant="quiet" size="sm" onClick={onExit} className="shrink-0 px-2" aria-label="رجوع إلى محاضراتي">
          <ArrowRight aria-hidden />
          <span className="hidden md:inline">محاضراتي</span>
        </Button>

        {/* desktop: show / hide the course menu */}
        <Button
          variant="quiet"
          size="sm"
          onClick={onToggleOutline}
          aria-pressed={outlineOpen}
          aria-label={outlineOpen ? "إخفاء محتوى الدورة" : "إظهار محتوى الدورة"}
          className="hidden shrink-0 px-2 lg:inline-flex"
        >
          {outlineOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
        </Button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-small font-bold sm:text-body" dir="auto">
            {title}
          </h1>
          <p className="truncate text-caption text-ink-muted" dir="auto">
            {subtitle}
          </p>
        </div>

        <span className="nums hidden shrink-0 text-small font-bold text-ink-muted md:inline" aria-hidden>
          {progressLabel}
        </span>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">{tools}</div>
        <ThemeToggle className="hidden sm:inline-flex" />

        {/* phones and tablets: the course menu opens as a drawer */}
        <Button variant="quiet" size="sm" onClick={onOpenTopics} className="shrink-0 px-2 lg:hidden" aria-label="محتوى الدورة والإتقان">
          <ListTree aria-hidden />
        </Button>
      </div>

      {/* the one progress line of the page */}
      <div
        className="absolute inset-x-0 -bottom-px h-[3px] bg-transparent"
        role="progressbar"
        aria-label={`تقدّم الدورة: ${progressLabel}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={cn("h-full bg-success-ink transition-[width] duration-700 motion-reduce:transition-none")} style={{ width: `${pct}%` }} />
      </div>
    </header>
  );
}
