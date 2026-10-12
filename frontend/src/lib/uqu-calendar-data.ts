/**
 * التقويم الأكاديمي لجامعة أم القرى — العام الجامعي 1448هـ (2026/2027م)
 *
 * المصدر: التقويم الأكاديمي المعتمد من عمادة القبول والتسجيل
 *   https://uqu.edu.sa/App/AcademicCalendar
 * (عند صدور تقويم جديد: حدّث هذا الملف و backend/data/uqu_calendar.py معاً.)
 *
 * `start` / `end` are ISO dates and drive every date computation.
 * `date` is the legacy English display string kept for the chat agent.
 */

export interface CalendarEvent {
  title: string;
  /** ISO yyyy-mm-dd */
  start: string;
  /** ISO yyyy-mm-dd, or null for single-day events */
  end: string | null;
  date: string;
  hijri: string;
  type: "academic" | "exam" | "holiday" | "system";
}

export interface CalendarTerm {
  term: string;
  events: CalendarEvent[];
}

export const ACADEMIC_YEAR_LABEL = "1448هـ";

export const UQU_CALENDAR: CalendarTerm[] = [
  {
    term: "الفصل الدراسي الأول",
    events: [
      { title: "بداية الفصل الدراسي الأول", start: "2026-08-23", end: null, date: "23 Aug 2026", hijri: "10/03/1448", type: "academic" },
      { title: "تأجيل الدراسة", start: "2026-08-23", end: "2026-08-29", date: "23 Aug - 29 Aug 2026", hijri: "10/03 - 16/03/1448", type: "system" },
      { title: "الاعتذار عن الدراسة", start: "2026-08-30", end: "2026-10-31", date: "30 Aug - 31 Oct 2026", hijri: "17/03 - 20/05/1448", type: "system" },
      { title: "إجازة اليوم الوطني", start: "2026-09-23", end: "2026-09-24", date: "23 Sep - 24 Sep 2026", hijri: "12/04 - 13/04/1448", type: "holiday" },
      { title: "الاختبارات النصفية", start: "2026-10-11", end: "2026-10-22", date: "11 Oct - 22 Oct 2026", hijri: "30/04 - 11/05/1448", type: "exam" },
      { title: "الانسحاب من مقرر دراسي", start: "2026-11-01", end: "2026-11-07", date: "01 Nov - 07 Nov 2026", hijri: "21/05 - 27/05/1448", type: "system" },
      { title: "إجازة الخريف", start: "2026-11-19", end: "2026-11-28", date: "19 Nov - 28 Nov 2026", hijri: "09/06 - 18/06/1448", type: "holiday" },
      { title: "اختبارات المتطلبات العامة والعملية", start: "2026-12-13", end: "2026-12-24", date: "13 Dec - 24 Dec 2026", hijri: "04/07 - 15/07/1448", type: "exam" },
      { title: "طلب إعادة القيد للفصل الثاني", start: "2026-12-20", end: "2027-01-21", date: "20 Dec 2026 - 21 Jan 2027", hijri: "11/07 - 13/08/1448", type: "system" },
      { title: "الاختبارات النهائية", start: "2026-12-27", end: "2027-01-07", date: "27 Dec 2026 - 07 Jan 2027", hijri: "18/07 - 29/07/1448", type: "exam" },
      { title: "إجازة منتصف العام الدراسي", start: "2027-01-07", end: "2027-01-16", date: "07 Jan - 16 Jan 2027", hijri: "29/07 - 08/08/1448", type: "holiday" },
    ],
  },
  {
    term: "الفصل الدراسي الثاني",
    events: [
      { title: "بداية الفصل الدراسي الثاني", start: "2027-01-17", end: null, date: "17 Jan 2027", hijri: "09/08/1448", type: "academic" },
      { title: "تأجيل الدراسة", start: "2027-01-17", end: "2027-01-23", date: "17 Jan - 23 Jan 2027", hijri: "09/08 - 15/08/1448", type: "system" },
      { title: "الاعتذار عن الدراسة", start: "2027-01-24", end: "2027-04-17", date: "24 Jan - 17 Apr 2027", hijri: "16/08 - 10/11/1448", type: "system" },
      { title: "إجازة يوم التأسيس", start: "2027-02-21", end: "2027-02-22", date: "21 Feb - 22 Feb 2027", hijri: "14/09 - 15/09/1448", type: "holiday" },
      { title: "إجازة عيد الفطر", start: "2027-02-23", end: "2027-03-13", date: "23 Feb - 13 Mar 2027", hijri: "16/09 - 05/10/1448", type: "holiday" },
      { title: "الاختبارات النصفية", start: "2027-03-28", end: "2027-04-08", date: "28 Mar - 08 Apr 2027", hijri: "20/10 - 02/11/1448", type: "exam" },
      { title: "طلب التحويل بين الكليات والأقسام", start: "2027-03-28", end: "2027-04-10", date: "28 Mar - 10 Apr 2027", hijri: "20/10 - 04/11/1448", type: "system" },
      { title: "الانسحاب من مقرر دراسي", start: "2027-04-18", end: "2027-04-24", date: "18 Apr - 24 Apr 2027", hijri: "11/11 - 17/11/1448", type: "system" },
      { title: "إدخال رغبات التسكين (السنة الأولى والتأهيلية)", start: "2027-04-25", end: "2027-05-01", date: "25 Apr - 01 May 2027", hijri: "18/11 - 24/11/1448", type: "academic" },
      { title: "إجازة عيد الأضحى", start: "2027-05-03", end: "2027-05-22", date: "03 May - 22 May 2027", hijri: "26/11 - 16/12/1448", type: "holiday" },
      { title: "اختبارات المتطلبات العامة والعملية", start: "2027-05-30", end: "2027-06-10", date: "30 May - 10 Jun 2027", hijri: "24/12/1448 - 05/01/1449", type: "exam" },
      { title: "طلب إعادة القيد للفصل الصيفي", start: "2027-06-06", end: "2027-06-29", date: "06 Jun - 29 Jun 2027", hijri: "01/01 - 24/01/1449", type: "system" },
      { title: "الاختبارات النهائية", start: "2027-06-13", end: "2027-06-24", date: "13 Jun - 24 Jun 2027", hijri: "08/01 - 19/01/1449", type: "exam" },
      { title: "إجازة نهاية العام الدراسي", start: "2027-06-24", end: null, date: "24 Jun 2027", hijri: "19/01/1449", type: "holiday" },
      { title: "التحويل الخارجي إلى جامعة أم القرى", start: "2027-06-24", end: "2027-07-03", date: "24 Jun - 03 Jul 2027", hijri: "19/01 - 28/01/1449", type: "system" },
    ],
  },
];

