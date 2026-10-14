/** Admin dashboard data (/api/admin/*, admins only — see backend/auth/admin.py). */

import { api } from "@/lib/api";

export interface AdminOverview {
  users: { total: number; new_7d: number; new_30d: number };
  usage: { active_today: number; active_7d: number; requests_today: number; refunded_today?: number };
  devices: number;
  ai_gate?: {
    last_minute: number;
    per_minute_limit: number;
    in_flight: number;
    concurrent_limit: number;
    today: number;
    per_day_limit: number;
    rejected: number;
  };
  feedback: {
    days: number;
    total: number;
    up: number;
    down: number;
    satisfaction: number | null;
    by_tool: Record<string, { up: number; down: number }>;
    recent_down: { createdAt?: string; question?: string; answer?: string; comment?: string; tools?: string[] }[];
  };
  reported_reviews: {
    code: string;
    course: string;
    id: string;
    tip: string;
    reports: number;
    hidden: boolean;
    updatedAt?: string | null;
  }[];
}

export const fetchAdminOverview = (): Promise<AdminOverview> => api.get("/api/admin/overview");

/** True only for accounts listed in the server's ADMIN_EMAILS (any error → false). */
export async function isAdmin(): Promise<boolean> {
  try {
    return (await api.get("/api/admin/me"))?.admin === true;
  } catch {
    return false;
  }
}

export const moderateReview = (code: string, id: string, action: "restore" | "hide") =>
  api.post(`/api/admin/reviews/${encodeURIComponent(code)}/${id}/${action}`, {});

const TOOL_NAMES: Record<string, string> = {
  search_regulations: "اللوائح",
  get_calendar_info: "التقويم",
  get_attendance_status: "الغياب",
  record_absence: "تسجيل غياب",
  get_day_schedule: "الجدول",
  get_university_news: "الأخبار",
  get_course_info: "المقررات",
  get_course_reviews: "تقييمات المقررات",
  predict_gpa_pathway: "مسار المعدل",
  get_student_data: "بيانات الطالب",
  analyze_transcript: "تحليل السجل",
  get_gpa_history: "تطور المعدل",
  get_upcoming_exams: "الاختبارات",
  add_upcoming_exam: "إضافة اختبار",
  create_study_plan: "خطة المذاكرة",
  "(بدون أداة)": "بدون أداة",
};

export const toolName = (tool: string): string => TOOL_NAMES[tool] ?? tool;
