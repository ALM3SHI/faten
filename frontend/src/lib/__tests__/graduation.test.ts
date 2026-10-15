import { describe, expect, it } from "vitest";
import {
  graduationProgress,
  maxAchievableGpa,
  requiredToGraduate,
  resolvePlanHours,
  termsLeftLabel,
} from "@/lib/graduation";

describe("graduationProgress", () => {
  it("computes remaining hours and terms", () => {
    const p = graduationProgress({ planHours: 132, earnedHours: 96, currentHours: 10 })!;
    expect(p.remaining).toBe(36);
    expect(p.remainingAfterTerm).toBe(26);
    expect(p.percent).toBe(73);
    expect(p.termsLeft).toEqual({ min: 2, max: 2 });
    expect(termsLeftLabel(p)).toBe("باقي فصلين بعد هذا الفصل تقريباً");
  });
  it("detects graduating this term and finished plans", () => {
    expect(termsLeftLabel(graduationProgress({ planHours: 132, earnedHours: 120, currentHours: 12 })!)).toContain("نهاية هذا الفصل");
    expect(termsLeftLabel(graduationProgress({ planHours: 132, earnedHours: 132, currentHours: 0 })!)).toContain("أكملت");
  });
  it("shows a range when loads differ", () => {
    const p = graduationProgress({ planHours: 136, earnedHours: 30, currentHours: 16 })!;
    expect(p.termsLeft).toEqual({ min: 5, max: 7 });
    expect(termsLeftLabel(p)).toBe("باقي 5–7 فصول بعد هذا الفصل تقريباً");
  });
  it("returns null without plan hours", () => {
    expect(graduationProgress({ planHours: null, earnedHours: 50, currentHours: 0 })).toBeNull();
    expect(graduationProgress({ planHours: 0, earnedHours: 50, currentHours: 0 })).toBeNull();
  });
});

describe("resolvePlanHours", () => {
  it("uses the profile only; never the transcript's attempted-hours footer", () => {
    expect(resolvePlanHours(140, 132)).toBe(140);
    expect(resolvePlanHours("", 132)).toBeNull();
    // An older upload copied «Crd Hrs» (178) into both stores: not a plan total.
    expect(resolvePlanHours(178, 178, 178)).toBeNull();
    expect(resolvePlanHours(0, null)).toBeNull();
    expect(resolvePlanHours(undefined, undefined)).toBeNull();
  });
});

describe("maxAchievableGpa", () => {
  it("assumes A+ in every remaining hour and rounds down", () => {
    // (2.0×100 + 32×4) / 132 = 2.4848…
    expect(maxAchievableGpa({ currentGpa: 2, earnedHours: 100, planHours: 132 })).toBe(2.48);
  });
  it("is 4.00 for new students or unknown plans", () => {
    expect(maxAchievableGpa({ currentGpa: 0, earnedHours: 0, planHours: 132 })).toBe(4);
    expect(maxAchievableGpa({ currentGpa: 2.5, earnedHours: 60, planHours: null })).toBe(4);
  });
  it("is the current GPA once the plan is complete", () => {
    expect(maxAchievableGpa({ currentGpa: 3.1, earnedHours: 132, planHours: 132 })).toBe(3.1);
  });
});

describe("requiredToGraduate", () => {
  const base = { planHours: 132, projectedHours: 100, projectedPoints: 300 }; // 3.00 so far
  it("reports missing target / plan", () => {
    expect(requiredToGraduate({ ...base, targetGpa: 0 }).status).toBe("no_target");
    expect(requiredToGraduate({ ...base, targetGpa: 3.5, planHours: null }).status).toBe("no_plan");
  });
  it("computes the GPA needed over the remaining hours", () => {
    const r = requiredToGraduate({ ...base, targetGpa: 3.2 });
    // (3.2×132 − 300) / 32 = 3.825
    expect(r.raw).toBeCloseTo(3.825);
    expect(r.status).toBe("stretch");
    expect(r.remainingHours).toBe(32);
    expect(requiredToGraduate({ ...base, targetGpa: 3.1 }).status).toBe("feasible");
  });
  it("flags impossible targets and clamps the display value", () => {
    const r = requiredToGraduate({ ...base, targetGpa: 3.9 });
    expect(r.status).toBe("impossible");
    expect(r.value).toBe(4);
  });
  it("handles achieved and complete plans", () => {
    expect(requiredToGraduate({ ...base, targetGpa: 2.5 }).status).toBe("achieved");
    expect(requiredToGraduate({ targetGpa: 3.5, planHours: 132, projectedHours: 132, projectedPoints: 396 }).status).toBe("complete");
  });
});
