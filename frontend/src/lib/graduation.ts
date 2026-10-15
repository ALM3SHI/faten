/**
 * Progress toward graduation from the student's own numbers:
 * plan hours (profile, editable — falls back to the transcript),
 * passed hours, and hours registered this term. Mirrors
 * backend/services/student_tools.py::graduation_progress.
 */

export interface GraduationInput {
  planHours: number | null | undefined;
  earnedHours: number | null | undefined;
  currentHours: number | null | undefined;
}

export interface GraduationProgress {
  planHours: number;
  earned: number;
  inProgress: number;
  remaining: number;
  remainingAfterTerm: number;
  percent: number;
  /** Terms needed after the current one, at 18 h (fast) … 14 h (comfortable). */
  termsLeft: { min: number; max: number };
  graduatesThisTerm: boolean;
}

const FAST_LOAD = 18;
const COMFORT_LOAD = 14;

export function graduationProgress({ planHours, earnedHours, currentHours }: GraduationInput): GraduationProgress | null {
  const plan = Number(planHours);
  const earned = Number(earnedHours);
  if (!Number.isFinite(plan) || plan <= 0 || !Number.isFinite(earned) || earned < 0) return null;
  const inProgress = Math.max(0, Number(currentHours) || 0);
  const remaining = Math.max(0, plan - earned);
  const remainingAfterTerm = Math.max(0, remaining - inProgress);
  return {
    planHours: plan,
    earned,
    inProgress,
    remaining,
    remainingAfterTerm,
    percent: Math.min(100, Math.round((earned / plan) * 100)),
    termsLeft: {
      min: Math.ceil(remainingAfterTerm / FAST_LOAD),
      max: Math.ceil(remainingAfterTerm / COMFORT_LOAD),
    },
    graduatesThisTerm: remaining > 0 && remainingAfterTerm === 0,
  };
}

export function termsLeftLabel(p: GraduationProgress): string {
  if (p.remaining === 0) return "أكملت ساعات خطتك 🎓";
  if (p.graduatesThisTerm) return "تتخرج بإذن الله بنهاية هذا الفصل 🎓";
  const { min, max } = p.termsLeft;
  const word = (n: number) => (n === 1 ? "فصل واحد" : n === 2 ? "فصلين" : `${n} فصول`);
  return min === max ? `باقي ${word(min)} بعد هذا الفصل تقريباً` : `باقي ${min}–${max} فصول بعد هذا الفصل تقريباً`;
}

/**
 * Plan hours for the whole app: the profile value (editable by the student)
 * wins, otherwise the number read from the transcript. null when unknown.
 */
export function resolvePlanHours(
  profilePlan: number | "" | null | undefined,
  transcriptPlan: number | null | undefined,
  earnedHours?: number | null,
): number | null {
  // UQU transcripts never print the plan total. Older uploads stored the
  // attempted-hours footer («Crd Hrs») as `planHours`, and the setup wizard
  // copied it to the profile — so the transcript value is never used, and a
  // profile value equal to it is that same copy, not a plan the student entered.
  void earnedHours;
  const legacy = Number(transcriptPlan);
  const fromProfile = Number(profilePlan);
  if (!Number.isFinite(fromProfile) || fromProfile <= 0) return null;
  if (Number.isFinite(legacy) && legacy > 0 && fromProfile === legacy) return null;
  return fromProfile;
}

/**
 * Highest cumulative GPA still reachable if every remaining plan hour is an
 * A+ (4.00), rounded DOWN to 2 decimals so we never promise an unreachable
 * target. Without plan hours there is no ceiling to compute, so 4.00.
 */
export function maxAchievableGpa({
  currentGpa,
  earnedHours,
  planHours,
}: {
  currentGpa: number;
  earnedHours: number;
  planHours: number | null;
}): number {
  if (earnedHours <= 0 || !planHours || planHours <= 0) return 4.0;
  const remaining = Math.max(0, planHours - earnedHours);
  if (remaining <= 0) return Math.min(4, currentGpa);
  const raw = (currentGpa * earnedHours + remaining * 4.0) / (earnedHours + remaining);
  return Math.min(4, Math.floor(raw * 100) / 100);
}

export type RequiredStatus =
  | "achieved"
  | "feasible"
  | "stretch"
  | "impossible"
  | "no_plan"
  | "no_target"
  | "complete";

export interface RequiredToGraduate {
  /** Required GPA clamped to 1.00–4.00 for display. */
  value: number;
  raw: number;
  status: RequiredStatus;
  remainingHours: number;
}

const REQUIRED_FLOOR = 1.0;
const REQUIRED_CEILING = 4.0;

/**
 * GPA the student needs over the rest of the plan to graduate with
 * `targetGpa`, given the projected totals after the current term:
 *
 *   remaining = planHours − projectedHours
 *   required  = (target × planHours − projectedPoints) / remaining
 */
export function requiredToGraduate({
  targetGpa,
  planHours,
  projectedHours,
  projectedPoints,
}: {
  targetGpa: number;
  planHours: number | null;
  projectedHours: number;
  projectedPoints: number;
}): RequiredToGraduate {
  if (targetGpa <= 0) return { value: 0, raw: 0, status: "no_target", remainingHours: 0 };
  if (!planHours || planHours <= 0) return { value: 0, raw: 0, status: "no_plan", remainingHours: 0 };
  const projectedGpa = projectedHours > 0 ? projectedPoints / projectedHours : 0;
  const remainingHours = planHours - projectedHours;
  if (remainingHours <= 0) {
    return {
      value: projectedGpa,
      raw: projectedGpa,
      status: projectedGpa >= targetGpa ? "achieved" : "complete",
      remainingHours: 0,
    };
  }
  if (projectedGpa >= targetGpa) {
    return { value: projectedGpa, raw: projectedGpa, status: "achieved", remainingHours };
  }
  const raw = (targetGpa * planHours - projectedPoints) / remainingHours;
  const value = Math.min(REQUIRED_CEILING, Math.max(REQUIRED_FLOOR, raw));
  const status: RequiredStatus =
    raw > REQUIRED_CEILING ? "impossible" : raw > REQUIRED_CEILING - 0.5 ? "stretch" : "feasible";
  return { value, raw, status, remainingHours };
}
