import { describe, expect, it } from "vitest";
import {
  addDays,
  buildStudyPlan,
  countdown,
  findConflicts,
  minutesLabel,
  normalizeExam,
  normalizeTime,
  upcomingExams,
  weekdayAr,
  whenLabel,
  type Exam,
} from "@/lib/exams";

const exam = (id: string, date: string, extra: Partial<Exam> = {}): Exam =>
  normalizeExam(id, { subject: id.toUpperCase(), date, ...extra })!;

describe("normalizeTime / normalizeExam", () => {
  it.each([
    ["09:30", "09:30"], ["9", "09:00"], ["10:00 AM", "10:00"], ["1:15 pm", "13:15"],
    ["12 ص", "00:00"], ["2 م", "14:00"], ["٩:٣٠", "09:30"], ["25:00", null], ["بكرة", null],
  ])("%s → %s", (raw, out) => expect(normalizeTime(raw)).toBe(out));

  it("cleans agent documents and rejects missing dates", () => {
    const e = normalizeExam("x", { subject: " AI ", course_code: "cs101", date: "٢٠٢٦-١٢-٢٧", duration_minutes: 5, exam_type: "weird", source: "agent" })!;
    expect(e).toMatchObject({ subject: "AI", course_code: "CS101", date: "2026-12-27", time: null, duration_minutes: 15, exam_type: "exam", source: "agent" });
    expect(normalizeExam("y", { subject: "no date" })).toBeNull();
  });
});

describe("dates and countdown", () => {
  it("formats days and weekdays", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayAr("2026-12-23")).toBe("الأربعاء");
    expect([0, 1, 2, 7, 12].map(whenLabel)).toEqual(["اليوم", "غداً", "بعد يومين", "بعد 7 أيام", "بعد 12 يوماً"]);
  });
  it("counts down to the start time", () => {
    const e = exam("a", "2026-12-23", { time: "13:00" });
    expect(countdown(e, new Date(2026, 11, 20, 10, 30))).toEqual({ days: 3, hours: 2, minutes: 30, started: false });
    expect(countdown(e, new Date(2026, 11, 23, 13, 0)).started).toBe(true);
  });
  it("keeps upcoming, not-done exams in order", () => {
    const list = [exam("b", "2026-12-27"), exam("old", "2026-12-01"), exam("a", "2026-12-23"), exam("done", "2026-12-24", { done: true })];
    expect(upcomingExams(list, "2026-12-20").map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("findConflicts", () => {
  it("separates overlapping slots from same-day exams", () => {
    const a = exam("a", "2026-12-27", { time: "09:00", duration_minutes: 120 });
    const b = exam("b", "2026-12-27", { time: "10:30" });
    const c = exam("c", "2026-12-27", { time: "13:00" });
    const d = exam("d", "2026-12-28");
    const found = findConflicts([c, d, b, a]).map((f) => [f.exams[0].id, f.exams[1].id, f.kind]);
    expect(found).toEqual([["a", "b", "overlap"], ["a", "c", "same_day"], ["b", "c", "same_day"]]);
  });
});

describe("buildStudyPlan", () => {
  const today = "2026-12-20";
  const exams = [
    exam("net", "2026-12-23", { course_code: "CS4520", exam_type: "final" }),
    exam("ml", "2026-12-27", { course_code: "CS4510", exam_type: "final" }),
  ];
  const plan = buildStudyPlan(exams, today, { dailyMinutes: 180, creditsByCode: { CS4520: 3, CS4510: 4 } });

  it("never plans more than the daily budget, and half on exam days", () => {
    for (const day of plan.days) {
      const total = day.sessions.reduce((s, x) => s + x.minutes, 0);
      expect(total).toBeLessThanOrEqual(day.examsToday.length ? 90 : 180);
      for (const s of day.sessions) expect(s.minutes % 15).toBe(0);
    }
  });
  it("never studies for an exam on or after its day", () => {
    for (const day of plan.days)
      for (const s of day.sessions) expect(exams.find((e) => e.id === s.examId)!.date > day.date).toBe(true);
  });
  it("starts the day before each exam with its final review", () => {
    const before = plan.days.find((d) => d.date === "2026-12-22")!;
    expect(before.sessions[0]).toMatchObject({ examId: "net", finalReview: true });
    const beforeMl = plan.days.find((d) => d.date === "2026-12-26")!;
    expect(beforeMl.sessions[0]).toMatchObject({ examId: "ml", finalReview: true });
  });
  it("puts the nearer exam first early on and reports coverage", () => {
    const first = plan.days[0];
    expect(first.sessions[0].examId).toBe("net");
    const net = plan.coverage.find((c) => c.examId === "net")!;
    expect(net.target).toBe(540);
    expect(net.planned).toBeGreaterThan(0);
    expect(plan.tight).toEqual([]);
    // one hour a day is not enough for a 9h final in 3 days
    const tight = buildStudyPlan(exams, today, { dailyMinutes: 60, creditsByCode: { CS4520: 3, CS4510: 4 } });
    expect(tight.tight).toContain("net");
  });
  it("is empty without upcoming exams", () => {
    expect(buildStudyPlan([], today).days).toEqual([]);
  });
});

it("labels minutes in Arabic", () => {
  expect([45, 60, 120, 150, 240].map(minutesLabel)).toEqual(["45 د", "ساعة", "ساعتين", "ساعتين و30 د", "4 ساعات"]);
});
