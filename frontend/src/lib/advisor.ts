/**
 * Academic advisor («المرشد الأكاديمي») — API client, types and the small
 * pure helpers the page uses. All planning happens on the server
 * (backend/services/advisor); this file only shapes it for display.
 */

import { api } from "@/lib/api";

export type Strategy = "fastest" | "balanced" | "recovery";
export type Priority = "graduate_fast" | "protect_gpa" | "balanced";
export type Verification = "verified" | "inferred" | "incomplete" | "conflicting" | "unavailable";

export interface ProgramSummary {
  id: string;
  name_ar: string;
  degree_type: string;
  department_ar: string;
  college_ar: string;
  curriculum: {
    id: string;
    verification: Verification;
    stated_total_hours: number | null;
    listed_hours: number;
    unlisted_hours: number;
    source_url: string;
    retrieved_at: string;
  };
}

export interface RuleCite {
  rule: string;
  text: string;
  status: "verified" | "unavailable" | "assumption";
  kind?: "hard" | "standing" | "default" | "unknown" | "info";
  source: string;
  source_url?: string | null;
  article: string | null;
  checked?: string | null;
}

export interface Standing {
  graduation: { program_gpa: number | null; program_gpa_source: "student" | "unknown"; floor: number; message: string };
  warning: { status: "warning" | "clear" | "unknown"; basis: string; message: string; summer_note: string };
}

export interface CurriculumFit {
  verdict: "consistent" | "other_edition" | "mismatch" | "insufficient_data";
  message: string;
  passed: number;
  in_plan: number;
  editions: { label: string; total_hours: number | null; url?: string; matched_codes: string[] }[];
}

export interface ElectiveOptions {
  options: {
    code: string;
    title: string;
    credits: number;
    level: number | null;
    prerequisites: string[];
    corequisites: string[];
    taken: boolean;
    eligible: boolean;
    missing_prerequisites: string[];
    corequisites_to_pair: string[];
    source_url: string;
    document: { title: string; version: string | null; date: string | null } | null;
  }[];
  complete: boolean;
  required_hours: number;
  note: string | null;
}

export interface OfficialDocument {
  id: string;
  type: string;
  title: string;
  url: string;
  version: string | null;
  date: string | null;
  applicability: "applicable" | "not_applicable" | "partial";
  reason: string | null;
}

export interface CatalogOverview {
  programs: ProgramSummary[];
  rules: RuleCite[];
  generated_at: string;
}

export interface AdvisorSettings {
  program_id?: string | null;
  priority?: Priority;
  max_load?: number | null;
  summer?: boolean;
  target_term?: string | null;
  weekly_work_hours?: number | null;
  program_grad_gpa?: number | null;
  unavailable?: { code: string; term: string }[];
  interests?: string[];
}

export interface CourseAdvice {
  code: string;
  name: string;
  credits: number;
  reasons: string[];
  unlocks: string[];
  delay_cost_terms: number | null;
  workload_evidence: { count: number; averages: Record<string, number>; heavy: boolean | null; note: string } | null;
  tags: string[];
}

export interface PlannedCourse {
  code: string;
  name: string;
  credits: number;
  kind: "required" | "coop" | "elective";
  tags: string[];
  verification: Verification;
  unlocks: number;
}

export interface PlannedTerm {
  term: string;
  label: string;
  summer: boolean;
  credits: number;
  courses: PlannedCourse[];
  warnings: string[];
}

export interface PlanScenario {
  strategy: Strategy;
  load_cap: number;
  terms: PlannedTerm[];
  graduation_term: string | null;
  graduation_label: string | null;
  terms_needed: number;
  complete: boolean;
  unscheduled: { code: string; reason: string }[];
  lower_bound: { terms: number; by: string; earliest_label: string | null };
  target: { verdict: "feasible" | "impossible" | "unproven" | "past"; message: string; target_label: string } | null;
  assumptions: string[];
}

export interface Risk {
  kind: string;
  severity: "high" | "medium" | "low";
  basis: "fact" | "estimate";
  message: string;
  evidence: string[];
}

export interface AuditCourse {
  code: string;
  name: string;
  level: number;
  credits: number;
  state: "done" | "in_progress" | "remaining" | "failed" | "incomplete";
  prerequisites: string[];
  missing_prerequisites: string[];
  eligible_next_term: boolean;
}

