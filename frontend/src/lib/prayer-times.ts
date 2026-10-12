/**
 * Prayer times for Makkah, Umm al-Qura calculation method (the official
 * Saudi method). Computed locally with `adhan` — no network, no API key.
 */

import { CalculationMethod, Coordinates, PrayerTimes } from "adhan";

/** Masjid al-Haram — UQU's main campuses are within a few km. */
export const MAKKAH = { latitude: 21.4225, longitude: 39.8262 };

export type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

export const PRAYER_NAMES: Record<PrayerKey, string> = {
  fajr: "الفجر",
  dhuhr: "الظهر",
  asr: "العصر",
  maghrib: "المغرب",
  isha: "العشاء",
};

export interface PrayerTime {
  key: PrayerKey;
  name: string;
  /** "HH:MM" in Makkah time (UTC+3). */
  time: string;
}

const FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Riyadh",
});

export function prayerTimesFor(date: Date, keys: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"]): PrayerTime[] {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const pt = new PrayerTimes(
    new Coordinates(MAKKAH.latitude, MAKKAH.longitude),
    day,
    CalculationMethod.UmmAlQura(),
  );
  return keys.map((key) => ({ key, name: PRAYER_NAMES[key], time: FMT.format(pt[key]) }));
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** True when the prayer time falls strictly inside the lecture. */
export function prayerDuringLecture(prayer: string, start: string, end: string): boolean {
  const p = toMinutes(prayer);
  return p > toMinutes(start) && p < toMinutes(end);
}

/** Date of the given weekday (getDay()) in the week containing `ref` (week starts Sunday). */
export function dateOfWeekday(ref: Date, weekday: number): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() + weekday);
}
