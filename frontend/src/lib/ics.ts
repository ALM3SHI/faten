/**
 * iCalendar (.ics, RFC 5545) export — lets a student add their weekly
 * lectures and the academic calendar to Google / Apple / Outlook calendars.
 * Pure string building, no network.
 */

import type { ScheduleSlot } from "@/store/scheduleStore";
import { UQU_CALENDAR, parseISODate, type CalendarEvent } from "@/lib/uqu-calendar-data";
import { addDays, isHoliday, teachingDates, weekdayIndex, type TermWindow } from "@/lib/academic-term";

const TZID = "Asia/Riyadh";
const PRODID = "-//Faten//UQU Academic Assistant//AR";

// Saudi Arabia has no DST — a single fixed-offset definition is exact.
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0300",
  "TZNAME:AST",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

function hhmm(t: string): string {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return `${pad(h || 0)}${pad(m || 0)}00`;
}

/** Escape TEXT values (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1), UTF-8 aware. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const len = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (curLen + len > limit) {
      parts.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function slug(s: string): string {
  let h = 0;
  for (const ch of s) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

function wrap(events: string[][], name: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${TZID}`,
    ...VTIMEZONE,
    ...events.flat(),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function calendarEventLines(ev: CalendarEvent, now: Date, reminder: boolean): string[] {
  const start = parseISODate(ev.start);
  const endExclusive = addDays(parseISODate(ev.end ?? ev.start), 1);
  const lines = [
    "BEGIN:VEVENT",
    `UID:uqu-${ev.start}-${slug(ev.title)}@faten`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${ymd(start)}`,
    `DTEND;VALUE=DATE:${ymd(endExclusive)}`,
    `SUMMARY:${escapeText(ev.title)}`,
    `DESCRIPTION:${escapeText(`التقويم الأكاديمي لجامعة أم القرى — ${ev.hijri} هـ`)}`,
    "TRANSP:TRANSPARENT",
  ];
  if (reminder) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(ev.title)}`, "TRIGGER:-P1D", "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

/** Academic calendar only (all terms). */
export function buildAcademicCalendarIcs(now: Date = new Date()): string {
  const events = UQU_CALENDAR.flatMap((t) =>
    t.events.map((ev) => calendarEventLines(ev, now, ev.type === "system" || ev.type === "exam")),
  );
  return wrap(events, "التقويم الأكاديمي — أم القرى");
}

/** Weekly lectures for one term (+ that term's academic events). */
export function buildScheduleIcs(slots: ScheduleSlot[], term: TermWindow, now: Date = new Date()): string {
  const events: string[][] = [];
  // RFC 5545: with a TZID DTSTART, UNTIL must be UTC. 23:59:59 Riyadh = 20:59:59Z.
  const until = ymd(term.lastTeachingDay) + "T205959Z";

  slots.forEach((s, i) => {
    const wd = weekdayIndex(String(s.day));
    if (wd < 0 || !s.start_time || !s.end_time) return;
    const dates = teachingDates({ ...term, holidays: [] }, [wd]);
    if (dates.length === 0) return;
    const first = dates[0];
    const exdates = dates.filter((d) => isHoliday(d, term));
    const where = [s.building, s.room].filter(Boolean).join(" / ");
    const title = `${s.course_name || s.course_code}${s.type === "عملي" ? " (عملي)" : ""}`;
    const lines = [
      "BEGIN:VEVENT",
      `UID:lecture-${slug(`${s.course_code}|${s.day}|${s.start_time}|${i}`)}-${ymd(term.start)}@faten`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;TZID=${TZID}:${ymd(first)}T${hhmm(s.start_time)}`,
      `DTEND;TZID=${TZID}:${ymd(first)}T${hhmm(s.end_time)}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${until}`,
      ...exdates.map((d) => `EXDATE;TZID=${TZID}:${ymd(d)}T${hhmm(s.start_time)}`),
      `SUMMARY:${escapeText(title)}`,
      ...(where ? [`LOCATION:${escapeText(where)}`] : []),
      `DESCRIPTION:${escapeText([s.course_code, s.type].filter(Boolean).join(" · "))}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(title)}`,
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT",
    ];
    events.push(lines);
  });

  const termEvents = UQU_CALENDAR.find((t) => t.term === term.term)?.events ?? [];
  termEvents.forEach((ev) => events.push(calendarEventLines(ev, now, ev.type === "system" || ev.type === "exam")));

  return wrap(events, `جدولي — ${term.term}`);
}

/** Trigger a download in the browser. */
export function downloadIcs(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
