import { describe, expect, it } from "vitest";
import { lectureWhen, lecturesLeftToday, nextLecture, termWeek } from "@/lib/today";
import type { ScheduleSlot } from "@/store/scheduleStore";

const slot = (day: string, start: string, end: string, code = "CS3301"): ScheduleSlot =>
  ({ course_code: code, course_name: code, day, start_time: start, end_time: end, type: "نظري" }) as ScheduleSlot;

// Tuesday 13 Oct 2026, 09:30
const TUE = new Date(2026, 9, 13, 9, 30);
const schedule = [slot("الأحد", "08:00", "09:40", "A"), slot("الثلاثاء", "10:00", "11:40", "B"), slot("الثلاثاء", "08:00", "09:50", "C")];

describe("nextLecture", () => {
  it("returns the lecture in progress first", () => {
    const n = nextLecture(schedule, TUE)!;
    expect(n.slot.course_code).toBe("C");
    expect(lectureWhen(n, TUE)).toBe("الآن");
    expect(lecturesLeftToday(schedule, TUE)).toBe(2);
  });

  it("counts down within the hour, then shows the time", () => {
    const at = new Date(2026, 9, 13, 9, 55);
    const n = nextLecture(schedule, at)!;
    expect(n.slot.course_code).toBe("B");
    expect(lectureWhen(n, at)).toBe("بعد 5 د");
    expect(lectureWhen(n, new Date(2026, 9, 13, 8, 30))).toBe("بعد ساعة");
  });

  it("looks ahead to the next teaching day", () => {
    const evening = new Date(2026, 9, 13, 20, 0);
    const n = nextLecture(schedule, evening)!;
    expect(n.slot.course_code).toBe("A");
    expect(n.dayOffset).toBe(5);
    expect(lectureWhen(n, evening)).toBe("الأحد 08:00");
    const sat = new Date(2026, 9, 17, 12, 0);
    expect(lectureWhen(nextLecture(schedule, sat)!, sat)).toBe("بكرة 08:00");
  });

  it("handles an empty or broken timetable", () => {
    expect(nextLecture([], TUE)).toBeNull();
    expect(nextLecture([{ day: "الثلاثاء" } as ScheduleSlot], TUE)).toBeNull();
  });
});

describe("termWeek", () => {
  it("numbers the teaching weeks from the first day of term", () => {
    expect(termWeek(new Date(2026, 7, 23))).toMatchObject({ week: 1 });
    expect(termWeek(TUE)).toMatchObject({ week: 8 });
  });
});
