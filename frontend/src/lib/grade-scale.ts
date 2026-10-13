/**
 * سلّم التقديرات الرسمي لجامعة أم القرى (من 4.00) — المصدر الوحيد في الواجهة.
 *
 * Every letter→points lookup, grade list, grade grouping and grade colour in
 * the frontend comes from here: the transcript parser, the GPA planner, the
 * dashboard simulator, the setup wizard and the chat client actions. The
 * backend keeps its own copy in Python (services/student_tools.py); both are
 * pinned by tests against the regulation table below.
 *
 *   A+ = 4.00   B+ = 3.50   C+ = 2.50   D+ = 1.50   F  = 0.00
 *   A  = 3.75   B  = 3.00   C  = 2.00   D  = 1.00   DN = 0.00 (محروم)
 *   W / IP / IC / NP → null (لا تدخل في حساب المعدل)
 */

export const GPA_MAX = 4.0;

export const GRADE_POINTS: Readonly<Record<string, number | null>> = {
  "A+": 4.0,
  A: 3.75,
  "B+": 3.5,
  B: 3.0,
  "C+": 2.5,
  C: 2.0,
  "D+": 1.5,
  D: 1.0,
  F: 0.0,
  DN: 0.0,
  W: null,
  IP: null,
  IC: null,
  NP: null,
};

/** Letters a student can pick in a what-if simulator, best → worst. */
export const SELECTABLE_GRADES = ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "F"] as const;
export type SelectableGrade = (typeof SELECTABLE_GRADES)[number];

/** Grades that never count toward the GPA (withdrawn, in progress, …). */
export const NON_GPA_GRADES: ReadonlySet<string> = new Set(
  Object.keys(GRADE_POINTS).filter((g) => GRADE_POINTS[g] === null),
);

/** Excellent grades (A / A+) — used for "strengths". */
export const STRONG_GRADES: ReadonlySet<string> = new Set(["A+", "A"]);
/** Low and failing grades — used for "needs attention". */
export const WEAK_GRADES: ReadonlySet<string> = new Set(["D+", "D", "F", "DN"]);
/** Grades that mean the course must be retaken. */
export const FAILING_GRADES: ReadonlySet<string> = new Set(["F", "DN"]);

/** Grade points for a letter, or null when it doesn't count / is unknown. */
export function gradePoints(letter: string | null | undefined): number | null {
  if (!letter) return null;
  const v = GRADE_POINTS[letter.toUpperCase().replace(/\s/g, "")];
  return v === undefined ? null : v;
}

/** Canonical letter ("a +" → "A+"), or null when it isn't on the scale. */
export function normalizeGrade(g: string | null | undefined): string | null {
  if (!g) return null;
  const up = g.toUpperCase().replace(/\s/g, "");
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS, up) ? up : null;
}

/** Clamp any GPA-like number to the 0–4.00 scale. */
export function clampGpa(v: number): number {
  return Math.max(0, Math.min(GPA_MAX, v));
}

/** Low-key tone for empty grades on the GPA planner. */
export const MUTED_GRADE_TONE = "bg-foreground/5 text-muted border-foreground/10";

const NEUTRAL_TONE =
  "bg-secondary/40 text-muted-foreground border-border dark:bg-foreground/5 dark:text-muted dark:border-foreground/10";

/**
 * Tailwind badge classes for a letter grade (A → emerald … F → rose).
 * `fallback` is used for empty / non-GPA grades so each screen keeps its look.
 */
export function gradeToneClass(grade: string | null | undefined, fallback: string = NEUTRAL_TONE): string {
  const g = (grade ?? "").toUpperCase();
  if (g === "A+" || g === "A") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (g === "B+" || g === "B") return "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  if (g === "C+" || g === "C") return "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30";
  if (g === "D+" || g === "D") return "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30";
  if (g === "F" || g === "DN") return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
  return fallback;
}
