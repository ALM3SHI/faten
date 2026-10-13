import { describe, expect, it } from "vitest";
import { citedArticleNumbers, extractCitations } from "@/lib/citations";
import { attendanceSnapshotFrom } from "@/lib/agent-results";

const STUDY = "لائحة الدراسة والاختبارات للمرحلة الجامعية (القواعد التنفيذية لجامعة أم القرى)";
const GRAD = "لائحة الدراسات العليا بجامعة أم القرى";
const URL = "https://uqu.edu.sa/dadregis/151795";

const actions = [
  {
    tool: "search_regulations",
    result: {
      success: true,
      results: [
        { document: STUDY, article: "المادة 14", source_url: URL },
        { document: STUDY, article: "المادة 15", source_url: URL },
        { document: GRAD, article: "المادة 14", source_url: "https://uqu.edu.sa/grad" },
        { document: "الدليل الإجرائي لمقرر التدريب التعاوني", article: "عدد الساعات الفعلية التدريب التعاوني", heading: "عدد الساعات الفعلية التدريب التعاوني" },
      ],
    },
  },
];

describe("citedArticleNumbers", () => {
  it("reads digits, Arabic-Indic digits and parentheses", () => {
    expect([...citedArticleNumbers("📄 المرجع: المادة (14) — لائحة")]).toEqual([14]);
    expect([...citedArticleNumbers("حسب المادة ١٥ والمادة 3")].sort()).toEqual([15, 3]);
  });
});

describe("extractCitations", () => {
  it("shows only the articles the answer cites, from the right regulation", () => {
    const answer = "يُحرم الطالب إذا زاد غيابه بدون عذر عن 15%.\n📄 المرجع: المادة (14) — لائحة الدراسة والاختبارات";
    expect(extractCitations(answer, actions)).toEqual([{ document: STUDY, article: "المادة 14", url: URL }]);
  });

  it("ignores results the answer never mentions", () => {
    expect(extractCitations("ما لقيت نص صريح في اللوائح.", actions)).toEqual([]);
  });

  it("matches non-numbered sections by heading", () => {
    const c = extractCitations("حسب «عدد الساعات الفعلية التدريب التعاوني» في الدليل", actions);
    expect(c.map((x) => x.article)).toEqual(["عدد الساعات الفعلية التدريب التعاوني"]);
  });

  it("is safe with missing actions", () => {
    expect(extractCitations("المادة 14", undefined)).toEqual([]);
    expect(extractCitations("المادة 14", [{ tool: "get_calendar_info", result: {} }])).toEqual([]);
  });
});

describe("source text and the calendar", () => {
  const withText = [
    {
      tool: "search_regulations",
      result: {
        success: true,
        results: [
          {
            document: STUDY,
            article: "المادة 36",
            heading: "الفصل الثامن: الاختبارات — المادة 36",
            text: "يجوز للطالب التظلم على الدرجة النهائية للمقرر الدراسي خلال مدة لا تتجاوز خمسة عشر يوماً…",
            issued: "الإصدار الأول — 1444هـ",
            source_url: URL,
          },
        ],
      },
    },
  ];

  it("keeps the article text so the student can read it in the chat", () => {
    const [c] = extractCitations("تقدر تتظلم خلال 15 يوم (المادة 36).", withText);
    expect(c.text).toContain("التظلم على الدرجة النهائية");
    expect(c.heading).toBe("الفصل الثامن: الاختبارات — المادة 36");
    expect(c.issued).toBe("الإصدار الأول — 1444هـ");
  });

  const calendar = [
    {
      tool: "get_calendar_info",
      result: {
        success: true,
        data: [
          { title: "الاختبارات النهائية", date: "27 Dec 2026 - 07 Jan 2027", hijri: "18/07 - 29/07/1448" },
          { title: "إجازة الخريف", date: "19 Nov - 28 Nov 2026", hijri: "09/06 - 18/06/1448" },
        ],
        source: { document: "التقويم الأكاديمي لجامعة أم القرى 1448هـ", url: "https://uqu.edu.sa/App/AcademicCalendar" },
      },
    },
  ];

  it("cites the academic calendar for the events the answer uses", () => {
    const [c] = extractCitations("الاختبارات النهائيه تبدأ 27 ديسمبر.", calendar);
    expect(c).toMatchObject({ document: "التقويم الأكاديمي لجامعة أم القرى 1448هـ", article: "الاختبارات النهائية", url: "https://uqu.edu.sa/App/AcademicCalendar" });
    expect(c.text).toBe("الاختبارات النهائية: 27 Dec 2026 - 07 Jan 2027 (18/07 - 29/07/1448هـ)");
  });

  it("matches calendar events by Hijri date too, and skips unused results", () => {
    expect(extractCitations("الإجازة من ٠٩/٠٦ إلى 18/06.", calendar)[0].article).toBe("إجازة الخريف");
    expect(extractCitations("ما لقيت الموعد في التقويم.", calendar)).toEqual([]);
  });
});

describe("attendanceSnapshotFrom", () => {
  it("takes the last successful record_absence snapshot", () => {
    const snap = { courses: { CS4510: { entries: [{ id: "a", date: "2026-10-12", excused: false }], totalOverride: null } }, lastUpdated: "t2" };
    const out = attendanceSnapshotFrom([
      { tool: "record_absence", result: { success: false } },
      { tool: "record_absence", result: { success: true, attendance: snap } },
    ]);
    expect(out).toEqual(snap);
    expect(attendanceSnapshotFrom([{ tool: "get_day_schedule", result: {} }])).toBeNull();
  });
});
