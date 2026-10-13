import { describe, expect, it } from "vitest";
import { tourSteps } from "@/lib/tour";

describe("tourSteps", () => {
  it("asks for the record first when nothing is uploaded", () => {
    const steps = tourSteps({ hasRecord: false });
    expect(steps.map((s) => s.id)).toEqual(["welcome", "profile", "chat", "exams", "study", "notifications"]);
    expect(steps[1].title).toBe("ابدأ بسجلك الأكاديمي");
    expect(steps[1].link?.href).toBe("/profile");
  });

  it("tells students with a record that it is ready", () => {
    expect(tourSteps({ hasRecord: true })[1].title).toBe("ملفك الأكاديمي جاهز");
  });

  it("every link points at a real page", () => {
    const pages = new Set(["/profile", "/chat", "/exams", "/study"]);
    for (const s of tourSteps({ hasRecord: false })) if (s.link) expect(pages.has(s.link.href)).toBe(true);
  });
});
