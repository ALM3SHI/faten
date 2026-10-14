import { describe, expect, it } from "vitest";
import { delayLabel, parseCodes, tagLabel, termOptions } from "@/lib/advisor";
import { isProtectedPath } from "@/lib/routes";
import { sectionFor } from "@/lib/nav";

describe("advisor helpers", () => {
  it("parses typed course codes in any common format", () => {
    expect(parseCodes("cs1701, CS 2105؛ mth-1602\nCS1701 ELIE1201")).toEqual(["CS1701", "CS2105", "MTH1602", "ELIE1201"]);
    expect(parseCodes("مقرر بلا رمز")).toEqual([]);
  });

  it("lists terms with or without summers", () => {
    expect(termOptions(1448, 4, false).map((t) => t.value)).toEqual(["1448-1", "1448-2", "1449-1", "1449-2"]);
    expect(termOptions(1448, 3, true).map((t) => t.label)).toEqual(["الفصل الأول 1448", "الفصل الثاني 1448", "الفصل الصيفي 1448"]);
  });

  it("labels planner tags and delay costs", () => {
    expect(tagLabel("unlocks:3")).toBe("يفتح 3");
    expect(tagLabel("repeat")).toBe("إعادة");
    expect(delayLabel(null)).toBeNull();
    expect(delayLabel(0)).toBe("يمكن تأجيله دون تأخير التخرج");
    expect(delayLabel(1)).toBe("تأجيله يؤخر التخرج فصلاً");
  });

  it("is a protected page in the record section", () => {
    expect(isProtectedPath("/advisor/")).toBe(true);
    expect(sectionFor("/advisor")?.id).toBe("record");
  });
});
