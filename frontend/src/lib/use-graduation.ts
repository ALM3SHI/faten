"use client";

import { useProfileStore } from "@/store/profileStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { graduationProgress, resolvePlanHours, type GraduationProgress } from "@/lib/graduation";

/** Plan hours from the profile, falling back to the transcript (null if unknown). */
export function usePlanHours(): number | null {
  const profilePlan = useProfileStore((s) => s.basic.totalPlanHours);
  const transcriptPlan = useTranscriptStore((s) => s.planHours);
  return resolvePlanHours(profilePlan, transcriptPlan);
}

/** The student's progress toward graduation, from the shared stores. */
export function useGraduationProgress(): GraduationProgress | null {
  const planHours = usePlanHours();
  const earned = useTranscriptStore((s) => s.earnedHours);
  const current = useTranscriptStore((s) => s.currentCourses);
  const currentHours = (current ?? []).reduce((n, c) => n + (Number(c.creditHours) || 0), 0);
  return graduationProgress({ planHours, earnedHours: earned, currentHours });
}
