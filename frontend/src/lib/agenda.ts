/**
 * «وقتي» — one agenda for the day that merges what used to live on five
 * pages: lectures (timetable), study sessions (plan), exams, and prayer
 * times as light dividers. Pure functions; the page supplies the data.
 */

import { AR_WEEKDAYS } from "@/lib/academic-term";
import { parseTimeToMinutes } from "@/lib/schedule-grid";
import { dayKey, type Exam } from "@/lib/exams";
import type { PrayerTime } from "@/lib/prayer-times";
import { isDatedEvent, taskKey, type PlanTask } from "@/store/planStore";
import type { ScheduleSlot } from "@/store/scheduleStore";

export type AgendaItem =
  | { kind: "lecture"; start: number; end: number; slot: ScheduleSlot }
  | { kind: "task"; start: number; end: number; task: PlanTask; key: string; done: boolean }
  | { kind: "exam"; start: number; end: number; exam: Exam }
  | { kind: "prayer"; start: number; end: number; name: string; time: string };

export interface AgendaInput {
  schedule: ScheduleSlot[];
  tasks: PlanTask[];
  completed: string[];
  exams: Exam[];
  /** Prayer times for this date; only those inside the day's busy span are shown. */
  prayers?: PrayerTime[];
}

/** Sunday → Saturday of the week that contains `now` (local midnight). */
export function weekDates(now: Date): Date[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const ORDER: Record<AgendaItem["kind"], number> = { exam: 0, lecture: 1, task: 2, prayer: 3 };

/** Everything on one date, in time order, with prayer dividers in between. */
export function buildAgenda(date: Date, input: AgendaInput): AgendaItem[] {
  const weekday = AR_WEEKDAYS[date.getDay()];
  const key = dayKey(date);
  const done = new Set(input.completed);
  const items: AgendaItem[] = [];

  for (const slot of input.schedule) {
    if (String(slot.day ?? "").trim() !== weekday) continue;
    const start = parseTimeToMinutes(slot.start_time ?? "");
    if (start === null) continue;
    const end = parseTimeToMinutes(slot.end_time ?? "") ?? start + 50;
    items.push({ kind: "lecture", start, end, slot });
  }

  for (const task of input.tasks) {
    const onThisDay = isDatedEvent(task) ? task.targetDate === key : task.suggestedDay === weekday;
    if (!onThisDay) continue;
    const start = parseTimeToMinutes(task.suggestedTime ?? "");
    if (start === null) continue;
    const k = taskKey(task);
    items.push({ kind: "task", start, end: start + (task.durationMinutes || 0), task, key: k, done: done.has(k) });
  }

  for (const exam of input.exams) {
    if (exam.done || exam.date !== key) continue;
    const start = parseTimeToMinutes(exam.time ?? "") ?? 8 * 60;
    items.push({ kind: "exam", start, end: start + (exam.duration_minutes || 0), exam });
  }

  items.sort((a, b) => a.start - b.start || ORDER[a.kind] - ORDER[b.kind]);
  if (items.length === 0 || !input.prayers?.length) return items;

  // Prayers only where they break up the day: after the first thing starts
  // and before the last thing ends.
  const first = items[0].start;
  const last = Math.max(...items.map((i) => i.end));
  for (const p of input.prayers) {
    const m = parseTimeToMinutes(p.time);
    if (m === null || m <= first || m >= last) continue;
    items.push({ kind: "prayer", start: m, end: m, name: p.name, time: p.time });
  }
  return items.sort((a, b) => a.start - b.start || ORDER[a.kind] - ORDER[b.kind]);
}

/** "13:05" → "1:05 م" · "09:00" → "9:00 ص". */
export function formatClock(time: string): string {
  const m = parseTimeToMinutes(time);
  if (m === null) return time;
  const h = Math.floor(m / 60);
  const min = String(m % 60).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${h < 12 ? "ص" : "م"}`;
}

/** Minutes since midnight → "1:05 م". */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60) % 24;
  return formatClock(`${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
}

/**
 * Deep link into the indoor map for a timetable room. The map's rooms are
 * numbered «قاعة 12» → Room_12; anything else opens the map unselected.
 */
export function roomHref(room: string | undefined | null): string {
  const n = String(room ?? "").match(/^\D*(\d{1,3})\D*$/);
  return n ? `/locations?target=Room_${Number(n[1])}` : "/locations";
}

export interface NextUp {
  item: Exclude<AgendaItem, { kind: "prayer" }>;
  /** 0 = today, 1 = tomorrow, … */
  dayOffset: number;
  date: Date;
  /** Already started (today only). */
  now: boolean;
}

/**
 * «التالي» — the thing in progress or the next one: a lecture, a study
 * session not yet done, an exam or an appointment, looking up to a week
 * ahead. Done sessions and prayer dividers are skipped.
 */
export function nextUp(now: Date, input: AgendaInput): NextUp | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const items = buildAgenda(date, { ...input, prayers: undefined });
    for (const it of items) {
      if (it.kind === "prayer") continue;
      if (it.kind === "task" && it.done) continue;
      const end = Math.max(it.end, it.start + 1);
      if (offset === 0 && end <= nowMin) continue;
      return { item: it, dayOffset: offset, date, now: offset === 0 && it.start <= nowMin };
    }
  }
  return null;
}

/** "الآن" · "بعد 25 د" · "بعد ساعة" · "2:00 م" · "بكرة 8:00 ص" · "الأحد 8:00 ص". */
export function nextUpWhen(n: NextUp, now: Date): string {
  const time = formatMinutes(n.item.start);
  if (n.dayOffset === 0) {
    if (n.now) return "الآن";
    const diff = n.item.start - (now.getHours() * 60 + now.getMinutes());
    if (diff < 60) return `بعد ${diff} د`;
    if (diff < 120) return "بعد ساعة";
    return time;
  }
  if (n.dayOffset === 1) return `بكرة ${time}`;
  return `${AR_WEEKDAYS[n.date.getDay()]} ${time}`;
}
