import { describe, expect, it } from "vitest";
import { getCurrentTerm, getTermWindows, isHoliday, teachingDates } from "@/lib/academic-term";
import { absenceStatus, coursesFromSchedule, estimateSessions, type AbsenceEntry } from "@/lib/attendance";
import { buildAcademicCalendarIcs, buildScheduleIcs, escapeText, foldLine } from "@/lib/ics";
import { dateOfWeekday, prayerDuringLecture, prayerTimesFor, toMinutes } from "@/lib/prayer-times";
import type { ScheduleSlot } from "@/store/scheduleStore";

const entries = (unexcused: number, excused = 0): AbsenceEntry[] => [
  ...Array.from({ length: unexcused }, (_, i) => ({ id: `u${i}`, date: "2026-09-01", excused: false })),
  ...Array.from({ length: excused }, (_, i) => ({ id: `e${i}`, date: "2026-09-01", excused: true })),
];

describe("term windows", () => {
  it("first term teaches from 23 Aug until the day before finals", () => {
    const [t1, t2] = getTermWindows();
    expect(t1.start.toDateString()).toBe(new Date(2026, 7, 23).toDateString());
    expect(t1.lastTeachingDay.toDateString()).toBe(new Date(2026, 11, 26).toDateString());
    expect(t2.start.toDateString()).toBe(new Date(2027, 0, 17).toDateString());
  });
  it("picks the running term, or the next one between terms", () => {
    expect(getCurrentTerm(new Date(2026, 9, 12))?.term).toBe("الفصل الدراسي الأول");
    expect(getCurrentTerm(new Date(2027, 0, 10))?.term).toBe("الفصل الدراسي الثاني");
  });
  it("skips holidays", () => {
    const t1 = getCurrentTerm(new Date(2026, 9, 12))!;
    expect(isHoliday(new Date(2026, 8, 23), t1)).toBe(true); // National Day
    const wednesdays = teachingDates(t1, [3]);
    expect(wednesdays.some((d) => d.getMonth() === 8 && d.getDate() === 23)).toBe(false);
  });
});

describe("absence rules (Article 14, executive rule)", () => {
  it("allows exactly 15% unexcused", () => {
    // 40 lectures → 6 unexcused allowed (15%), the 7th deprives.
    expect(absenceStatus(entries(6), 40).level).toBe("danger");
    expect(absenceStatus(entries(6), 40).remaining).toBe(0);
    expect(absenceStatus(entries(7), 40).level).toBe("deprived");
  });
  it("caps total absences at 25% including excused", () => {
    // 40 lectures → total cap 10
    expect(absenceStatus(entries(2, 8), 40).level).toBe("danger");
    expect(absenceStatus(entries(2, 9), 40).level).toBe("deprived");
    expect(absenceStatus(entries(0, 10), 40).level).toBe("danger");
  });
  it("reports remaining unexcused absences", () => {
    const s = absenceStatus(entries(1), 30); // 30*0.15 = 4.5 → 4 allowed
    expect(s.maxUnexcused).toBe(4);
    expect(s.remaining).toBe(3);
    expect(s.level).toBe("safe");
    expect(absenceStatus(entries(3), 30).level).toBe("warning");
  });
  it("handles no lectures safely", () => {
    expect(absenceStatus([], 0).level).toBe("safe");
  });
});

const slots: ScheduleSlot[] = [
  { course_code: "CS4510", course_name: "تعلم الآلة", day: "الأحد", start_time: "10:00", end_time: "11:50", type: "نظري", room: "105", building: "العابدية" },
  { course_code: "CS4510", course_name: "تعلم الآلة", day: "الثلاثاء", start_time: "10:00", end_time: "11:50", type: "نظري" },
  { course_code: "CS4520", course_name: "أمن, الشبكات; متقدم", day: "الأربعاء", start_time: "13:00", end_time: "14:50", type: "عملي" },
];

describe("courses from schedule", () => {
  it("groups slots by course and estimates term sessions", () => {
    const courses = coursesFromSchedule(slots);
    expect(courses.map((c) => [c.code, c.sessionsPerWeek])).toEqual([["CS4510", 2], ["CS4520", 1]]);
    const t1 = getCurrentTerm(new Date(2026, 9, 12));
    const n = estimateSessions(courses[0], t1);
    // ~18 weeks of Sun+Tue minus the autumn break
    expect(n).toBeGreaterThan(28);
    expect(n).toBeLessThan(38);
  });
});

describe("ics export", () => {
  const now = new Date(Date.UTC(2026, 9, 12, 12, 0, 0));
  it("builds a valid calendar with CRLF and weekly rules", () => {
    const t1 = getCurrentTerm(new Date(2026, 9, 12))!;
    const ics = buildScheduleIcs(slots, t1, now);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("RRULE:FREQ=WEEKLY;UNTIL=20261226T205959Z");
    expect(ics).toContain("DTSTART;TZID=Asia/Riyadh:20260823T100000");
    // Autumn break Wednesday is excluded from the lab
    expect(ics).toContain("EXDATE;TZID=Asia/Riyadh:20261125T130000");
    expect(ics).toContain(String.raw`أمن\, الشبكات\; متقدم`);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3 + 11);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("exports the whole academic calendar as all-day events", () => {
    const ics = buildAcademicCalendarIcs(now);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(26);
    // single-day event → DTEND is the next day (exclusive)
    expect(ics).toContain("DTSTART;VALUE=DATE:20260823\r\nDTEND;VALUE=DATE:20260824");
  });
  it("escapes and folds text", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = "SUMMARY:" + "م".repeat(80);
    expect(foldLine(long).split("\r\n ").join("")).toBe(long);
  });
});

describe("prayer times (Makkah, Umm al-Qura)", () => {
  it("matches the official timetable for 12 Oct 2026 within a minute", () => {
    const t = Object.fromEntries(prayerTimesFor(new Date(2026, 9, 12)).map((p) => [p.key, toMinutes(p.time)]));
    expect(Math.abs(t.dhuhr - toMinutes("12:07"))).toBeLessThanOrEqual(1);
    expect(Math.abs(t.asr - toMinutes("15:28"))).toBeLessThanOrEqual(1);
    expect(Math.abs(t.maghrib - toMinutes("17:59"))).toBeLessThanOrEqual(1);
    expect(t.isha - t.maghrib).toBe(90);
  });
  it("detects a prayer inside a lecture", () => {
    expect(prayerDuringLecture("12:07", "11:00", "12:50")).toBe(true);
    expect(prayerDuringLecture("12:07", "10:00", "11:50")).toBe(false);
  });
  it("finds the weekday date in the same week", () => {
    expect(dateOfWeekday(new Date(2026, 9, 14), 0).getDate()).toBe(11); // Wed → Sun 11 Oct
  });
});
