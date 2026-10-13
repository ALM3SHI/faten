"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bell, BookOpenCheck, CalendarClock, GraduationCap, MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { tourSteps, type TourIcon } from "@/lib/tour";
import { useTranscriptStore } from "@/store/transcriptStore";

const ICONS: Record<TourIcon, typeof Sparkles> = {
  welcome: Sparkles,
  profile: GraduationCap,
  chat: MessageSquare,
  exams: CalendarClock,
  study: BookOpenCheck,
  notifications: Bell,
};

/** Step-by-step introduction to the main features; closing it at any step counts as done. */
export function WelcomeTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hasRecord = useTranscriptStore((s) => s.completedCourses.length > 0 || s.currentCourses.length > 0);
  const steps = tourSteps({ hasRecord });
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const Icon = ICONS[step.icon];
  // Focus starts on «التالي», not on «تخطي الجولة» (the first button in the DOM).
  const nextRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        dir="rtl"
        showCloseButton={false}
        initialFocus={nextRef}
        className="sm:max-w-md rounded-[28px] p-0 overflow-hidden"
      >
        <div className="px-6 pt-7 pb-5 text-center space-y-4" aria-live="polite">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-uqu-accent/10 border border-uqu-accent/20 flex items-center justify-center">
            <Icon className="w-8 h-8 text-uqu-accent" aria-hidden />
          </div>
          <div className="text-xs font-bold text-muted-foreground">
            {index + 1} من {steps.length}
          </div>
          <DialogTitle className="text-xl font-black">{step.title}</DialogTitle>
          <DialogDescription className="text-sm leading-7 text-foreground/80">{step.body}</DialogDescription>
          {step.link && (
            <Link
              href={step.link.href}
              prefetch={false}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-uqu-accent hover:underline"
            >
              {step.link.label}
              <ArrowLeft className="w-4 h-4" aria-hidden />
            </Link>
          )}
        </div>

        <div className="flex justify-center gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={cn("h-1.5 rounded-full transition-all", i === index ? "w-6 bg-uqu-accent" : "w-1.5 bg-foreground/15")}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-5 mt-1 border-t border-foreground/10">
          {last ? (
            <span />
          ) : (
            <Button variant="ghost" className="rounded-xl text-muted-foreground" onClick={onClose}>
              تخطي الجولة
            </Button>
          )}
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="ghost" className="rounded-xl gap-1" onClick={() => setIndex((i) => i - 1)}>
                <ArrowRight className="w-4 h-4" aria-hidden />
                السابق
              </Button>
            )}
            <Button
              ref={nextRef}
              className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white gap-1 min-w-24"
              onClick={() => (last ? onClose() : setIndex((i) => i + 1))}
            >
              {last ? "يلا نبدأ" : "التالي"}
              {!last && <ArrowLeft className="w-4 h-4" aria-hidden />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
