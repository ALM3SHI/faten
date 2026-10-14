import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS,
  clockSkew,
  finishPeriod,
  lectureTerms,
  linkPageRefs,
  masteredCount,
  mergeTerms,
  mmss,
  pauseFocus,
  remainingSec,
  resumeFocus,
  slideFromHref,
  startFocus,
  stopFocus,
  type Lecture,
  type TutorState,
} from "@/lib/tutor";

const T0 = Date.parse("2026-10-14T09:00:00Z");

describe("focus timer uses absolute times", () => {
  it("counts down from the start time, even if the page was closed", () => {
    const f = startFocus({ ...DEFAULT_FOCUS, focusMin: 25 }, T0);
    expect(f.mode).toBe("focus");
    expect(remainingSec(f, T0)).toBe(1500);
    // page closed for 10 minutes, then reopened
    expect(remainingSec(f, T0 + 10 * 60_000)).toBe(900);
    expect(remainingSec(f, T0 + 60 * 60_000)).toBe(0);
  });

  it("pausing freezes the clock and resuming excludes the pause", () => {
    let f = startFocus(DEFAULT_FOCUS, T0);
    f = pauseFocus(f, T0 + 5 * 60_000);
    expect(remainingSec(f, T0 + 50 * 60_000)).toBe(1200);
    f = resumeFocus(f, T0 + 15 * 60_000);
    expect(f.pausedTotalSec).toBe(600);
    expect(remainingSec(f, T0 + 15 * 60_000)).toBe(1200);
    expect(pauseFocus(pauseFocus(f, T0), T0 + 1).pausedAt).toBe(new Date(T0).toISOString());
  });

  it("a finished focus period starts a break and counts the session; a break ends idle", () => {
    const f = startFocus({ ...DEFAULT_FOCUS, breakMin: 5 }, T0);
    const { next, completedFocus } = finishPeriod(f, T0 + 1500_000);
    expect(completedFocus).toBe(true);
    expect(next.mode).toBe("break");
    expect(next.durationSec).toBe(300);
    expect(next.completedFocus).toBe(1);
    const after = finishPeriod(next, T0 + 1800_000);
    expect(after.completedFocus).toBe(false);
    expect(after.next.mode).toBe("idle");
    expect(stopFocus(next).startedAt).toBeNull();
    expect(remainingSec(stopFocus(next), T0)).toBe(0);
  });

  it("corrects for the device clock using the server time", () => {
    expect(clockSkew("2026-10-14T09:00:05Z", T0)).toBe(5000);
    expect(clockSkew(undefined, T0)).toBe(0);
    expect(mmss(65)).toBe("01:05");
  });
});

describe("page references", () => {
  it("turns [ص N] citations into slide links", () => {
    expect(linkPageRefs("كما في [ص 12] و[ص 3-5]")).toBe("كما في [📄 ص 12](#slide-12) و[📄 ص 3–5](#slide-3)");
    expect(linkPageRefs("انظر [ص 2]\n```py\nx = a[ص 2]\n```\nو `[ص 4]`")).toBe("انظر [📄 ص 2](#slide-2)\n```py\nx = a[ص 2]\n```\nو `[ص 4]`");
    expect(slideFromHref("#slide-7")).toBe(7);
    expect(slideFromHref("/plan")).toBeNull();
    expect(slideFromHref("#slide-x")).toBeNull();
  });
});

const lecture = {
  id: "Labc",
  title: "هياكل البيانات",
  fileName: "ds.pdf",
  fileHash: "h",
  pageCount: 4,
  topics: [
    { id: "t1", title: "المكدس", pages: [1, 2], objectives: [], concepts: [], prerequisites: [], importance: 3, est_minutes: 10, key_terms: [{ term: "Stack", definition: "LIFO" }, { term: "Push", definition: "إضافة" }] },
    { id: "t2", title: "الطابور", pages: [3, 4], objectives: [], concepts: [], prerequisites: [], importance: 2, est_minutes: 10, key_terms: [{ term: "stack ", definition: "مكرر" }, { term: "Queue", definition: "FIFO" }, { term: "Empty", definition: "" }] },
  ],
} as unknown as Lecture;

describe("review cards from the lecture", () => {
  it("collects unique key terms (per topic or whole lecture)", () => {
    expect(lectureTerms(lecture, "t1").map((t) => t.term)).toEqual(["Stack", "Push"]);
    expect(lectureTerms(lecture).map((t) => t.term)).toEqual(["Stack", "Push", "Queue"]);
  });

  it("merges into an existing pack without duplicates", () => {
    const { merged, added } = mergeTerms([{ term: "Stack", definition: "LIFO" }], lectureTerms(lecture));
    expect(added).toBe(2);
    expect(merged.map((t) => t.term)).toEqual(["Stack", "Push", "Queue"]);
  });
});

describe("progress header", () => {
  it("counts mastered topics, including ones due for a review", () => {
    const state = {
      topics: {
        t1: { status: "mastered" },
        t2: { status: "review_due" },
        t3: { status: "needs_review" },
        t4: { status: "in_progress" },
      },
    } as unknown as TutorState;
    expect(masteredCount(state)).toEqual({ mastered: 2, total: 4 });
  });
});
