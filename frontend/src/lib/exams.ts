/**
 * The student's exam timetable — countdowns, clashes and a study plan that
 * spreads review time over the days before each exam.
 *
 * Exams are stored one per document at users/{uid}/exams/{id}, in the same
 * shape the agent's add_upcoming_exam tool writes (backend/services/exams.py
 * is the Python twin of the helpers here).
 */

export type ExamType = "final" | "midterm" | "quiz" | "exam" | "assignment";

export interface Exam {
  id: string;
  subject: string;
  course_code: string | null;
  /** YYYY-MM-DD (Makkah calendar day). */
  date: string;
  /** HH:MM, 24h. */
  time: string | null;
  duration_minutes: number;
  location: string | null;
  exam_type: ExamType;
  notes: string;
  done: boolean;
  createdAt?: string;
  updatedAt?: string;
  source?: "app" | "agent";
}

export const DEFAULT_EXAM_MINUTES = 120;
export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  final: "نهائي",
  midterm: "فصلي",
  quiz: "كويز",
  exam: "اختبار",
  assignment: "تسليم",
};
const EXAM_TYPES = Object.keys(EXAM_TYPE_LABELS) as ExamType[];
const AR_WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AR_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => AR_DIGITS[d]);

/** "2026-12-27" → local Date at midnight (no UTC shift). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Local Date → "YYYY-MM-DD". */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

export function weekdayAr(day: string): string {
  return AR_WEEKDAYS[parseDay(day).getDay()];
}

/** "10:00 AM" / "2 م" / "٩:٣٠" / "14:30" → "HH:MM"; null when unreadable. */
export function normalizeTime(value: unknown): string | null {
  if (value == null) return null;
  const s = toLatin(String(value)).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|ص|م|صباحا|صباحاً|مساء|مساءً)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const suffix = m[3] ?? "";
  if ((suffix.startsWith("p") || suffix.startsWith("م")) && hour < 12) hour += 12;
  if ((suffix.startsWith("a") || suffix.startsWith("ص")) && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Clean a Firestore/agent document; null when it has no valid date. */
export function normalizeExam(id: string, raw: Record<string, unknown>): Exam | null {
  const date = toLatin(String(raw.date ?? "")).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parseDay(date).getTime())) return null;
  const duration = Number(raw.duration_minutes ?? DEFAULT_EXAM_MINUTES);
  const type = String(raw.exam_type ?? "exam") as ExamType;
  const code = raw.course_code ? String(raw.course_code).trim().toUpperCase() : "";
  const location = raw.location ? String(raw.location).trim() : "";
  return {
    id,
    subject: String(raw.subject ?? (code || "اختبار")).trim() || "اختبار",
    course_code: code || null,
    date,
    time: normalizeTime(raw.time),
    duration_minutes: Number.isFinite(duration) ? Math.max(15, Math.min(600, Math.round(duration))) : DEFAULT_EXAM_MINUTES,
    location: location || null,
    exam_type: EXAM_TYPES.includes(type) ? type : "exam",
    notes: String(raw.notes ?? ""),
    done: Boolean(raw.done),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    source: raw.source === "agent" ? "agent" : "app",
  };
}

function sortKey(e: Exam): string {
  return `${e.date} ${e.time ?? "99:99"} ${e.subject}`;
}

export function sortExams(exams: Exam[]): Exam[] {
  return [...exams].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

/** Not done and today or later, soonest first. */
export function upcomingExams(exams: Exam[], today: string): Exam[] {
  return sortExams(exams.filter((e) => !e.done && e.date >= today));
}

/** "اليوم" / "غداً" / "بعد 3 أيام" … */
export function whenLabel(days: number): string {
  if (days <= 0) return "اليوم";
  if (days === 1) return "غداً";
  if (days === 2) return "بعد يومين";
  if (days <= 10) return `بعد ${days} أيام`;
  return `بعد ${days} يوماً`;
}

/** Live countdown to the exam start ("2 يوم 5 ساعة" → structured). */
export function countdown(exam: Exam, now: Date): { days: number; hours: number; minutes: number; started: boolean } {
  const start = parseDay(exam.date);
  const [h, m] = (exam.time ?? "08:00").split(":").map(Number);
  start.setHours(h, m, 0, 0);
  const diff = start.getTime() - now.getTime();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, started: true };
  const totalMinutes = Math.floor(diff / 60_000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
    started: false,
  };
}

export interface ExamConflict {
  date: string;
  kind: "overlap" | "same_day";
  exams: [Exam, Exam];
}

