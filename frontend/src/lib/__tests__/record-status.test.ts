import { describe, expect, it } from "vitest";
import { assessRecord, isPassed, projectPart } from "@/lib/record-status";

const c = (nameAr: string, grade: string | null = "A", code = "X1000", creditHours = 3) => ({ code, nameAr, grade, creditHours });

const core = (n: number) => Array.from({ length: n }, (_, i) => c(`مقرر ${i}`, "B", `CS${1000 + i}`));

describe("record status", () => {
  it("is enrolled when courses are registered", () => {
    const r = assessRecord({ completedCourses: core(10), registeredCourses: [c("نظم التشغيل", null)], earnedHours: 60, planHours: 137 });
    expect(r.status).toBe("enrolled");
  });

  it("accepts a fully graded record between terms (Suhaib: many terms, 98 hours)", () => {
    const r = assessRecord({
      completedCourses: [...core(40), c("مشروع التخرج 1", "A")],
      registeredCourses: [],
      earnedHours: 98,
      planHours: 137,
    });
    expect(r.status).toBe("between_terms");
    expect(r.finalProject).toBe("part1_only");
    expect(r.reasons.join(" ")).toContain("باقي 39 ساعة");
  });

  it("detects a graduate from the final project and the plan total, not from levels", () => {
    const r = assessRecord({
      completedCourses: [...core(40), c("مشروع التخرج 1"), c("مشروع التخرج 2", "A+"), c("التدريب التعاوني", "A", "CS3901", 6)],
      registeredCourses: [],
      earnedHours: 137,
      planHours: 137,
    });
    expect(r.status).toBe("graduated");
    expect(r.training).toBe("passed");
  });

  it("does not call a student a graduate when the final project was failed", () => {
    const r = assessRecord({
      completedCourses: [...core(40), c("مشروع تخرج 1"), c("مشروع تخرج 2", "F")],
      registeredCourses: [],
      earnedHours: 134,
      planHours: 137,
    });
    expect(r.status).toBe("between_terms");
  });

  it("needs the plan total or bachelor-level hours", () => {
    const base = [...core(40), c("Graduation Project II"), c("COOP Training", "P")];
    expect(assessRecord({ completedCourses: base, registeredCourses: [], earnedHours: 130, planHours: null }).status).toBe("likely_graduated");
    expect(assessRecord({ completedCourses: base, registeredCourses: [], earnedHours: 100, planHours: null }).status).toBe("between_terms");
  });

  it("treats an ungraded course inside a graded term as in progress", () => {
    const r = assessRecord({ completedCourses: [...core(5), c("هياكل البيانات", null)], registeredCourses: [], earnedHours: 15, planHours: 137 });
    expect(r.status).toBe("enrolled");
  });

  it("reads project parts and pass grades", () => {
    expect(projectPart(c("مشروع التخرج ٢"))).toBe(2);
    expect(projectPart(c("مشروع تخرج (1)"))).toBe(1);
    expect(projectPart({ code: "X", nameEn: "Graduation Project II" })).toBe(2);
    expect(projectPart(c("مشروع التخرج"))).toBeNull();
    expect(isPassed("D")).toBe(true);
    expect(isPassed("F")).toBe(false);
    expect(isPassed("W")).toBe(false);
    expect(isPassed("P")).toBe(true);
  });
});
