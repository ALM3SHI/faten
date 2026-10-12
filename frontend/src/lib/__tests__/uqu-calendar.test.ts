import { describe, expect, it } from "vitest";
import {
  UQU_CALENDAR,
  eventEnd,
  eventStart,
  formatEventDateAr,
  getNextEvent,
  getUpcomingEvents,
  isOngoing,
  parseISODate,
} from "@/lib/uqu-calendar-data";
import { STORAGE_KEYS } from "@/lib/core";

const all = UQU_CALENDAR.flatMap((t) => t.events);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe("calendar data integrity", () => {
  it("has two terms with events", () => {
    expect(UQU_CALENDAR).toHaveLength(2);
    expect(all.length).toBe(26);
  });
  it("every event has valid ISO dates and end >= start", () => {
    for (const ev of all) {
      expect(ev.start, ev.title).toMatch(ISO);
      if (ev.end) {
        expect(ev.end, ev.title).toMatch(ISO);
        expect(eventEnd(ev).getTime(), ev.title).toBeGreaterThanOrEqual(eventStart(ev).getTime());
      }
      expect(["academic", "exam", "holiday", "system"]).toContain(ev.type);
    }
  });
  it("each term starts with its own start event", () => {
    expect(UQU_CALENDAR[0].events[0].start).toBe("2026-08-23");
    expect(UQU_CALENDAR[1].events[0].start).toBe("2027-01-17");
  });
});

describe("date helpers", () => {
  it("parses ISO as a local day (no UTC shift)", () => {
    const d = parseISODate("2026-10-11");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 11]);
  });

  it("formats ranges in Arabic with Latin digits", () => {
    const midterms = all.find((e) => e.title === "الاختبارات النصفية")!;
    const s = formatEventDateAr(midterms);
    expect(s).toContain("11");
    expect(s).toContain("22");
    expect(s).toContain("2026");
    expect(s).toContain("–");
  });

  it("isOngoing covers the whole range inclusively", () => {
    const midterms = all.find((e) => e.start === "2026-10-11")!;
    expect(isOngoing(midterms, new Date(2026, 9, 11, 23, 0))).toBe(true);
    expect(isOngoing(midterms, new Date(2026, 9, 22, 8, 0))).toBe(true);
    expect(isOngoing(midterms, new Date(2026, 9, 23))).toBe(false);
  });

  it("upcoming events include ongoing ones and are sorted", () => {
    const up = getUpcomingEvents(new Date(2026, 9, 12));
    expect(up.some((e) => e.start === "2026-10-11")).toBe(true);
    for (let i = 1; i < up.length; i++) {
      expect(eventStart(up[i]).getTime()).toBeGreaterThanOrEqual(eventStart(up[i - 1]).getTime());
    }
  });

  it("next event is the first one that has not started", () => {
    const next = getNextEvent(new Date(2026, 9, 12));
    expect(next?.start).toBe("2026-11-01");
    expect(getNextEvent(new Date(2030, 0, 1))).toBeNull();
  });
});

describe("storage keys", () => {
  it("theme key matches the inline script in layout.tsx", () => {
    expect(STORAGE_KEYS.THEME).toBe("uqu-theme");
  });
});