const minutesOf = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Same-day pairs; "overlap" when both have times and the slots intersect. */
export function findConflicts(exams: Exam[]): ExamConflict[] {
  const items = sortExams(exams.filter((e) => !e.done));
  const out: ExamConflict[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length && items[j].date === items[i].date; j++) {
      const a = items[i];
      const b = items[j];
      let kind: ExamConflict["kind"] = "same_day";
      if (a.time && b.time) {
        const as = minutesOf(a.time);
        const bs = minutesOf(b.time);
        if (as < bs + b.duration_minutes && bs < as + a.duration_minutes) kind = "overlap";
      }
      out.push({ date: a.date, kind, exams: [a, b] });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Study plan before the exams
// ──────────────────────────────────────────────────────────────────

export interface StudySession {
  /** Stable key for the "done" checkbox: `${date}|${examId}`. */
  key: string;
  date: string;
  examId: string;
  subject: string;
  minutes: number;
  /** The last study day before this exam. */
  finalReview: boolean;
}

export interface ExamStudyPlan {
  days: { date: string; sessions: StudySession[]; examsToday: Exam[] }[];
  /** Planned vs. target minutes per exam. */
  coverage: { examId: string; subject: string; planned: number; target: number }[];
  /** Exams that could not get their target time (too little time left). */
  tight: string[];
}

export interface StudyPlanOptions {
  /** Minutes a student can study on a normal day (default 180). */
  dailyMinutes?: number;
  /** Credit hours per course code, to size each exam's target. */
  creditsByCode?: Record<string, number>;
}

const BLOCK = 15;
const MIN_SESSION = 30;

function targetMinutes(exam: Exam, credits: number | undefined): number {
  const weight = exam.exam_type === "final" ? 1.5 : exam.exam_type === "quiz" ? 0.5 : 1;
  return Math.max(60, Math.round(((credits ?? 3) * 120 * weight) / BLOCK) * BLOCK);
}

/**
 * Spread study time over the days from `today` up to each exam.
 *  • Each exam gets a target (credit hours × 2h; finals ×1.5, quizzes ×0.5).
 *  • Every day, the budget goes to exams that are still ahead, in proportion
 *    to the minutes they still need per remaining day — closer exams win.
 *  • The day before an exam always starts with a final review of it.
 *  • Exam days get half the budget (and nothing for that exam).
 */
export function buildStudyPlan(exams: Exam[], today: string, opts: StudyPlanOptions = {}): ExamStudyPlan {
  const daily = Math.max(MIN_SESSION, opts.dailyMinutes ?? 180);
  const ahead = upcomingExams(exams, today);
  const remaining = new Map<string, number>();
  const target = new Map<string, number>();
  for (const e of ahead) {
    const t = targetMinutes(e, e.course_code ? opts.creditsByCode?.[e.course_code] : undefined);
    target.set(e.id, t);
    remaining.set(e.id, t);
  }
  const days: ExamStudyPlan["days"] = [];
  const last = ahead.length ? ahead[ahead.length - 1].date : today;

  for (let date = today; date <= last; date = addDays(date, 1)) {
    const examsToday = ahead.filter((e) => e.date === date);
    let budget = examsToday.length ? Math.floor(daily / 2 / BLOCK) * BLOCK : daily;
    const sessions: StudySession[] = [];
    const add = (e: Exam, minutes: number, finalReview: boolean) => {
      const existing = sessions.find((s) => s.examId === e.id);
      if (existing) existing.minutes += minutes;
      else sessions.push({ key: `${date}|${e.id}`, date, examId: e.id, subject: e.subject, minutes, finalReview });
      remaining.set(e.id, Math.max(0, (remaining.get(e.id) ?? 0) - minutes));
      budget -= minutes;
    };

    // 1. Final review for tomorrow's exams.
    const tomorrow = ahead.filter((e) => e.date === addDays(date, 1));
    for (const e of tomorrow) {
      if (budget < MIN_SESSION) break;
      const share = Math.floor(budget / tomorrow.length / BLOCK) * BLOCK;
      const minutes = Math.max(MIN_SESSION, Math.min(share, Math.max(remaining.get(e.id) ?? 0, 60)));
      add(e, Math.min(minutes, budget), true);
    }

    // 2. The rest, by need per remaining day.
    const open = ahead.filter((e) => e.date > date && (remaining.get(e.id) ?? 0) > 0);
    const need = open.map((e) => ({ e, perDay: (remaining.get(e.id) ?? 0) / Math.max(1, daysBetween(date, e.date)) }));
    const totalNeed = need.reduce((s, n) => s + n.perDay, 0);
    const pool = budget;
    for (const { e, perDay } of need.sort((a, b) => b.perDay - a.perDay)) {
      if (budget < MIN_SESSION) break;
      let minutes = Math.floor(((pool * perDay) / totalNeed) / BLOCK) * BLOCK;
      minutes = Math.min(minutes, remaining.get(e.id) ?? 0, budget);
      if (minutes < MIN_SESSION) continue;
      add(e, minutes, false);
    }

    if (sessions.length || examsToday.length) days.push({ date, sessions, examsToday });
  }

  const coverage = ahead.map((e) => ({
    examId: e.id,
    subject: e.subject,
    target: target.get(e.id) ?? 0,
    planned: (target.get(e.id) ?? 0) - (remaining.get(e.id) ?? 0),
  }));
  return {
    days,
    coverage,
    tight: coverage.filter((c) => c.planned < c.target * 0.6).map((c) => c.examId),
  };
}

/** "ساعتين و30 د" style label for minutes. */
export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hours = h === 0 ? "" : h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${h} ساعات`;
  if (!hours) return `${m} د`;
  return m ? `${hours} و${m} د` : hours;
}
