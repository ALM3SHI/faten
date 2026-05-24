/**
 * بيانات التقويم الأكاديمي لجامعة أم القرى 1447 / 1448 هـ
 * Academic Calendar Data for Umm Al-Qura University
 */

export interface CalendarEvent {
  title: string;
  date: string;
  hijri: string;
  type: 'academic' | 'exam' | 'holiday' | 'system';
}

export interface CalendarTerm {
  term: string;
  events: CalendarEvent[];
}

export const UQU_CALENDAR: CalendarTerm[] = [
  {
    term: "الفصل الدراسي الأول",
    events: [
      { title: "بداية الفصل الدراسي الأول", date: "24 Aug 2025", hijri: "01/03/1447", type: "academic" },
      { title: "تأجيل الدراسة", date: "24 Aug - 30 Aug 2025", hijri: "01/03 - 07/03/1447", type: "system" },
      { title: "الاعتذار عن الدراسة", date: "31 Aug - 01 Nov 2025", hijri: "08/03 - 10/05/1447", type: "system" },
      { title: "إجازة اليوم الوطني", date: "23 Sep 2025", hijri: "01/04/1447", type: "holiday" },
      { title: "الاختبارات النصفية", date: "19 Oct - 30 Oct 2025", hijri: "27/04 - 08/05/1447", type: "exam" },
      { title: "الانسحاب من مقرر دراسي", date: "02 Nov - 15 Nov 2025", hijri: "11/05 - 24/05/1447", type: "system" },
      { title: "إجازة الخريف", date: "20 Nov - 29 Nov 2025", hijri: "29/05 - 08/06/1447", type: "holiday" },
      { title: "اختبارات المتطلبات العامة والعملية", date: "21 Dec - 25 Dec 2025", hijri: "01/07 - 05/07/1447", type: "exam" },
      { title: "تقديم طلب إعادة القيد للفصل الثاني", date: "21 Dec 2025 - 22 Jan 2026", hijri: "01/07 - 03/08/1447", type: "system" },
      { title: "الاختبارات النهائية", date: "28 Dec 2025 - 08 Jan 2026", hijri: "08/07 - 19/07/1447", type: "exam" },
      { title: "إجازة منتصف العام الدراسي", date: "08 Jan - 17 Jan 2026", hijri: "19/07 - 28/07/1447", type: "holiday" },
    ],
  },
  {
    term: "الفصل الدراسي الثاني",
    events: [
      { title: "تأجيل الدراسة", date: "18 Jan - 24 Jan 2026", hijri: "29/07 - 05/08/1447", type: "system" },
      { title: "بداية الفصل الدراسي الثاني", date: "18 Jan 2026", hijri: "29/07/1447", type: "academic" },
      { title: "الاعتذار عن الدراسة", date: "25 Jan - 18 Apr 2026", hijri: "06/08 - 01/11/1447", type: "system" },
      { title: "إجازة يوم التأسيس", date: "22 Feb 2026", hijri: "05/09/1447", type: "holiday" },
      { title: "إجازة عيد الفطر", date: "05 Mar - 28 Mar 2026", hijri: "16/09 - 09/10/1447", type: "holiday" },
      { title: "الاختبارات النصفية", date: "05 Apr - 16 Apr 2026", hijri: "17/10 - 28/10/1447", type: "exam" },
      { title: "طلب التحويل بين الكليات والأقسام", date: "05 Apr - 18 Apr 2026", hijri: "17/10 - 01/11/1447", type: "system" },
      { title: "الانسحاب من مقرر دراسي", date: "19 Apr - 02 May 2026", hijri: "02/11 - 15/11/1447", type: "system" },
      { title: "إدخال رغبات التسكين (تحضيري)", date: "03 May - 09 May 2026", hijri: "16/11 - 22/11/1447", type: "academic" },
      { title: "إجازة عيد الأضحى", date: "14 May - 01 Jun 2026", hijri: "27/11 - 15/12/1447", type: "holiday" },
      { title: "طلب إعادة القيد للفصل الصيفي", date: "07 Jun - 30 Jun 2026", hijri: "21/12/1447 - 15/01/1448", type: "system" },
      { title: "اختبارات المتطلبات العامة والعملية", date: "07 Jun - 11 Jun 2026", hijri: "21/12 - 25/12/1447", type: "exam" },
      { title: "الاختبارات النهائية", date: "14 Jun - 25 Jun 2026", hijri: "28/12/1447 - 10/01/1448", type: "exam" },
      { title: "إجازة نهاية العام الدراسي", date: "25 Jun 2026", hijri: "10/01/1448", type: "holiday" },
      { title: "التحويل الخارجي لجامعة أم القرى", date: "25 Jun - 04 Jul 2026", hijri: "10/01 - 19/01/1448", type: "system" },
    ],
  },
  {
    term: "العام الجامعي القادم",
    events: [
      { title: "بداية الدراسة للعام الجامعي 1448/1449هـ", date: "23 Aug 2026", hijri: "10/03/1448", type: "academic" }
    ]
  }
];

/**
 * البحث في التقويم الجامعي
 * Search the academic calendar
 */
export function searchCalendar(query: string): CalendarEvent[] {
  const normalizedQuery = query.toLowerCase().trim();
  const results: CalendarEvent[] = [];

  for (const term of UQU_CALENDAR) {
    for (const event of term.events) {
      const titleMatch = event.title.toLowerCase().includes(normalizedQuery);
      const typeMatch = event.type === normalizedQuery;
      const dateMatch = event.date.toLowerCase().includes(normalizedQuery) || 
                       event.hijri.includes(normalizedQuery);

      if (titleMatch || typeMatch || dateMatch) {
        results.push(event);
      }
    }
  }

  return results;
}

/**
 * الحصول على الأحداث حسب النوع
 * Get events by type
 */
export function getEventsByType(type: CalendarEvent['type']): CalendarEvent[] {
  const results: CalendarEvent[] = [];
  
  for (const term of UQU_CALENDAR) {
    for (const event of term.events) {
      if (event.type === type) {
        results.push(event);
      }
    }
  }

  return results;
}

/**
 * الحصول على أحداث فصل دراسي معين
 * Get events for a specific term
 */
export function getTermEvents(termName: string): CalendarEvent[] {
  const term = UQU_CALENDAR.find(t => t.term.includes(termName));
  return term?.events ?? [];
}

/**
 * الحصول على الحدث القادم
 * Get the next upcoming event
 */
export function getNextEvent(): CalendarEvent | null {
  const now = new Date();
  
  for (const term of UQU_CALENDAR) {
    for (const event of term.events) {
      // استخراج أول تاريخ من النطاق
      const datePart = event.date.split(' - ')[0];
      const eventDate = new Date(datePart);
      
      if (eventDate > now) {
        return event;
      }
    }
  }

  return null;
}