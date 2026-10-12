/** Minimal Server-Sent Events parser for `data: {json}\n\n` streams. */

export interface ChatStreamEvent {
  type: "token" | "status" | "done" | "error";
  text?: string;
  tool?: string;
  message?: string;
  response?: unknown;
}

/** Split a buffer into complete events; returns the unconsumed remainder. */
export function parseSse(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const events: ChatStreamEvent[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      /* ignore malformed event */
    }
  }
  return { events, rest };
}

/** Arabic label for the tool the agent is running. */
const TOOL_LABELS: Record<string, string> = {
  search_regulations: "أبحث في اللوائح…",
  get_calendar_info: "أراجع التقويم الأكاديمي…",
  get_attendance_status: "أحسب غيابك…",
  record_absence: "أسجّل الغياب…",
  get_day_schedule: "أراجع جدولك…",
  get_university_news: "أجلب أخبار الجامعة…",
  get_course_info: "أبحث عن المقرر…",
  get_course_reviews: "أقرأ تقييمات الطلاب…",
  predict_gpa_pathway: "أحسب مسار معدلك…",
  get_student_data: "أراجع سجلك الأكاديمي…",
  analyze_transcript: "أحلل سجلك الأكاديمي…",
  get_gpa_history: "أراجع تطور معدلك…",
  get_upcoming_exams: "أراجع اختباراتك القادمة…",
  create_study_plan: "أجهّز الخطة…",
  generate_semester_master_plan: "أجهّز الخطة الفصلية…",
  modify_study_session: "أعدّل الخطة…",
};

export function toolStatusLabel(tool: string | undefined): string {
  return (tool && TOOL_LABELS[tool]) || "أعمل على طلبك…";
}
