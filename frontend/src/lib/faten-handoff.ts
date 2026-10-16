/**
 * فطن's front door hands a question to the mode built for it: planning
 * questions to «المرشد» (/advisor), studying a lecture to «ذاكر» (/study).
 * The chat still answers; this only adds the button under the reply, so
 * the student never has to know which mode to pick.
 */

const ADVISOR = new RegExp(
  [
    "[أا]سجّ?ل\\s+(?:الفصل|الترم|وش|ايش|إيش|كم|مواد|مقرر)",
    "وش\\s+[أا]سجّ?ل",
    "(?:ايش|إيش|ماذا)\\s+[أا]سجّ?ل",
    "(?:الفصل|الترم)\\s+(?:الجاي|القادم)",
    "متى\\s+[أا]تخرج",
    "تخرّ?جي",
    "خطة\\s+التخرج",
    "مسار(?:ات)?\\s+التخرج",
    "[أا]حوّ?ل\\s+تخصص",
    "تحويل\\s+التخصص",
    "المرشد",
  ].join("|"),
);

const STUDY = new RegExp(
  [
    "[أا]?ذاكر\\s+(?:المحاضرة|محاضرة|الملف|ملف)",
    "درّ?سني",
    "اشرح\\s+لي\\s+(?:المحاضرة|الملف|الشرائح)",
    "(?:لخص|لخّص|ملخص)\\s+(?:المحاضرة|الملف)",
    "ملف\\s+المحاضرة",
    "بطاقات\\s+مراجعة",
  ].join("|"),
);

/** The mode a question belongs to, when it is not the general chat's. */
export function handoffFor(question: string): "/advisor" | "/study" | null {
  const q = question.replace(/[ً-ْ]/g, (c) => (c === "ّ" ? c : "")).trim();
  if (!q) return null;
  if (ADVISOR.test(q)) return "/advisor";
  if (STUDY.test(q)) return "/study";
  return null;
}
