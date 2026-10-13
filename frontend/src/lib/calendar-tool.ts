/**
 * UQU CALENDAR TOOL
 * 
 * أداة للذكاء الاصطناعي للبحث والاستعلام عن التقويم الأكاديمي
 * AI Tool for searching and querying the academic calendar
 */

import { UQU_CALENDAR, searchCalendar, getEventsByType, getTermEvents, getNextEvent, type CalendarEvent } from './uqu-calendar-data';

/**
 * تنفيذ الأداة
 * Tool execution
 */
export function executeCalendarTool(args: {
  query_type: 'search' | 'by_type' | 'by_term' | 'next_event' | 'all';
  query?: string;
  event_type?: 'exam' | 'holiday' | 'academic' | 'system';
}): { success: boolean; data: CalendarEvent[] | CalendarEvent | null; message: string } {
  
  try {
    switch (args.query_type) {
      case 'search': {
        if (!args.query) {
          return {
            success: false,
            data: null,
            message: 'يجب تحديد كلمة البحث'
          };
        }
        const results = searchCalendar(args.query);
        return {
          success: true,
          data: results,
          message: `تم العثور على ${results.length} حدث`
        };
      }

      case 'by_type': {
        if (!args.event_type) {
          return {
            success: false,
            data: null,
            message: 'يجب تحديد نوع الحدث'
          };
        }
        const results = getEventsByType(args.event_type);
        return {
          success: true,
          data: results,
          message: `تم العثور على ${results.length} حدث من نوع ${args.event_type}`
        };
      }

      case 'by_term': {
        if (!args.query) {
          return {
            success: false,
            data: null,
            message: 'يجب تحديد اسم الفصل الدراسي'
          };
        }
        const results = getTermEvents(args.query);
        return {
          success: true,
          data: results,
          message: `تم العثور على ${results.length} حدث في الفصل الدراسي`
        };
      }

      case 'next_event': {
        const nextEvent = getNextEvent();
        return {
          success: true,
          data: nextEvent,
          message: nextEvent ? 'تم العثور على الحدث القادم' : 'لا توجد أحداث قادمة'
        };
      }

      case 'all': {
        const allEvents: CalendarEvent[] = [];
        for (const term of UQU_CALENDAR) {
          allEvents.push(...term.events);
        }
        return {
          success: true,
          data: allEvents,
          message: `جميع الأحداث: ${allEvents.length} حدث`
        };
      }

      default:
        return {
          success: false,
          data: null,
          message: 'نوع استعلام غير معروف'
        };
    }
  } catch (error) {
    console.error('[Calendar Tool] Error:', error);
    return {
      success: false,
      data: null,
      message: 'حدث خطأ أثناء البحث في التقويم'
    };
  }
}

/**
 * تنسيق نتائج التقويم للعرض
 * Format calendar results for display
 */
export function formatCalendarResults(events: CalendarEvent | CalendarEvent[] | null): string {
  if (!events) {
    return 'لم يتم العثور على أحداث';
  }

  const eventArray = Array.isArray(events) ? events : [events];
  
  if (eventArray.length === 0) {
    return 'لم يتم العثور على أحداث';
  }

  let output = '';
  
  for (const event of eventArray) {
    const typeEmoji = {
      exam: '📝',
      holiday: '🎉',
      academic: '📚',
      system: '⚙️'
    }[event.type] || '📅';

    output += `${typeEmoji} **${event.title}**\n`;
    output += `📅 التاريخ الميلادي: ${event.date}\n`;
    output += `🌙 التاريخ الهجري: ${event.hijri}\n\n`;
  }

  return output.trim();
}