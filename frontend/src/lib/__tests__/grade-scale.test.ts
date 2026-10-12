import { describe, expect, it } from "vitest";
import { GRADE_MAP } from "@/lib/transcript-parser";

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

describe("GRADE_MAP", () => {
  it("matches the official UQU 4-point scale exactly", () => {
    expect(GRADE_MAP).toEqual(OFFICIAL_SCALE);
  });
  it("never exceeds 4.0 and is monotonic over passing grades", () => {
    const order = ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "F"];
    const pts = order.map((g) => GRADE_MAP[g] as number);
    expect(Math.max(...pts)).toBe(4);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeLessThan(pts[i - 1]);
  });
});