// ── Date helpers ──────────────────────────────────────────────────────

/** Parse an ISO date as a local calendar day (avoids UTC off-by-one). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function eventStart(ev: CalendarEvent): Date {
  return parseISODate(ev.start);
}

export function eventEnd(ev: CalendarEvent): Date {
  return parseISODate(ev.end ?? ev.start);
}

const AR_DAY_MONTH = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long" });
const AR_FULL = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric" });

/** "23 أغسطس 2026" or "13 – 24 ديسمبر 2026" style Arabic range. */
export function formatEventDateAr(ev: CalendarEvent): string {
  const s = eventStart(ev);
  if (!ev.end || ev.end === ev.start) return AR_FULL.format(s);
  const e = eventEnd(ev);
  const sameYear = s.getFullYear() === e.getFullYear();
  return `${sameYear ? AR_DAY_MONTH.format(s) : AR_FULL.format(s)} – ${AR_FULL.format(e)}`;
}

function allEvents(): CalendarEvent[] {
  return UQU_CALENDAR.flatMap((t) => t.events);
}

/** Events that have not finished yet, soonest first. */
export function getUpcomingEvents(from: Date = new Date()): CalendarEvent[] {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return allEvents()
    .filter((ev) => eventEnd(ev) >= today)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
}

/** True when the event is happening on the given day. */
export function isOngoing(ev: CalendarEvent, on: Date = new Date()): boolean {
  const day = new Date(on.getFullYear(), on.getMonth(), on.getDate());
  return eventStart(ev) <= day && day <= eventEnd(ev);
}

/**
 * البحث في التقويم الجامعي
 */
export function searchCalendar(query: string): CalendarEvent[] {
  const q = query.toLowerCase().trim();
  return allEvents().filter(
    (ev) =>
      ev.title.toLowerCase().includes(q) ||
      ev.type === q ||
      ev.date.toLowerCase().includes(q) ||
      ev.hijri.includes(q),
  );
}

/** الأحداث حسب النوع */
export function getEventsByType(type: CalendarEvent["type"]): CalendarEvent[] {
  return allEvents().filter((ev) => ev.type === type);
}

/** أحداث فصل دراسي معين */
export function getTermEvents(termName: string): CalendarEvent[] {
  return UQU_CALENDAR.find((t) => t.term.includes(termName))?.events ?? [];
}

/** الحدث القادم (أول حدث لم يبدأ بعد) */
export function getNextEvent(from: Date = new Date()): CalendarEvent | null {
  return allEvents()
    .filter((ev) => eventStart(ev) > from)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime())[0] ?? null;
}
