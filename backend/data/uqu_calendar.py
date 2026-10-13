"""
UQU academic calendar — academic year 1448 AH (2026/2027).

Single source for the chat agent's get_calendar_info tool and the
"current term" context in agent/tools_schema.py. Keep in sync with
frontend/src/lib/uqu-calendar-data.ts when a new calendar is published:
https://uqu.edu.sa/App/AcademicCalendar
"""

import datetime as _dt

ACADEMIC_YEAR = "1448"

# Shown under date answers in the chat as the source the dates come from.
CALENDAR_SOURCE = {
    "document": f"التقويم الأكاديمي لجامعة أم القرى {ACADEMIC_YEAR}هـ",
    "url": "https://uqu.edu.sa/App/AcademicCalendar",
}

UQU_CALENDAR = [
    {
        "term": "الفصل الدراسي الأول",
        "events": [
            {"title": "بداية الفصل الدراسي الأول", "start": "2026-08-23", "end": None, "date": "23 Aug 2026", "hijri": "10/03/1448", "type": "academic"},
            {"title": "تأجيل الدراسة", "start": "2026-08-23", "end": "2026-08-29", "date": "23 Aug - 29 Aug 2026", "hijri": "10/03 - 16/03/1448", "type": "system"},
            {"title": "الاعتذار عن الدراسة", "start": "2026-08-30", "end": "2026-10-31", "date": "30 Aug - 31 Oct 2026", "hijri": "17/03 - 20/05/1448", "type": "system"},
            {"title": "إجازة اليوم الوطني", "start": "2026-09-23", "end": "2026-09-24", "date": "23 Sep - 24 Sep 2026", "hijri": "12/04 - 13/04/1448", "type": "holiday"},
            {"title": "الاختبارات النصفية", "start": "2026-10-11", "end": "2026-10-22", "date": "11 Oct - 22 Oct 2026", "hijri": "30/04 - 11/05/1448", "type": "exam"},
            {"title": "الانسحاب من مقرر دراسي", "start": "2026-11-01", "end": "2026-11-07", "date": "01 Nov - 07 Nov 2026", "hijri": "21/05 - 27/05/1448", "type": "system"},
            {"title": "إجازة الخريف", "start": "2026-11-19", "end": "2026-11-28", "date": "19 Nov - 28 Nov 2026", "hijri": "09/06 - 18/06/1448", "type": "holiday"},
            {"title": "اختبارات المتطلبات العامة والعملية", "start": "2026-12-13", "end": "2026-12-24", "date": "13 Dec - 24 Dec 2026", "hijri": "04/07 - 15/07/1448", "type": "exam"},
            {"title": "طلب إعادة القيد للفصل الثاني", "start": "2026-12-20", "end": "2027-01-21", "date": "20 Dec 2026 - 21 Jan 2027", "hijri": "11/07 - 13/08/1448", "type": "system"},
            {"title": "الاختبارات النهائية", "start": "2026-12-27", "end": "2027-01-07", "date": "27 Dec 2026 - 07 Jan 2027", "hijri": "18/07 - 29/07/1448", "type": "exam"},
            {"title": "إجازة منتصف العام الدراسي", "start": "2027-01-07", "end": "2027-01-16", "date": "07 Jan - 16 Jan 2027", "hijri": "29/07 - 08/08/1448", "type": "holiday"},
        ],
    },
    {
        "term": "الفصل الدراسي الثاني",
        "events": [
            {"title": "بداية الفصل الدراسي الثاني", "start": "2027-01-17", "end": None, "date": "17 Jan 2027", "hijri": "09/08/1448", "type": "academic"},
            {"title": "تأجيل الدراسة", "start": "2027-01-17", "end": "2027-01-23", "date": "17 Jan - 23 Jan 2027", "hijri": "09/08 - 15/08/1448", "type": "system"},
            {"title": "الاعتذار عن الدراسة", "start": "2027-01-24", "end": "2027-04-17", "date": "24 Jan - 17 Apr 2027", "hijri": "16/08 - 10/11/1448", "type": "system"},
            {"title": "إجازة يوم التأسيس", "start": "2027-02-21", "end": "2027-02-22", "date": "21 Feb - 22 Feb 2027", "hijri": "14/09 - 15/09/1448", "type": "holiday"},
            {"title": "إجازة عيد الفطر", "start": "2027-02-23", "end": "2027-03-13", "date": "23 Feb - 13 Mar 2027", "hijri": "16/09 - 05/10/1448", "type": "holiday"},
            {"title": "الاختبارات النصفية", "start": "2027-03-28", "end": "2027-04-08", "date": "28 Mar - 08 Apr 2027", "hijri": "20/10 - 02/11/1448", "type": "exam"},
            {"title": "طلب التحويل بين الكليات والأقسام", "start": "2027-03-28", "end": "2027-04-10", "date": "28 Mar - 10 Apr 2027", "hijri": "20/10 - 04/11/1448", "type": "system"},
            {"title": "الانسحاب من مقرر دراسي", "start": "2027-04-18", "end": "2027-04-24", "date": "18 Apr - 24 Apr 2027", "hijri": "11/11 - 17/11/1448", "type": "system"},
            {"title": "إدخال رغبات التسكين (السنة الأولى والتأهيلية)", "start": "2027-04-25", "end": "2027-05-01", "date": "25 Apr - 01 May 2027", "hijri": "18/11 - 24/11/1448", "type": "academic"},
            {"title": "إجازة عيد الأضحى", "start": "2027-05-03", "end": "2027-05-22", "date": "03 May - 22 May 2027", "hijri": "26/11 - 16/12/1448", "type": "holiday"},
            {"title": "اختبارات المتطلبات العامة والعملية", "start": "2027-05-30", "end": "2027-06-10", "date": "30 May - 10 Jun 2027", "hijri": "24/12/1448 - 05/01/1449", "type": "exam"},
            {"title": "طلب إعادة القيد للفصل الصيفي", "start": "2027-06-06", "end": "2027-06-29", "date": "06 Jun - 29 Jun 2027", "hijri": "01/01 - 24/01/1449", "type": "system"},
            {"title": "الاختبارات النهائية", "start": "2027-06-13", "end": "2027-06-24", "date": "13 Jun - 24 Jun 2027", "hijri": "08/01 - 19/01/1449", "type": "exam"},
            {"title": "إجازة نهاية العام الدراسي", "start": "2027-06-24", "end": None, "date": "24 Jun 2027", "hijri": "19/01/1449", "type": "holiday"},
            {"title": "التحويل الخارجي إلى جامعة أم القرى", "start": "2027-06-24", "end": "2027-07-03", "date": "24 Jun - 03 Jul 2027", "hijri": "19/01 - 28/01/1449", "type": "system"},
        ],
    }
]

TERM1_START = _dt.date(2026, 8, 23)
TERM1_END = _dt.date(2027, 1, 7)
TERM2_START = _dt.date(2027, 1, 17)
TERM2_END = _dt.date(2027, 6, 24)
NEXT_YEAR_START = None  # unknown until the 1449 calendar is published
