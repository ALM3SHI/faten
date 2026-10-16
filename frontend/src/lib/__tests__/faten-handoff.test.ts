import { describe, expect, it } from "vitest";
import { handoffFor } from "@/lib/faten-handoff";

describe("handoffFor", () => {
  it("sends planning questions to the advisor", () => {
    for (const q of ["وش أسجّل الفصل الجاي؟", "ايش اسجل الترم القادم", "متى أتخرج لو خففت؟", "أبي أحول تخصص", "افتح المرشد"]) {
      expect(handoffFor(q), q).toBe("/advisor");
    }
  });

  it("sends studying a lecture to «ذاكر»", () => {
    for (const q of ["درّسني المحاضرة الرابعة", "لخص المحاضرة", "أبي أذاكر محاضرة الشبكات"]) {
      expect(handoffFor(q), q).toBe("/study");
    }
  });

  it("keeps everything else in the chat", () => {
    for (const q of ["كم أغيب قبل الحرمان؟", "متى اختباري الجاي؟", "وش عندي محاضرات بكرة؟", "حلل سجلي الأكاديمي", ""]) {
      expect(handoffFor(q), q).toBeNull();
    }
  });
});
