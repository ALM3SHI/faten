import { describe, expect, it } from "vitest";
import { count, formatDay, formatDayTime } from "@/lib/format-date";

describe("dates and counts as فطن writes them", () => {
  it("uses Western digits, Arabic month names and no seconds", () => {
    const d = new Date(2026, 9, 1, 11, 0, 7);
    expect(formatDay(d)).toBe("1 أكتوبر 2026");
    const dt = formatDayTime(d);
    expect(dt.startsWith("1 أكتوبر 2026، 11:00")).toBe(true);
    expect(dt).not.toMatch(/[٠-٩]/);
    expect(dt).not.toContain(":07");
    expect(formatDay("not a date")).toBe("");
  });

  it("agrees the noun with the number", () => {
    expect(count(1, "مادة", "مواد")).toBe("1 مادة");
    expect(count(2, "مادة", "مواد")).toBe("2 مادة");
    expect(count(4, "مادة", "مواد")).toBe("4 مواد");
    expect(count(10, "محاضرة", "محاضرات")).toBe("10 محاضرات");
    expect(count(11, "مادة", "مواد")).toBe("11 مادة");
    expect(count(103, "مادة", "مواد")).toBe("103 مواد");
    expect(count(2, "وحدة", "وحدات", "وحدتان")).toBe("وحدتان");
  });
});
