import { describe, expect, it } from "vitest";
import { NO_APP_NAV, SECTIONS, pageFor, sectionFor, sectionHref } from "@/lib/nav";

describe("sections", () => {
  it("every app page belongs to exactly one section", () => {
    const pages = SECTIONS.flatMap((s) => s.pages.map((p) => p.href));
    expect(new Set(pages).size).toBe(pages.length);
    for (const href of ["/dashboard", "/chat", "/plan", "/exams", "/study", "/pomodoro", "/gpa", "/attendance", "/schedule", "/transcript", "/locations", "/community"]) {
      expect(pages).toContain(href);
    }
    expect(SECTIONS).toHaveLength(5);
  });

  it("finds the section and page from the exported path", () => {
    expect(sectionFor("/exams/")?.id).toBe("study");
    expect(sectionFor("/transcript")?.id).toBe("record");
    expect(pageFor("/community/")?.label).toBe("المجتمع");
    expect(sectionFor("/profile")).toBeNull();
    expect(sectionFor("/studyroom")).toBeNull();
    expect(NO_APP_NAV.has("/login")).toBe(true);
  });

  it("a section link returns to the last page used there", () => {
    const study = SECTIONS.find((s) => s.id === "study")!;
    expect(sectionHref(study, {})).toBe("/plan");
    expect(sectionHref(study, { study: "/exams" })).toBe("/exams");
    expect(sectionHref(study, { study: "/gpa" })).toBe("/plan"); // not in this section
  });
});
