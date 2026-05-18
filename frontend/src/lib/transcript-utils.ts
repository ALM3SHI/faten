/**
 * Transcript helpers — shared utilities for pages that consume
 * `useTranscriptStore` data.
 *
 * Why this file exists
 * ────────────────────
 * The PDF transcript parser at `lib/transcript-parser.ts:442` writes
 * `creditHours: numbers[0] || 0` for in-progress courses. When the
 * registrar's PDF layout omits the credit column on registered rows
 * (which is the common case at UQU), every current course arrives
 * with `creditHours: 0`. Any page that filters on `creditHours > 0`
 * then drops the entire current term — silently breaking the GPA
 * Planner simulator and the Dashboard's High-ROI ranking.
 *
 * `buildCreditsResolver` is the single source of truth for working
 * around that parser bug. Resolution chain (in order):
 *   1. Trust the parser when it captured a positive value.
 *   2. Look up the same course code in completed courses (retake case
 *      — credit hours never change for the same course at UQU).
 *   3. Fall back to `DEFAULT_COURSE_CREDITS` (UQU's standard load).
 *
 * Usage:
 *   const resolveCredits = useMemo(
 *     () => buildCreditsResolver(completedCourses),
 *     [completedCourses],
 *   );
 *   const credits = resolveCredits(course.creditHours, course.code);
 */

/**
 * UQU's standard per-course credit load. Used as the last-resort
 * fallback by `buildCreditsResolver`, and also imported by callers
 * that need a sensible default credits value when seeding a brand-new
 * mock/manual course row (e.g., the GPA Planner's "Add Mock Course"
 * button). Keeping it here ensures the magic number lives in exactly
 * one place across the whole frontend.
 */
export const DEFAULT_COURSE_CREDITS = 3;

/**
 * Minimal structural shape `buildCreditsResolver` needs from each
 * historical course. Intentionally NOT typed as `EnrichedCourse` so
 * the helper stays decoupled from the store's full shape — any object
 * with `code` + `creditHours` is accepted.
 */
export interface CourseWithCredits {
  code: string;
  creditHours: number;
}

/**
 * Returns a closure that resolves a course's effective credit hours.
 *
 * @param completedCourses Historical courses used as the lookup table.
 *   Typically `useTranscriptStore.getState().completedCourses` or the
 *   subscribed value inside a React component.
 *
 * @returns `(rawCredits, code) => number` — call once per current
 *   course you're rendering. Always returns a positive integer.
 *
 * The returned function is pure with respect to the captured lookup
 * map, so wrapping the call site in `useMemo([completedCourses])` is
 * the typical React pattern.
 */
export function buildCreditsResolver(
  completedCourses: readonly CourseWithCredits[],
): (rawCredits: number, code: string) => number {
  // Build the code → credits lookup once, up front. First-wins on
  // duplicate codes (a course is its own credits, no matter how many
  // times the student took it).
  const creditsByCode = new Map<string, number>();
  for (const c of completedCourses) {
    if (!c.code) continue;
    if (c.creditHours > 0 && !creditsByCode.has(c.code)) {
      creditsByCode.set(c.code, c.creditHours);
    }
  }

  return (rawCredits: number, code: string): number => {
    if (rawCredits > 0) return rawCredits;
    const fromHistory = creditsByCode.get(code);
    if (fromHistory && fromHistory > 0) return fromHistory;
    return DEFAULT_COURSE_CREDITS;
  };
}
