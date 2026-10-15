import { describe, expect, it } from "vitest";
import { ACCOUNT_LINKS, NO_APP_NAV, SECTIONS, isHub, pageFor, sectionFor, sectionHref } from "@/lib/nav";

describe("spaces", () => {
  it("every app page has exactly one home: a space or the account menu", () => {
    const pages = SECTIONS.flatMap((s) => s.pages.map((p) => p.href));
    const account = ACCOUNT_LINKS.map((l) => l.href);
    const all = [...pages, ...account];
    expect(new Set(all).size).toBe(all.length);
    for (const href of [
      "/dashboard", "/time", "/schedule", "/plan", "/exams", "/attendance", "/pomodoro",
      "/chat", "/study", "/tutor", "/record", "/gpa", "/advisor", "/transcript",
      "/profile", "/locations", "/community", "/admin",
    ]) {
      expect(all).toContain(href);
    }
    expect(SECTIONS).toHaveLength(4);
  });

  it("finds the space and page from the exported path", () => {
    expect(sectionFor("/exams/")?.id).toBe("time");
    expect(sectionFor("/transcript")?.id).toBe("record");
    expect(sectionFor("/tutor/")?.id).toBe("faten");
    expect(pageFor("/attendance/")?.label).toBe("الغياب");
    expect(sectionFor("/profile")).toBeNull();
    expect(sectionFor("/community")).toBeNull();
    expect(sectionFor("/studyroom")).toBeNull();
    expect(NO_APP_NAV.has("/login")).toBe(true);
  });

  it("a space link always opens its hub", () => {
    const time = SECTIONS.find((s) => s.id === "time")!;
    expect(sectionHref(time)).toBe("/time");
    expect(isHub("/time/")).toBe(true);
    expect(isHub("/plan")).toBe(false);
    expect(isHub("/record")).toBe(true);
  });
});
