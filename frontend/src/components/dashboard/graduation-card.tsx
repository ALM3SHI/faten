"use client";

import { useHydrated } from "@/lib/use-hydrated";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useProfileStore } from "@/store/profileStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { graduationProgress, termsLeftLabel } from "@/lib/graduation";

export function GraduationCard() {
  const mounted = useHydrated();
  const profilePlan = useProfileStore((s) => s.basic.totalPlanHours);
  const transcriptPlan = useTranscriptStore((s) => s.planHours);
  const earned = useTranscriptStore((s) => s.earnedHours);
  const current = useTranscriptStore((s) => s.currentCourses);

  const currentHours = (current ?? []).reduce((n, c) => n + (Number(c.creditHours) || 0), 0);
  const p = graduationProgress({
    planHours: Number(profilePlan) > 0 ? Number(profilePlan) : transcriptPlan,
    earnedHours: earned,
    currentHours,
  });

  return (
    <Card className="glass p-6 md:p-8 rounded-[32px] border-foreground/10 h-full flex flex-col">
      <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
        <GraduationCap className="w-5 h-5 text-uqu-accent" />
        طريقك للتخرج
      </h3>
      {!mounted ? (
        <div className="h-24 rounded-2xl bg-foreground/5 animate-pulse" />
      ) : !p ? (
        <p className="text-sm text-muted-foreground leading-7">
          ارفع سجلك الأكاديمي وحدّد ساعات خطتك من{" "}
          <Link href="/profile" className="text-uqu-accent font-bold hover:underline">الملف الشخصي</Link>{" "}
          لنحسب كم باقي لك للتخرج.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-end justify-between mb-2">
              <span className="text-3xl font-black">{p.percent}%</span>
              <span className="text-xs text-muted-foreground font-mono">
                {p.earned} / {p.planHours} ساعة
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-foreground/10 overflow-hidden flex" aria-hidden>
              <div className="h-full bg-uqu-accent" style={{ width: `${(p.earned / p.planHours) * 100}%` }} />
              <div className="h-full bg-uqu-accent/35" style={{ width: `${(Math.min(p.inProgress, p.remaining) / p.planHours) * 100}%` }} />
            </div>
            <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-uqu-accent" /> مجتازة</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-uqu-accent/35" /> هذا الفصل ({p.inProgress})</span>
            </div>
          </div>
          <div className="text-sm">
            <div className="font-bold">{termsLeftLabel(p)}</div>
            {p.remainingAfterTerm > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                باقي {p.remainingAfterTerm} ساعة بعد هذا الفصل — بمعدل 14 إلى 18 ساعة للفصل.
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
