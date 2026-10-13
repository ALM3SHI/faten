import { describe, expect, it } from "vitest";
import {
  FAILING_GRADES,
  GPA_MAX,
  GRADE_POINTS,
  NON_GPA_GRADES,
  SELECTABLE_GRADES,
  STRONG_GRADES,
  WEAK_GRADES,
  clampGpa,
  gradePoints,
  gradeToneClass,
  normalizeGrade,
} from "@/lib/grade-scale";

/**
 * سلّم التقديرات الرسمي (من 4) — ملحق لائحة الدراسة والاختبارات للمرحلة الجامعية
 * بجامعة أم القرى. إن تغيّر هذا الاختبار فراجع اللائحة أولاً.
 */
const OFFICIAL_SCALE: Record<string, number | null> = {
  "A+": 4.0,
  A: 3.75,
  "B+": 3.5,
  B: 3.0,
  "C+": 2.5,
  C: 2.0,
  "D+": 1.5,
  D: 1.0,
  F: 0,
  DN: 0,
  // لا تدخل في حساب المعدل
  W: null,
  IP: null,
  IC: null,
  NP: null,
};

describe("GRADE_POINTS", () => {
  it("matches the official UQU 4-point scale exactly", () => {
    expect(GRADE_POINTS).toEqual(OFFICIAL_SCALE);
  });
  it("never exceeds 4.0 and is monotonic over passing grades", () => {
    const order = ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "F"];
    const pts = order.map((g) => GRADE_POINTS[g] as number);
    expect(Math.max(...pts)).toBe(4);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeLessThan(pts[i - 1]);
  });
});

describe("grade helpers", () => {
  it("lists selectable grades best → worst, all on the scale", () => {
    expect(SELECTABLE_GRADES[0]).toBe("A+");
    expect(SELECTABLE_GRADES.at(-1)).toBe("F");
    const pts = SELECTABLE_GRADES.map((g) => GRADE_POINTS[g] as number);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeLessThan(pts[i - 1]);
  });
  it("derives the non-GPA set from the null entries", () => {
    expect([...NON_GPA_GRADES].sort()).toEqual(["IC", "IP", "NP", "W"]);
  });
  it("groups strong / weak / failing grades", () => {
    expect([...STRONG_GRADES]).toEqual(["A+", "A"]);
    for (const g of FAILING_GRADES) expect(WEAK_GRADES.has(g)).toBe(true);
    for (const g of WEAK_GRADES) expect(GRADE_POINTS[g]).toBeLessThanOrEqual(1.5);
  });
  it("looks up points case- and space-insensitively", () => {
    expect(gradePoints("a +")).toBe(4);
    expect(gradePoints("b")).toBe(3);
    expect(gradePoints("W")).toBeNull();
    expect(gradePoints("Z")).toBeNull();
    expect(gradePoints(null)).toBeNull();
  });
  it("normalizes only letters that exist on the scale", () => {
    expect(normalizeGrade(" d+ ")).toBe("D+");
    expect(normalizeGrade("dn")).toBe("DN");
    expect(normalizeGrade("E")).toBeNull();
    expect(normalizeGrade("")).toBeNull();
  });
  it("clamps GPAs to 0–4", () => {
    expect(GPA_MAX).toBe(4);
    expect(clampGpa(4.6)).toBe(4);
    expect(clampGpa(-1)).toBe(0);
    expect(clampGpa(3.21)).toBe(3.21);
  });
  it("colours grades by band and keeps the caller's fallback", () => {
    expect(gradeToneClass("A+")).toContain("emerald");
    expect(gradeToneClass("DN")).toContain("rose");
    expect(gradeToneClass(null, "x")).toBe("x");
    expect(gradeToneClass("W", "x")).toBe("x");
  });
});
