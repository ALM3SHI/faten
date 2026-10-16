import { describe, expect, it } from "vitest";
import { COURSE_PALETTE, courseColors, courseShares, dayLoad, minutesShort, weekPlan } from "@/lib/plan-week";
import { weekDates } from "@/lib/agenda";
import type { PlanTask } from "@/store/planStore";
import type { ScheduleSlot } from "@/store/scheduleStore";

const THU = new Date(2026, 9, 15);
const task = (over: Partial<PlanTask>): PlanTask => ({
  title: "مراجعة", courseCode: "CS2301", courseName: "هياكل البيانات", durationMinutes: 60,
  suggestedDay: "الخميس", suggestedTime: "14:00", priority: "medium", reason: "", ...over,
});
const lecture: ScheduleSlot = {
  course_code: "CS2301", course_name: "هياكل البيانات", day: "الخميس", start_time: "10:00", end_time: "11:40", type: "نظري",
};

describe("plan week", () => {
  it("gives each course its own colour, in order of appearance", () => {
    const c = courseColors(["CS2301", "CS3601", "CS2301", "", "MATH1"]);
    expect(c.CS2301).toBe(COURSE_PALETTE[0]);
    expect(c.CS3601).toBe(COURSE_PALETTE[1]);
    expect(c.MATH1).toBe(COURSE_PALETTE[2]);
    expect(Object.keys(c)).toHaveLength(3);
  });

  it("adds lecture and study minutes of a day, done and not", () => {
    const tasks = [
      task({}),
      task({ suggestedTime: "20:00", durationMinutes: 45, courseCode: "CS3601" }),
      task({ suggestedTime: "16:00", targetDate: "2026-10-15", taskType: "exam" }),
    ];
    const [, , , , thu] = weekPlan(weekDates(THU), { schedule: [lecture], tasks, completed: ["الخميس|14:00|CS2301"], exams: [] });
    expect(thu.load.lectureMin).toBe(100);
    expect(thu.load.studyMin).toBe(105);
    expect(thu.load.doneMin).toBe(60);
    expect(thu.load.sessions.map((s) => s.code)).toEqual(["CS2301", "CS3601"]);
    expect(dayLoad([]).studyMin).toBe(0);
  });

  it("shares the week's study time by course, keeping courses with no session", () => {
    const rows = courseShares(
      [{ code: "CS2301", name: "هياكل البيانات" }, { code: "ST2101", name: "الإحصاء" }],
      [task({}), task({ suggestedDay: "الأحد" }), task({ courseCode: "CS3601", courseName: "الشبكات", durationMinutes: 30 }), task({ targetDate: "2026-10-20", courseCode: "ST2101" })],
      ["الأحد|14:00|CS2301"],
    );
    expect(rows.map((r) => [r.code, r.sessions, r.plannedMin, r.doneMin])).toEqual([
      ["CS2301", 2, 120, 60],
      ["CS3601", 1, 30, 0],
      ["ST2101", 0, 0, 0],
    ]);
  });

  it("writes short durations", () => {
    expect(minutesShort(45)).toBe("45 د");
    expect(minutesShort(90)).toBe("1.5 س");
    expect(minutesShort(120)).toBe("2 س");
  });
});
