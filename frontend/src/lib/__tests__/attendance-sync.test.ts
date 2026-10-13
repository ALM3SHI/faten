import { describe, expect, it } from "vitest";
import { newerAttendance } from "@/lib/attendance";

describe("newerAttendance", () => {
  it("takes the account copy on a fresh device", () => {
    expect(newerAttendance(null, "2026-10-10T08:00:00.000Z")).toBe("remote");
  });

  it("keeps this device's copy when it changed after the account's", () => {
    expect(newerAttendance("2026-10-12T08:00:00.000Z", "2026-10-10T08:00:00.000Z")).toBe("local");
    expect(newerAttendance("2026-10-12T08:00:00.000Z", null)).toBe("local");
  });

  it("does nothing when both are the same or both are empty", () => {
    expect(newerAttendance("2026-10-10T08:00:00.000Z", "2026-10-10T08:00:00.000Z")).toBe("same");
    expect(newerAttendance(null, undefined)).toBe("same");
  });
});
