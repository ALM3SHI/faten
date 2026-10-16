import { describe, expect, it } from "vitest";
import { buildAgenda, formatClock, nextUp, nextUpWhen, roomHref, weekDates } from "@/lib/agenda";
import type { Exam } from "@/lib/exams";
import type { PlanTask } from "@/store/planStore";
import type { ScheduleSlot } from "@/store/scheduleStore";

// Thursday 15 Oct 2026
const THU = new Date(2026, 9, 15);

const lecture = (day: string, start: string, end: string, code = "CS2301"): ScheduleSlot => ({
  course_code: code, course_name: "هياكل البيانات", day, start_time: start, end_time: end, type: "نظري", room: "12",
});
const task = (over: Partial<PlanTask>): PlanTask => ({
  title: "مراجعة", courseCode: "CS2301", durationMinutes: 50, suggestedDay: "الخميس", suggestedTime: "14:00", priority: "medium", reason: "", ...over,
});
const exam = (over: Partial<Exam>): Exam => ({
  id: "e1", subject: "الشبكات", course_code: "CS3601", date: "2026-10-15", time: "08:00", duration_minutes: 120,
  location: null, exam_type: "midterm", notes: "", done: false, ...over,
});

describe("agenda", () => {
  it("covers the week from Sunday to Saturday", () => {
    const days = weekDates(THU);
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(0);
    expect(days[0].getDate()).toBe(11);
    expect(days[4].getDate()).toBe(15);
  });

  it("merges lectures, plan sessions and exams of that day in time order", () => {
    const items = buildAgenda(THU, {
      schedule: [lecture("الخميس", "10:00", "11:40"), lecture("الأحد", "08:00", "09:40")],
      tasks: [task({}), task({ suggestedDay: "الأحد" })],
      completed: ["الخميس|14:00|CS2301"],
      exams: [exam({}), exam({ id: "e2", date: "2026-10-20" })],
    });
    expect(items.map((i) => i.kind)).toEqual(["exam", "lecture", "task"]);
    const t = items[2];
    expect(t.kind === "task" && t.done).toBe(true);
  });

  it("places dated events on their date only", () => {
    const dated = task({ suggestedDay: "الخميس", targetDate: "2026-10-22" });
    expect(buildAgenda(THU, { schedule: [], tasks: [dated], completed: [], exams: [] })).toHaveLength(0);
  });

  it("shows prayers only inside the busy part of the day", () => {
    const items = buildAgenda(THU, {
      schedule: [lecture("الخميس", "10:00", "11:40")],
      tasks: [task({ suggestedTime: "20:00" })],
      completed: [],
      exams: [],
      prayers: [
        { key: "fajr", name: "الفجر", time: "04:55" },
        { key: "dhuhr", name: "الظهر", time: "12:05" },
        { key: "isha", name: "العشاء", time: "21:00" },
      ],
    });
    expect(items.filter((i) => i.kind === "prayer").map((i) => (i.kind === "prayer" ? i.name : ""))).toEqual(["الظهر"]);
  });

  it("formats clock times and room links", () => {
    expect(formatClock("13:05")).toBe("1:05 م");
    expect(formatClock("09:00")).toBe("9:00 ص");
    expect(formatClock("00:30")).toBe("12:30 ص");
    expect(roomHref("قاعة 12")).toBe("/locations?target=Room_12");
    expect(roomHref("3B-112")).toBe("/locations");
    expect(roomHref(undefined)).toBe("/locations");
  });
});

describe("next up", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 15, h, m);
  const input = {
    schedule: [lecture("الخميس", "10:00", "11:40"), lecture("الأحد", "08:00", "09:40")],
    tasks: [task({ suggestedTime: "14:00" })],
    completed: [] as string[],
    exams: [] as Exam[],
  };

  it("picks what is in progress, then what comes next today", () => {
    const a = nextUp(at(10, 30), input)!;
    expect(a.item.kind).toBe("lecture");
    expect(a.now).toBe(true);
    expect(nextUpWhen(a, at(10, 30))).toBe("الآن");
    const b = nextUp(at(13, 35), input)!;
    expect(b.item.kind).toBe("task");
    expect(nextUpWhen(b, at(13, 35))).toBe("بعد 25 د");
  });

  it("skips done sessions and looks into the coming days", () => {
    const done = { ...input, completed: ["الخميس|14:00|CS2301"] };
    const n = nextUp(at(12), done)!;
    // Thursday → Sunday is three days ahead
    expect(n.dayOffset).toBe(3);
    expect(n.item.kind).toBe("lecture");
    expect(nextUpWhen(n, at(12))).toBe("الأحد 8:00 ص");
  });

  it("is empty with nothing planned", () => {
    expect(nextUp(at(9), { schedule: [], tasks: [], completed: [], exams: [] })).toBeNull();
  });
});