export interface AdvisorRun {
  run_id: string;
  engine_version: string;
  created_at: string;
  program: { id: string; name: string; source: "student" | "record" };
  curriculum: { id: string; label: string; verification: Verification; source_url: string; retrieved_at: string; issues: { severity: string; code: string; message: string }[] };
  profile: {
    gpa: number | null;
    gpa_source: "courses" | "record_field" | "none";
    computed_gpa: number | null;
    earned_hours: number;
    term_gpas: { term: number[]; label: string; gpa: number | null; hours: number }[];
    failed_unresolved: string[];
    in_progress: string[];
    notes: string[];
  };
  data_gaps: { field: string; message: string; impact: string }[];
  audit: {
    required_hours: number;
    done_hours: number;
    in_progress_hours: number;
    remaining_required_hours: number;
    unlisted_hours: number;
    remaining_hours_estimate: { min: number; max: number };
    percent_required_done: number;
    outside_plan_passed: { code: string; name: string; credits: number; grade: string | null }[];
    courses: AuditCourse[];
    assumptions: string[];
  };
  load: { load: number; mode: string; reasons: string[]; basis: string };
  recommended_strategy: Strategy;
  strategy_reason: string;
  next_term: {
    term: string | null;
    label: string | null;
    credits: number;
    courses: CourseAdvice[];
    warnings: string[];
    alternatives: { code: string; name: string; credits: number; level: number; why_not_now: string }[];
  };
  scenarios: Record<Strategy, PlanScenario>;
  risks: Risk[];
  gpa_what_if:
    | { available: false }
    | {
        available: true;
        current_gpa: number;
        gpa_hours: number;
        term_credits: number;
        rows: { term_average: string; term_points: number; resulting_gpa: number }[];
        note: string;
      };
  confidence: { level: "high" | "medium" | "low"; reasons: string[] };
  standing?: Standing;
  curriculum_fit?: CurriculumFit;
  elective_options?: ElectiveOptions;
  uncertainties?: { topic: string; message: string; effect: string }[];
  documents?: OfficialDocument[];
  prep_year?: { in_prep: boolean; notice: string | null; levels: number[]; hours: number } | null;
  /** false when the record matches another curriculum edition: no course or date advice is given. */
  plan_applicable?: boolean;
  withheld_reason?: string | null;
  rules: RuleCite[];
  summary?: RunSummary;
}

export interface RunSummary {
  what: string;
  why: string[];
  alternatives: string[];
  effect: string[];
  uncertain: string[];
  next_steps: string[];
  confidence: string | null;
}

export interface ScheduleCheck {
  valid: boolean;
  credits: number;
  courses: { input: string; code: string; ok: boolean; problems: string[] }[];
  violations: { rule: string; message: string; course?: string }[];
  warnings: { rule: string; message: string }[];
  notes?: { rule: string; course: string }[];
}

export interface MajorRow {
  program_id: string;
  name: string;
  department: string;
  stated_total_hours: number | null;
  overlap_courses: string[];
  overlap_hours: number;
  related_performance: number | null;
  interest_matches: string[];
  fastest_terms: number | null;
  fastest_graduation: string | null;
  evidence: string[];
  missing: string[];
  curriculum_verification: Verification;
  source_url: string;
}

export interface MajorsComparison {
  programs: MajorRow[];
  transfer_rules: { text: string; source: string }[];
  disclaimer: string;
  coverage_note: string;
}

export interface InstructorEvidence {
  course_code: string;
  verdict: "recommend" | "no_data" | "insufficient" | "no_clear_difference";
  message: string;
  recommendation: { instructor: string; gap: number; confidence: string; basis: string } | null;
  instructors: {
    instructor: string;
    reviews: number;
    quality_adjusted: number | null;
    workload: number | null;
    recommend_pct: number | null;
    disagreement: boolean;
    confidence: "insufficient" | "low" | "medium" | "high";
    notes: string[];
  }[];
  providers: { name: string; available: boolean; reason: string }[];
  caveats: string[];
  imported?: ImportedProfiles;
}

export type ProfileVerdict = "recommended" | "recommended_if" | "mixed" | "avoid_if_alternative";

export interface ProfileSource {
  kind: string;
  description: string;
  files: number;
}

/** Instructor profile built from the team's compiled student reviews (aggregates + analysis, never comments). */
export interface InstructorProfile {
  id: string;
  name: string;
  department: string | null;
  verdict: ProfileVerdict;
  verdict_label: string;
  headline: string;
  recommendation: string;
  fits: string[];
  not_for: string[];
  strengths: string[];
  weaknesses: string[];
  modes: { context: string; pattern: string }[];
  survival: string[];
  caveats: string[];
  data: { reviews_analyzed: number; reviews_stated: number | null; complete: boolean };
  overall: { reviews: number; average: number | null; positive_share: number | null; recent_reviews: number };
  badges: { label: string; share: number }[];
  course: {
    family: string;
    confidence: "likely" | "ambiguous" | "no_plan_course";
    reviews: number;
    average: number | null;
    positive_share: number | null;
    recent_reviews: number;
    thin: boolean;
  } | null;
}

export interface ImportedProfiles {
  course_code: string;
  profiles: InstructorProfile[];
  source: ProfileSource;
  caveats: string[];
}

export interface InstructorMap {
  program_id: string;
  covered: number;
  plan_courses: number;
  instructors_total: number;
  courses: {
    code: string;
    name: string;
    level: number;
    instructors: { id: string; name: string; verdict: ProfileVerdict; verdict_label: string; reviews: number; thin: boolean }[];
  }[];
  caveats: string[];
}

export type AskResult =
  | { source: "llm_validated"; answer: string; points: string[]; next_step: string | null }
  | { source: "deterministic"; reason: string; problems?: string[]; summary: RunSummary };

