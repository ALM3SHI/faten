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
