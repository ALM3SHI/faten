"use client";

/**
 * Dashboard analytics — POST /api/analytics/dashboard plus the agentic
 * self-healing dispatch. All analytics math runs on the backend; this hook
 * builds the payload from the Zustand stores, forwards it and exposes the
 * response (or a classified error) to the bento cells.
 */

import { useEffect, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { buildCreditsResolver } from "@/lib/transcript-utils";
import { NON_GPA_GRADES } from "@/lib/grade-scale";
import { usePlanStore, type PlanTask } from "@/store/planStore";
import type { EnrichedCourse } from "@/store/transcriptStore";
import {
  classifyError,
  type AgenticAction,
  type AnalyticsData,
  type AnalyticsError,
} from "@/components/dashboard/analytics";

export function useDashboardAnalytics({
  currentGpa,
  targetGpa,
  earnedHours,
  completedCourses,
  currentCourses,
}: {
  currentGpa: number;
  targetGpa: number;
  earnedHours: number;
  completedCourses: EnrichedCourse[];
  currentCourses: EnrichedCourse[];
}) {
  const { user, loading: authLoading } = useAuth();
  const hydrated = useHydrated();

  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<AnalyticsError | null>(null);

  useEffect(() => {
    if (!hydrated || authLoading || !user) return;
    if (completedCourses.length === 0 || currentGpa <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale analytics when the record empties
      setAnalyticsData(null);
      setAnalyticsError(null);
      return;
    }

    // ── Pre-flight pruning ──
    // Drop courses with missing/invalid grades AND defensively clamp
    // any out-of-range values so a single stale row can't 422 the
    // whole request. The migration boundary catches the rest.
    const payloadCourses = completedCourses
      .filter(
        (c) =>
          c.semesterStatus === "completed" &&
          c.gradePoints != null &&
          c.creditHours > 0 &&
          !!c.grade &&
          !NON_GPA_GRADES.has(c.grade.toUpperCase()),
      )
      .map((c) => ({
        code: c.code,
        // Ship the title so the backend's CS-specific category
        // dispatcher can keyword-match on Arabic / English names — code
        // prefixes alone can't tell "ذكاء اصطناعي" from "هياكل البيانات".
        name: c.nameAr || c.nameEn || c.code,
        credits: c.creditHours,
        grade: c.grade,
        gradePoints: c.gradePoints,
        semester: c.semester,
      }));

    if (payloadCourses.length === 0) {
      setAnalyticsData(null);
      setAnalyticsError(null);
      return;
    }

    // Current-term rows often arrive with `creditHours: 0` (see
    // lib/transcript-utils.ts); resolve them before sending so the
    // High-ROI ranker never receives an empty payload.
    const resolveCurrentCredits = buildCreditsResolver(completedCourses);
    const payloadCurrent = currentCourses.map((c) => ({
      code: c.code,
      name: c.nameAr || c.nameEn || c.code,
      credits: resolveCurrentCredits(c.creditHours, c.code),
    }));

    let cancelled = false;
    setAnalyticsLoading(true);
    setAnalyticsError(null);

    api
      .post("/api/analytics/dashboard", {
        current_gpa: currentGpa,
        target_gpa: targetGpa > 0 ? targetGpa : 0,
        earned_hours: earnedHours,
        completed_courses: payloadCourses,
        current_courses: payloadCurrent,
      })
      .then((data: AnalyticsData) => {
        if (!cancelled) setAnalyticsData(data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Dashboard analytics fetch failed:", err);
        setAnalyticsError(classifyError(err));
        setAnalyticsData(null);
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, authLoading, user, currentGpa, targetGpa, earnedHours, completedCourses, currentCourses]);

  useInterventionDispatch(analyticsData?.agentic_action);

  return { analyticsData, analyticsLoading, analyticsError, hydrated };
}

/**
 * Agentic self-healing: when the backend surfaces an intervention with
 * `scheduled_tasks`, add them to the plan store ONCE per intervention_id.
 * A localStorage flag keeps refreshes / revisits from inserting duplicates.
 */
function useInterventionDispatch(agenticAction: AgenticAction | undefined) {
  const planAddTask = usePlanStore((s) => s.addTask);
  useEffect(() => {
    if (!agenticAction?.active) return;
    if (!agenticAction.intervention_id) return;
    if (agenticAction.scheduled_tasks.length === 0) return;

    const flagKey = `uqu_intervention_applied_${agenticAction.intervention_id}`;
    try {
      if (window.localStorage.getItem(flagKey)) return;
    } catch {
      /* localStorage unavailable — proceed without the guard */
    }

    for (const t of agenticAction.scheduled_tasks) {
      const planTask: PlanTask = {
        title: t.title,
        courseCode: t.courseCode,
        courseName: t.courseName || null,
        durationMinutes: t.durationMinutes,
        suggestedDay: t.suggestedDay,
        suggestedTime: t.suggestedTime,
        priority: t.priority,
        reason: t.reason,
      };
      try {
        planAddTask(planTask);
      } catch (err) {
        console.warn("[dashboard] failed to inject intervention task:", err);
      }
    }

    try {
      window.localStorage.setItem(flagKey, new Date().toISOString());
    } catch {
      /* no-op */
    }
  }, [agenticAction, planAddTask]);
}