export const advisorApi = {
  catalog: () => api.get("/api/advisor/catalog") as Promise<CatalogOverview>,
  settings: () => api.get("/api/advisor/settings") as Promise<AdvisorSettings>,
  saveSettings: (s: AdvisorSettings) => api.put("/api/advisor/settings", s) as Promise<AdvisorSettings>,
  analyze: (overrides?: AdvisorSettings) => api.post("/api/advisor/analyze", { overrides: overrides ?? {} }) as Promise<AdvisorRun>,
  latest: () => api.get("/api/advisor/latest") as Promise<{ run: AdvisorRun | null }>,
  validate: (codes: string[], summer = false) => api.post("/api/advisor/validate-schedule", { codes, summer }) as Promise<ScheduleCheck>,
  compare: (interests: string[]) => api.post("/api/advisor/compare-majors", { interests }) as Promise<MajorsComparison>,
  ask: (run_id: string, question: string, history: { role: string; content: string }[]) =>
    api.post("/api/advisor/ask", { run_id, question, history }) as Promise<AskResult>,
  instructors: (code: string) => api.get(`/api/advisor/instructors/${encodeURIComponent(code)}`) as Promise<InstructorEvidence>,
  instructorMap: (programId: string) =>
    api.get(`/api/advisor/instructor-map?program_id=${encodeURIComponent(programId)}`) as Promise<InstructorMap>,
  reviewInstructor: (code: string, body: Record<string, unknown>) =>
    api.put(`/api/advisor/instructors/${encodeURIComponent(code)}/review`, body) as Promise<InstructorEvidence>,
};

// ── display helpers (pure, unit-tested) ─────────────────────────

export const STRATEGY_LABEL: Record<Strategy, string> = {
  fastest: "الأسرع تخرجاً",
  balanced: "المتوازن",
  recovery: "التعافي",
};

export const STRATEGY_HINT: Record<Strategy, string> = {
  fastest: "أعلى عبء تسمح به، وأطول سلسلة متطلبات أولاً.",
  balanced: "ترتيب الخطة الرسمية بعبء يناسب أداءك، ولا أكثر من مقررين ثقيلين معاً.",
  recovery: "عبء أخف، وإعادة المقررات المفتاحية أولاً، ومقرر ثقيل واحد في الفصل.",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  balanced: "توازن بين المعدل والتخرج",
  graduate_fast: "أتخرج أسرع",
  protect_gpa: "أحمي معدلي",
};

export const CONFIDENCE_LABEL = { high: "عالية", medium: "متوسطة", low: "منخفضة" } as const;

export const VERIFICATION_LABEL: Record<Verification, string> = {
  verified: "موثّقة",
  inferred: "مستنتجة",
  incomplete: "ناقصة",
  conflicting: "متعارضة",
  unavailable: "غير متاحة",
};

const TAG_LABEL: Record<string, string> = {
  repeat: "إعادة",
  critical: "مسار حرج",
  heavy: "ثقيل",
  summer_unverified: "صيفي غير مؤكد",
  ahead_of_plan: "قبل موعده في الخطة",
  needs_approval: "يتطلب موافقة القسم",
  conditional: "مشروط بنجاحك الحالي",
  spec_verified: "مؤكد في التوصيف الرسمي",
};

export const RULE_KIND_LABEL: Record<string, string> = {
  hard: "قيود تسجيل نظامية",
  standing: "التخرج والإنذار",
  default: "افتراضات فطن للتخطيط (ليست لائحة)",
  unknown: "غير منشور رسمياً",
  info: "معلومات",
};

/** Human labels for planner tags; "unlocks:3" → "يفتح 3". */
export function tagLabel(tag: string): string {
  if (tag.startsWith("unlocks:")) return `يفتح ${tag.slice(8)}`;
  return TAG_LABEL[tag] ?? tag;
}

/** Term key for the next N terms, for the target-term picker: "1449-2" → "الفصل الثاني 1449". */
export function termOptions(startYear: number, count: number, summer: boolean): { value: string; label: string }[] {
  const names: Record<number, string> = { 1: "الفصل الأول", 2: "الفصل الثاني", 3: "الفصل الصيفي" };
  const out: { value: string; label: string }[] = [];
  let year = startYear;
  let idx = 1;
  while (out.length < count) {
    if (idx !== 3 || summer) out.push({ value: `${year}-${idx}`, label: `${names[idx]} ${year}` });
    idx += 1;
    if (idx > 3) {
      idx = 1;
      year += 1;
    }
  }
  return out;
}

/** Split a typed list of course codes ("cs1701, CS 2105؛ mth1602") into normalised codes. */
export function parseCodes(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/([A-Za-z]{2,5})[\s\-_]?(\d{3,5})([A-Za-z]?)(?![A-Za-z\d])/g)) {
    const code = `${m[1]}${m[2]}${m[3]}`.toUpperCase();
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

export function delayLabel(cost: number | null): string | null {
  if (cost === null) return null;
  if (cost <= 0) return "يمكن تأجيله دون تأخير التخرج";
  return cost === 1 ? "تأجيله يؤخر التخرج فصلاً" : `تأجيله يؤخر التخرج ${cost} فصول`;
}
