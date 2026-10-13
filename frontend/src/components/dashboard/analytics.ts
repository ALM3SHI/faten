/**
 * Dashboard analytics contract — mirrors backend/schemas/analytics.py
 * (POST /api/analytics/dashboard).
 */

import type { PlanPriority } from "@/store/planStore";

/** Target status as the cards show it ("no_target" folds into "unknown"). */
export type TargetCalloutStatus = "achieved" | "feasible" | "stretch" | "impossible" | "unknown";

type TargetStatus =
  | "achieved"
  | "feasible"
  | "stretch"
  | "impossible"
  | "no_target";

type RadarCourseRef = {
  code: string;
  name: string;
  grade: string | null;
  gradePoints: number | null;
  credits: number;
  semester: string;
  contribution: number;
};

type RadarPoint = {
  category: string;
  student_competency: number;
  market_demand: number;
  skill_gap: number;
  course_count: number;
  credit_hours: number;
  is_reliable: boolean;
  courses: RadarCourseRef[];
};

export type HighRoiCourse = {
  code: string;
  name: string;
  credits: number;
  max_point_contribution: number;
  projected_delta: number;
  label: string;
};

type InterventionTask = {
  title: string;
  courseCode: string;
  courseName: string;
  durationMinutes: number;
  suggestedDay: string;
  suggestedTime: string;
  priority: PlanPriority;
  reason: string;
};

export type DecisionLogEntry = {
  fact: string;
  interpretation: string;
  severity: "info" | "warn" | "alert";
};

export type AgenticAction = {
  active: boolean;
  intervention_id: string;
  trigger: "none" | "low_gpa" | "skill_gap" | "combined";
  severity: "low" | "medium" | "high";
  headline: string;
  body: string;
  scheduled_tasks: InterventionTask[];
  reasoning: DecisionLogEntry[];
};

export type AnalyticsData = {
  target_analysis: {
    required: number;
    status: TargetStatus;
    message: string;
    next_hours: number;
  };
  chart_data: { semester: string; term_gpa: number; cumulative_gpa: number }[];
  advisor_recommendation: {
    hours: string;
    tone: "strong" | "steady" | "recover";
    headline: string;
    body: string;
  };
  strengths_radar: RadarPoint[];
  high_roi_courses: HighRoiCourse[];
  agentic_action: AgenticAction;
  gpa_trend_analysis: string;
};

type AnalyticsErrorKind = "migration" | "network" | "server";

export type AnalyticsError = { kind: AnalyticsErrorKind; detail: string };

// ──────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────

/** Classify a thrown fetch error into a UI branch.
 *
 * The api helper throws Error with `detail` already extracted from the
 * server's JSON body for non-2xx responses, OR a generic "HTTP error!
 * status: N" string. We sniff both shapes — and detect 422 specifically
 * because that's the signal the user's persisted transcript still holds
 * pre-purge 5.0-scale numbers and needs re-upload.
 */
export function classifyError(err: unknown): AnalyticsError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/422|unprocessable|less than or equal|ge=|le=/i.test(msg)) {
    return { kind: "migration", detail: msg };
  }
  if (/failed to fetch|networkerror|typeerror.*fetch/i.test(msg)) {
    return { kind: "network", detail: msg };
  }
  return { kind: "server", detail: msg };
}
