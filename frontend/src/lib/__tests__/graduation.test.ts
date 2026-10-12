import { describe, expect, it } from "vitest";
import { graduationProgress, termsLeftLabel } from "@/lib/graduation";

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
