/**
 * What kind of academic record did the student upload?
 *
 *   enrolled          — has courses registered / in progress this term
 *   between_terms     — every term is graded, nothing registered yet
 *                       (uploaded after grades came out, before the next term)
 *   graduated         — final graduation-project part passed AND earned hours
 *                       reach the plan's total printed on the record
 *   likely_graduated  — no plan total on the record, but final project and
 *                       training are passed and hours are at bachelor level
 *
 * Every record is accepted; this only decides what we tell the student.
 * The number of levels/terms is deliberately NOT used: a student who changed
 * majors can have many terms and still be far from graduating.
 */

import { gradePoints } from "@/lib/grade-scale";

/** The shortest UQU bachelor plan is well above this; fewer earned hours cannot be a graduate. */
export const MIN_BACHELOR_HOURS = 118;

export type RecordStatus = "enrolled" | "between_terms" | "graduated" | "likely_graduated";

export interface RecordCourse {
  code: string;
  nameAr?: string | null;
  nameEn?: string | null;
  name?: string | null;
  grade?: string | null;
  creditHours?: number | null;
}

export interface RecordInput {
  completedCourses: RecordCourse[];
  registeredCourses: RecordCourse[];
  earnedHours: number | null;
  planHours: number | null;
}

export interface RecordAssessment {
  status: RecordStatus;
  inProgress: number;
  finalProject: "passed" | "part1_only" | "missing";
  training: "passed" | "missing";
  earnedHours: number | null;
  planHours: number | null;
  reasons: string[];
}

const PROJECT_RE = /مشروع\s*(ال)?تخرج|graduation\s*project|senior\s*project|capstone/i;
const TRAINING_RE = /تدريب\s*(ال)?(تعاوني|ميداني|صيفي)|co-?op\b|cooperative|cooprative|internship|field\s*training|summer\s*training/i;
const PASS_ONLY = new Set(["P", "PS", "PASS", "ناجح"]);

const DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => DIGITS[d]);

export function isPassed(grade: string | null | undefined): boolean {
  const g = (grade ?? "").trim().toUpperCase();
  if (!g) return false;
  if (PASS_ONLY.has(g)) return true;
  const pts = gradePoints(g);
  return pts !== null && pts > 0;
}

const label = (c: RecordCourse) => `${c.nameAr ?? ""} ${c.nameEn ?? ""} ${c.name ?? ""}`;

/** Part number of a graduation-project course: 1, 2, or null when the plan has a single project. */
export function projectPart(c: RecordCourse): 1 | 2 | null {
  const t = latin(label(c)).replace(/\s+/g, " ");
  const m = t.match(/(?:مشروع\s*(?:ال)?تخرج|project)\s*[-(]?\s*(1|2|i{1,2})\b\)?/i);
  if (!m) return null;
  const p = m[1].toLowerCase();
  return p === "2" || p === "ii" ? 2 : 1;
}

export function assessRecord(r: RecordInput): RecordAssessment {
  const inProgress = r.registeredCourses.length + r.completedCourses.filter((c) => !(c.grade ?? "").trim()).length;
  const projects = r.completedCourses.filter((c) => PROJECT_RE.test(label(c)));
  const passedProjects = projects.filter((c) => isPassed(c.grade));
  const parts = new Set(passedProjects.map(projectPart));
  const numbered = projects.some((c) => projectPart(c) !== null);
  const finalProject: RecordAssessment["finalProject"] = parts.has(2) || (!numbered && passedProjects.length > 0)
    ? "passed"
    : parts.has(1)
      ? "part1_only"
      : "missing";
  const training: RecordAssessment["training"] = r.completedCourses.some((c) => TRAINING_RE.test(label(c)) && isPassed(c.grade))
    ? "passed"
    : "missing";

  const earned = r.earnedHours;
  const plan = r.planHours && r.planHours >= MIN_BACHELOR_HOURS ? r.planHours : null;
  const reasons: string[] = [];

  let status: RecordStatus;
  if (inProgress > 0) {
    status = "enrolled";
  } else if (finalProject === "passed" && earned !== null && plan !== null && earned >= plan) {
    status = "graduated";
    reasons.push(`اجتزت مشروع التخرج، وساعاتك المكتسبة ${earned} من ${plan} ساعة في خطتك.`);
    if (training === "passed") reasons.push("واجتزت التدريب.");
  } else if (finalProject === "passed" && training === "passed" && plan === null && earned !== null && earned >= MIN_BACHELOR_HOURS) {
    status = "likely_graduated";
    reasons.push(`اجتزت مشروع التخرج والتدريب، وساعاتك المكتسبة ${earned} ساعة، لكن السجل لا يذكر إجمالي ساعات خطتك للتأكد.`);
  } else {
    status = "between_terms";
    if (finalProject === "part1_only") reasons.push("اجتزت مشروع التخرج 1 ولم يظهر مشروع التخرج 2 بعد.");
    if (finalProject === "missing") reasons.push("لم يظهر في السجل مشروع تخرج مجتاز.");
    if (earned !== null && plan !== null && earned < plan) reasons.push(`ساعاتك المكتسبة ${earned} من ${plan}؛ باقي ${plan - earned} ساعة.`);
    else if (earned !== null && earned < MIN_BACHELOR_HOURS) reasons.push(`ساعاتك المكتسبة ${earned} أقل من الحد الأدنى لأي بكالوريوس (${MIN_BACHELOR_HOURS}).`);
  }
  return { status, inProgress, finalProject, training, earnedHours: earned, planHours: plan, reasons };
}

export const RECORD_STATUS_TEXT: Record<RecordStatus, { title: string; body: string }> = {
  enrolled: { title: "سجل طالب منتظم", body: "يحتوي سجلك على مواد مسجلة في الفصل الحالي." },
  between_terms: {
    title: "سجلك بين فصلين",
    body: "كل فصولك مرصودة ولا توجد مواد مسجلة حالياً. قبلنا السجل، وتقدر تضيف جدولك لاحقاً بعد التسجيل.",
  },
  graduated: {
    title: "يبدو أنك خريج 🎓",
    body: "قبلنا سجلك. المرشد لن يقترح مقررات جديدة، لكن بياناتك ومعدلك متاحة في كل الصفحات.",
  },
  likely_graduated: {
    title: "غالباً أنك خريج",
    body: "قبلنا سجلك. إن لم تكن تخرجت فعلاً، حدد تخصصك في المرشد ليحسب لك ما تبقى.",
  },
};
