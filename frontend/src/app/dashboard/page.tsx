"use client";

/**
 * Academic Intelligence Center — main dashboard.
 *
 * Layout (Bento Grid):
 *   • Top row     — 3 KPI cards: Current GPA · Earned Hours · Target GPA
 *   • Middle row  — Split: Cumulative GPA Line Chart  |  Strengths Radar
 *   • Bottom row  — Split: High-ROI Courses           |  Study Adherence
 *
 * All analytics math runs on the backend at POST /api/analytics/dashboard.
 * This page is a thin view layer: it builds the payload from Zustand
 * stores, forwards it, dispatches the response into the bento cells, and
 * gracefully degrades when the backend rejects stale data (the classic
 * "old 5.0-scale GPA hits the strict 4.0 validator" case).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  AreaChart,
  Area,
} from "recharts";
import {
  TrendingUp,
  BookOpen,
  Settings,
  Flame,
  Target,
  LineChart as LineChartIcon,
  Radar as RadarIcon,
  Zap,
  ListChecks,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Sparkles,
  Activity,
  CalendarDays,
  CalendarClock,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useProfileStore } from "@/store/profileStore";
import {
  useTranscriptStore,
  type EnrichedCourse,
} from "@/store/transcriptStore";
import { usePlanStore, taskKey, type PlanTask, type PlanPriority } from "@/store/planStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { buildCreditsResolver } from "@/lib/transcript-utils";

// ──────────────────────────────────────────────────────────────────
// Analytics types (mirror backend/schemas/analytics.py)
// ──────────────────────────────────────────────────────────────────

const STANDARD_NEXT_SEMESTER_HOURS = 15;

type TargetStatus =
  | "achieved"
  | "feasible"
  | "stretch"
  | "impossible"
  | "no_target";

type RadarCourseRef = {
  code: string;
  name: string;
  grade: string | null;
  gradePoints: number | null;
  credits: number;
  semester: string;
  contribution: number;
};

type RadarPoint = {
  category: string;
  student_competency: number;
  market_demand: number;
  skill_gap: number;
  course_count: number;
  credit_hours: number;
  is_reliable: boolean;
  courses: RadarCourseRef[];
};

type HighRoiCourse = {
  code: string;
  name: string;
  credits: number;
  max_point_contribution: number;
  projected_delta: number;
  label: string;
};

type InterventionTask = {
  title: string;
  courseCode: string;
  courseName: string;
  durationMinutes: number;
  suggestedDay: string;
  suggestedTime: string;
  priority: PlanPriority;
  reason: string;
};

type DecisionLogEntry = {
  fact: string;
  interpretation: string;
  severity: "info" | "warn" | "alert";
};

type AgenticAction = {
  active: boolean;
  intervention_id: string;
  trigger: "none" | "low_gpa" | "skill_gap" | "combined";
  severity: "low" | "medium" | "high";
  headline: string;
  body: string;
  scheduled_tasks: InterventionTask[];
  reasoning: DecisionLogEntry[];
};

type AnalyticsData = {
  target_analysis: {
    required: number;
    status: TargetStatus;
    message: string;
    next_hours: number;
  };
  chart_data: { semester: string; term_gpa: number; cumulative_gpa: number }[];
  advisor_recommendation: {
    hours: string;
    tone: "strong" | "steady" | "recover";
    headline: string;
    body: string;
  };
  strengths_radar: RadarPoint[];
  high_roi_courses: HighRoiCourse[];
  agentic_action: AgenticAction;
  gpa_trend_analysis: string;
};

type AnalyticsErrorKind = "migration" | "network" | "server";
type AnalyticsError = { kind: AnalyticsErrorKind; detail: string };

// ──────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────

function arabicDayToday(): string {
  return ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][
    new Date().getDay()
  ];
}

function extractYearKey(semester: string): number {
  const matches = semester.match(/\d{4}/g);
  if (!matches) return Number.POSITIVE_INFINITY;
  const nums = matches.map((m) => parseInt(m, 10)).filter(Number.isFinite);
  return nums.length > 0 ? Math.min(...nums) : Number.POSITIVE_INFINITY;
}

/** Classify a thrown fetch error into a UI branch.
 *
 * The api helper throws Error with `detail` already extracted from the
 * server's JSON body for non-2xx responses, OR a generic "HTTP error!
 * status: N" string. We sniff both shapes — and detect 422 specifically
 * because that's the signal the user's persisted transcript still holds
 * pre-purge 5.0-scale numbers and needs re-upload.
 */
function classifyError(err: unknown): AnalyticsError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/422|unprocessable|less than or equal|ge=|le=/i.test(msg)) {
    return { kind: "migration", detail: msg };
  }
  if (/failed to fetch|networkerror|typeerror.*fetch/i.test(msg)) {
    return { kind: "network", detail: msg };
  }
  return { kind: "server", detail: msg };
}

// ──────────────────────────────────────────────────────────────────
// بيانات التقويم الأكاديمي لجامعة أم القرى 1447 / 1448 هـ
// ──────────────────────────────────────────────────────────────────
const UQU_CALENDAR = [
  {
    term: "الفصل الدراسي الأول",
    events: [
      { title: "تأجيل الدراسة", date: "24 Aug - 30 Aug 2025", hijri: "01/03 - 07/03/1447", type: "system" },
      { title: "بداية الفصل الدراسي الأول", date: "24 Aug 2025", hijri: "01/03/1447", type: "academic" },
      { title: "الاعتذار عن الدراسة", date: "31 Aug - 01 Nov 2025", hijri: "08/03 - 10/05/1447", type: "system" },
      { title: "إجازة اليوم الوطني", date: "23 Sep 2025", hijri: "01/04/1447", type: "holiday" },
      { title: "الاختبارات النصفية", date: "19 Oct - 30 Oct 2025", hijri: "27/04 - 08/05/1447", type: "exam" },
      { title: "الانسحاب من مقرر دراسي", date: "02 Nov - 15 Nov 2025", hijri: "11/05 - 24/05/1447", type: "system" },
      { title: "إجازة الخريف", date: "20 Nov - 29 Nov 2025", hijri: "29/05 - 08/06/1447", type: "holiday" },
      { title: "اختبارات المتطلبات العامة والعملية", date: "21 Dec - 25 Dec 2025", hijri: "01/07 - 05/07/1447", type: "exam" },
      { title: "إعادة القيد للفصل الثاني", date: "21 Dec - 22 Jan 2026", hijri: "01/07 - 03/08/1447", type: "system" },
      { title: "الاختبارات النهائية", date: "28 Dec - 08 Jan 2026", hijri: "08/07 - 19/07/1447", type: "exam" },
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
      { title: "التحويل بين الكليات والأقسام", date: "05 Apr - 18 Apr 2026", hijri: "17/10 - 01/11/1447", type: "system" },
      { title: "الانسحاب من مقرر دراسي", date: "19 Apr - 02 May 2026", hijri: "02/11 - 15/11/1447", type: "system" },
      { title: "إدخال رغبات التسكين", date: "03 May - 09 May 2026", hijri: "16/11 - 22/11/1447", type: "academic" },
      { title: "إجازة عيد الأضحى", date: "14 May - 01 Jun 2026", hijri: "27/11 - 15/12/1447", type: "holiday" },
      { title: "إعادة القيد للصيفي", date: "07 Jun - 30 Jun 2026", hijri: "21/12 - 15/01/1448", type: "system" },
      { title: "اختبارات المتطلبات العامة والعملية", date: "07 Jun - 11 Jun 2026", hijri: "21/12 - 25/12/1447", type: "exam" },
      { title: "الاختبارات النهائية", date: "14 Jun - 25 Jun 2026", hijri: "28/12 - 10/01/1448", type: "exam" },
      { title: "التحويل الخارجي لجامعة أم القرى", date: "25 Jun - 04 Jul 2026", hijri: "10/01 - 19/01/1448", type: "system" },
      { title: "إجازة نهاية العام الدراسي", date: "25 Jun 2026", hijri: "10/01/1448", type: "holiday" },
    ],
  },
];

// دالة مساعدة لتلوين نوع الحدث
function getEventTone(type: string) {
  switch (type) {
    case "holiday": return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "exam": return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "system": return "bg-uqu-accent/15 text-uqu-accent border-uqu-accent/30";
    default: return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  }
}



// ──────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // ── Stores ────────────────────────────────────────────────────────
  const basic = useProfileStore((s) => s.basic);
  const goals = useProfileStore((s) => s.goals);

  const completedCourses = useTranscriptStore((s) => s.completedCourses);
  const currentCourses = useTranscriptStore((s) => s.currentCourses);
  const transcriptGpa = useTranscriptStore((s) => s.gpa);
  const transcriptStudentName = useTranscriptStore((s) => s.name || s.nameEn);

  const plan = usePlanStore((s) => s.plan);
  const completedTaskKeys = usePlanStore((s) => s.completed);
  const streak = usePomodoroStore((s) => s.currentStreak);

  // ── Derived ──────────────────────────────────────────────────────
  // Prefer the transcript's authoritative GPA over profile.goals when present.
  const currentGpa = transcriptGpa ?? goals.currentGpa ?? 0;
  const targetGpa = goals.targetGpa ?? 0;

  const earnedHours = useMemo(
    () => completedCourses.reduce((sum, c) => sum + (c.creditHours ?? 0), 0),
    [completedCourses],
  );

  const totalPlanHours = useMemo(() => {
    const v = basic.totalPlanHours;
    return typeof v === "number" && v > 0 ? v : 0;
  }, [basic.totalPlanHours]);

  // ── Backend analytics ────────────────────────────────────────────
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<AnalyticsError | null>(null);

  // ── Hydration guard ──────────────────────────────────────────────
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // ── Fetch effect ─────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || authLoading || !user) return;
    if (completedCourses.length === 0 || currentGpa <= 0) {
      setAnalyticsData(null);
      setAnalyticsError(null);
      return;
    }

    // ── Pre-flight pruning ──
    // Drop courses with missing/invalid grades AND defensively clamp
    // any out-of-range values so a single stale row can't 422 the
    // whole request. The migration boundary catches the rest.
    const payloadCourses = completedCourses
      .filter(
        (c) =>
          c.semesterStatus === "completed" &&
          c.gradePoints != null &&
          c.creditHours > 0 &&
          !!c.grade &&
          !["W", "IP", "NP", "IC"].includes(c.grade.toUpperCase()),
      )
      .map((c) => ({
        code: c.code,
        // Sprint-3: ship the title so the backend's CS-specific category
        // dispatcher can keyword-match on Arabic / English names — code
        // prefixes alone can't tell "ذكاء اصطناعي" from "هياكل البيانات".
        name: c.nameAr || c.nameEn || c.code,
        credits: c.creditHours,
        grade: c.grade,
        gradePoints: c.gradePoints,
        semester: c.semester,
      }));

    if (payloadCourses.length === 0) {
      setAnalyticsData(null);
      setAnalyticsError(null);
      return;
    }

    // Resolve credit hours for current-term rows before sending them
    // over the wire. The transcript parser writes `creditHours: 0`
    // for registered courses when the registrar's PDF omits the
    // credit column (see lib/transcript-utils.ts for the why). The
    // shared resolver walks: parser-value → history lookup by code
    // → UQU default of 3 — keeps the High-ROI ranker from receiving
    // an empty payload.
    const resolveCurrentCredits = buildCreditsResolver(completedCourses);

    const payloadCurrent = currentCourses.map((c) => ({
      code: c.code,
      name: c.nameAr || c.nameEn || c.code,
      credits: resolveCurrentCredits(c.creditHours, c.code),
    }));

    let cancelled = false;
    setAnalyticsLoading(true);
    setAnalyticsError(null);

    api
      .post("/api/analytics/dashboard", {
        current_gpa: currentGpa,
        target_gpa: targetGpa > 0 ? targetGpa : 0,
        earned_hours: earnedHours,
        completed_courses: payloadCourses,
        current_courses: payloadCurrent,
      })
      .then((data: AnalyticsData) => {
        if (!cancelled) setAnalyticsData(data);
      })
      .catch((err) => {
        if (cancelled) return;
        const classified = classifyError(err);
        console.error("Dashboard analytics fetch failed:", err);
        setAnalyticsError(classified);
        setAnalyticsData(null);
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, authLoading, user, currentGpa, targetGpa, earnedHours, completedCourses, currentCourses]);

  // ── Derived view models ─────────────────────────────────────────
  const requiredNext = useMemo<{
    required: number;
    status: "achieved" | "feasible" | "stretch" | "impossible" | "unknown";
  }>(() => {
    if (!analyticsData) return { required: 0, status: "unknown" };
    const s = analyticsData.target_analysis.status;
    if (s === "no_target") return { required: 0, status: "unknown" };
    return { required: analyticsData.target_analysis.required, status: s };
  }, [analyticsData]);

  const gpaSeries = useMemo(
    () =>
      (analyticsData?.chart_data ?? []).map((p) => ({
        semester: p.semester,
        cumulativeGpa: p.cumulative_gpa,
        semesterGpa: p.term_gpa,
      })),
    [analyticsData],
  );

  // Skills DNA Matrix — two polygons on the same axes (student vs market).
  // Carry the raw `courses` list AND the reliability flag through so the
  // drill-down dialog + tooltip + dominant-gap callout can all gate on
  // sample size without a second API call.
  
  const roiCourses = useMemo(
    () => analyticsData?.high_roi_courses ?? [],
    [analyticsData],
  );

  // Full current-term roster (every course, credits resolved via the
  // shared fallback helper) — fed into the unified RoiSimulatorDialog.
  // The backend's top-2 `high_roi_courses` are kept for the card's
  // inline display; the dialog itself simulates the WHOLE term.
  const roiRoster = useMemo(() => {
    const resolveCredits = buildCreditsResolver(completedCourses);
    return currentCourses
      .filter((c) => c.code)
      .map((c) => ({
        code: c.code,
        name: c.nameAr || c.nameEn || c.code,
        credits: resolveCredits(c.creditHours, c.code),
      }));
  }, [completedCourses, currentCourses]);

  // Sprint-4 Bug #7 — Expected GPA heuristic for the Target GPA card.
  // Assumes the student maintains their historical average on the
  // current term. The formula collapses mathematically to currentGpa
  // (weighting the same value over two windows), which is exactly the
  // intent: a no-surprises "if you keep doing what you've been doing"
  // baseline against which the target reads as either realistic or
  // stretchy.
  const currentTermCredits = useMemo(
    () => roiRoster.reduce((s, c) => s + c.credits, 0),
    [roiRoster],
  );
  const expectedGpa = useMemo(() => {
    if (currentGpa <= 0) return null;
    const totalHrs = earnedHours + currentTermCredits;
    if (totalHrs <= 0) return currentGpa;
    return (
      (earnedHours * currentGpa + currentTermCredits * currentGpa) / totalHrs
    );
  }, [currentGpa, earnedHours, currentTermCredits]);

  const agenticAction = analyticsData?.agentic_action;

  // ── Predictive GPA Topography (sparkline) ─────────────────────────
  // The sparkline inside the Current GPA StatCard is the cumulative_gpa
  // trajectory pulled straight from chart_data. Resilience direction
  // (last delta) drives the colour: positive → green, negative → orange.
  // We never recompute the math here — the backend's cumulative is the
  // single source of truth.
  const sparkline = useMemo(() => {
    const series = analyticsData?.chart_data ?? [];
    if (series.length < 2) {
      return { data: [] as { i: number; v: number }[], direction: "flat" as const };
    }
    const data = series.map((p, i) => ({ i, v: p.cumulative_gpa }));
    const last = data[data.length - 1].v;
    const prev = data[data.length - 2].v;
    const delta = last - prev;
    const direction =
      Math.abs(delta) < 0.01 ? "flat" : delta > 0 ? "up" : "down";
    return { data, direction } as const;
  }, [analyticsData]);

  // ── Agentic Self-Healing dispatcher ───────────────────────────────
  // When the backend surfaces an intervention with `scheduled_tasks`,
  // dispatch them into the plan store ONCE per intervention_id. We gate
  // on a localStorage flag so refreshing the dashboard, switching pages,
  // or even reopening the browser doesn't insert duplicates.
  const planAddTask = usePlanStore((s) => s.addTask);
  useEffect(() => {
    if (!agenticAction?.active) return;
    if (!agenticAction.intervention_id) return;
    if (agenticAction.scheduled_tasks.length === 0) return;

    const flagKey = `uqu_intervention_applied_${agenticAction.intervention_id}`;
    try {
      if (window.localStorage.getItem(flagKey)) return;
    } catch {
      /* localStorage unavailable — proceed without the guard */
    }

    for (const t of agenticAction.scheduled_tasks) {
      const planTask: PlanTask = {
        title: t.title,
        courseCode: t.courseCode,
        courseName: t.courseName || null,
        durationMinutes: t.durationMinutes,
        suggestedDay: t.suggestedDay,
        suggestedTime: t.suggestedTime,
        priority: t.priority,
        reason: t.reason,
      };
      try {
        planAddTask(planTask);
      } catch (err) {
        console.warn("[dashboard] failed to inject intervention task:", err);
      }
    }

    try {
      window.localStorage.setItem(flagKey, new Date().toISOString());
    } catch {
      /* no-op */
    }
  }, [agenticAction, planAddTask]);

  // Adherence — purely client-side from planStore.
  const adherence = useMemo(() => {
    const tasks = plan?.tasks ?? [];
    const total = tasks.length;
    if (total === 0) return { completed: 0, total: 0, pct: 0 };
    const completedSet = new Set(completedTaskKeys);
    const done = tasks.filter((t) => completedSet.has(taskKey(t))).length;
    return { completed: done, total, pct: Math.round((done / total) * 100) };
  }, [plan, completedTaskKeys]);

  // ── Sprint-5 Pulse Check + Smart Rollover derivations ───────────
  // Mapping `Date.getDay()` (Sun=0..Sat=6) directly onto our Arabic
  // weekday labels so both `last3DaysSnapshot` and `overdueTasks`
  // share a single source of truth.
  const AR_WEEK = useMemo(
    () => [
      "الأحد",
      "الإثنين",
      "الثلاثاء",
      "الأربعاء",
      "الخميس",
      "الجمعة",
      "السبت",
    ],
    [],
  );

  // The last three calendar days (yesterday, day-before, day-3-back),
  // expressed as Arabic weekday labels. We use this to detect "user
  // hasn't logged anything for 3 days despite having tasks scheduled".
  const last3DaysSnapshot = useMemo(() => {
    const today = new Date();
    const labels: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      labels.push(AR_WEEK[d.getDay()]);
    }
    const tasks = plan?.tasks ?? [];
    const completedSet = new Set(completedTaskKeys);
    const inWindow = tasks.filter((t) => labels.includes(t.suggestedDay));
    const done = inWindow.filter((t) => completedSet.has(taskKey(t))).length;
    return {
      labels,
      tasks: inWindow,
      done,
      // Pulse-check trigger: at least 3 tasks were scheduled across
      // those days AND not a single one was marked done. The "3 tasks"
      // floor prevents false positives for a sparse week.
      shouldShowPulse: inWindow.length >= 3 && done === 0,
    };
  }, [plan, completedTaskKeys, AR_WEEK]);

  // "Overdue" = scheduled on a weekday earlier than today THIS week,
  // not in the completed set. Tasks aren't dated, so we approximate
  // using Sun=0..Sat=6 ordering within the current week.
  const overdueTasks = useMemo(() => {
    const tasks = plan?.tasks ?? [];
    if (tasks.length === 0) return [];
    const completedSet = new Set(completedTaskKeys);
    const todayIdx = new Date().getDay();
    const idxOf = (day: string) => AR_WEEK.indexOf(day);
    return tasks.filter((t) => {
      const i = idxOf(t.suggestedDay);
      if (i < 0) return false;
      return i < todayIdx && !completedSet.has(taskKey(t));
    });
  }, [plan, completedTaskKeys, AR_WEEK]);

  // Bulk action wired up so the Pulse Check's "نعم، أنجزت مهامي"
  // button can forgive a whole stretch in one click.
  const planMarkTasksDone = usePlanStore((s) => s.markTasksDone);
  const handleAckPulse = () => {
    planMarkTasksDone(last3DaysSnapshot.tasks.map((t) => taskKey(t)));
  };

  // Controlled rollover dialog — opened from the Pulse Check's "لا، لقد
  // تأخرت" button AND from the Overdue section inside the adherence
  // dialog. Kept at page scope so either path opens the same modal.
  const [rolloverOpen, setRolloverOpen] = useState(false);

  // Per-Arabic-weekday adherence rollup — drives the Adherence drill-down
  // dialog's line chart and per-day breakdown bars. We intentionally
  // iterate the week in Sun→Sat order (not the order tasks happen to
  // appear in `plan.tasks`) so the x-axis reads chronologically left-
  // to-right regardless of plan ordering.
  const adherencePerDay = useMemo(() => {
    const tasks = plan?.tasks ?? [];
    const completedSet = new Set(completedTaskKeys);
    return AR_WEEK.map((day) => {
      const dayTasks = tasks.filter((t) => t.suggestedDay === day);
      const dayDone = dayTasks.filter((t) => completedSet.has(taskKey(t))).length;
      const dayTotal = dayTasks.length;
      return {
        day,
        total: dayTotal,
        done: dayDone,
        pct: dayTotal === 0 ? 0 : Math.round((dayDone / dayTotal) * 100),
      };
    });
  }, [plan, completedTaskKeys, AR_WEEK]);

  const recentCourses = useMemo(() => {
    return [...completedCourses]
      .filter((c) => !!c.grade)
      .sort((a, b) => extractYearKey(b.semester || "") - extractYearKey(a.semester || ""))
      .slice(0, 10);
  }, [completedCourses]);

  // ── Header bits ──────────────────────────────────────────────────
  const studentFirstName =
    (basic.name || transcriptStudentName || "").split(" ").filter(Boolean)[0] || null;
  const greeting = studentFirstName
    ? `أهلاً بك مجدداً، ${studentFirstName}! 👋`
    : "أهلاً بك مجدداً، يا بطل! 👋";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-24 pb-20 px-4 md:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <Badge
              variant="outline"
              className="bg-uqu-accent/10 text-uqu-accent border-uqu-accent/20 mb-3 px-3 py-1 rounded-full font-bold"
            >
              🧠 مركز الذكاء الأكاديمي
            </Badge>
            <h1 className="text-4xl font-black mb-2">لوحة المعلومات</h1>
            <p className="text-muted-foreground font-medium">{greeting}</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-2xl">
              <Flame className="w-5 h-5 text-orange-500 fill-orange-500" />
              <span className="font-black text-orange-500">{streak}</span>
              <span className="text-muted-foreground text-sm font-bold">يوم</span>
            </div>
            <Link href="/profile">
              <Button className="rounded-2xl h-11 bg-uqu-accent hover:bg-uqu-accent/90 shadow-lg shadow-uqu-accent/20 gap-2">
                <Settings className="w-4 h-4" />
                البروفايل
              </Button>
            </Link>
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────
            Migration boundary — replaces ALL analytics if the backend
            rejected the payload as schema-incompatible.
           ────────────────────────────────────────────────────────── */}
        {analyticsError?.kind === "migration" ? (
          <MigrationBoundary detail={analyticsError.detail} />
        ) : (
          <>
            {/* ╔═══ Agentic Intervention Banner ═══╗
                Surfaces only when the backend's self-healing loop fired —
                low GPA or a severe Vision 2030 skill gap. The dispatch
                effect above has already injected the suggested pomodoro
                tasks into the plan store before this renders, so the
                banner's claim ("scheduled 3 sessions") is literally true.
                Clicking the banner opens the AI Decision Log dialog. */}
            {agenticAction?.active && (
              <Dialog>
                <DialogTrigger
                  nativeButton={false}
                  render={
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="افتح سجل قرار الذكاء الاصطناعي"
                      className="block w-full text-right cursor-pointer focus:outline-none"
                    />
                  }
                >
                  <AgenticInterventionBanner action={agenticAction} />
                </DialogTrigger>
                <InterventionDialogContent action={agenticAction} />
              </Dialog>
            )}

            {/* ╔═══ TOP ROW · KPI Cards ═══╗ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {/* Current GPA */}
              <Dialog>
                <DialogTrigger nativeButton={false} render={<div role="button" tabIndex={0} className="cursor-pointer text-right w-full h-full block focus:outline-none" />}>
                  <StatCard
                    title="المعدل الحالي"
                    value={hydrated ? currentGpa.toFixed(2) : "—"}
                    subtitle="من أصل 4.00"
                    footer="اضغط لمعرفة التفاصيل"
                    icon={<TrendingUp className="w-5 h-5 text-emerald-500" />}
                    color="emerald"
                    delay="delay-0"
                    sparkline={
                      sparkline.data.length >= 2
                        ? {
                            data: sparkline.data,
                            direction:
                              sparkline.direction === "flat" ? "up" : sparkline.direction,
                          }
                        : undefined
                    }
                  />
                </DialogTrigger>
                <DialogContent className="glass border-foreground/10 sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-emerald-500" />
                      تفاصيل المعدل الحالي
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                      بياناتك مستخرجة من السجل الأكاديمي.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-3">
                    <KvRow label="الساعات المكتسبة" value={`${earnedHours} ساعة`} />
                    <KvRow label="المواد المنجزة" value={`${completedCourses.length} مادة`} />
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex justify-between items-center">
                      <span className="font-bold">المعدل التراكمي:</span>
                      <span className="font-black text-xl">{currentGpa.toFixed(2)}</span>
                    </div>
                    <Button
                      onClick={() => router.push("/gpa")}
                      className="w-full rounded-xl bg-uqu-accent hover:bg-uqu-accent/90"
                    >
                      الانتقال لحاسبة المعدل
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Earned Hours */}
              <Dialog>
                <DialogTrigger nativeButton={false} render={<div role="button" tabIndex={0} className="cursor-pointer text-right w-full h-full block focus:outline-none" />}>
                  <StatCard
                    title="الساعات المنجزة"
                    value={hydrated ? String(earnedHours) : "—"}
                    subtitle={
                      totalPlanHours > 0
                        ? `من أصل ${totalPlanHours} ساعة`
                        : "ساعة مكتسبة"
                    }
                    footer="اضغط لمعاينة التقدم"
                    icon={<BookOpen className="w-5 h-5 text-cyan-500" />}
                    color="cyan"
                    delay="delay-100"
                  />
                </DialogTrigger>
                <DialogContent className="glass border-foreground/10 sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-cyan-500" />
                      تقدم الساعات
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                      نسبة إنجازك من خطتك الأكاديمية + أحدث المواد المنجزة.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-5 py-3">
                    <DegreeProgressRing earned={earnedHours} total={totalPlanHours} />
                    <div className="space-y-2 min-w-0">
                      <div className="flex items-baseline justify-between text-xs text-muted">
                        <span className="font-bold">آخر المواد المنجزة</span>
                        <span className="font-mono text-[10px]">
                          {recentCourses.length} من {completedCourses.length}
                        </span>
                      </div>
                      <div className="max-h-[260px] overflow-y-auto space-y-1.5 pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded">
                        {recentCourses.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-8">
                            لا توجد مواد منجزة بعد. ارفع السجل الأكاديمي من الملف الشخصي.
                          </p>
                        ) : (
                          recentCourses.map((c, i) => (
                            <RecentCourseRow key={`${c.code}-${i}`} course={c} />
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={() => {
                      // TODO: Open Full Transcript Table — pending the
                      // in-place transcript browser. Intentionally not
                      // routing to /transcript anymore (legacy page).
                      console.log("TODO: Open Full Transcript Table");
                    }}
                    className="w-full rounded-xl bg-cyan-500 hover:bg-cyan-600 text-foreground"
                  >
                    عرض جميع المواد
                  </Button>
                </DialogContent>
              </Dialog>

              {/* Target GPA */}
              <Dialog>
                <DialogTrigger nativeButton={false} render={<div role="button" tabIndex={0} className="cursor-pointer text-right w-full h-full block focus:outline-none" />}>
                  <StatCard
                    title="المعدل المستهدف"
                    value={hydrated ? targetGpa.toFixed(2) : "—"}
                    subtitle="حسب إعداداتك"
                    footer="اضغط لمعرفة المطلوب"
                    icon={<Target className="w-5 h-5 text-uqu-accent" />}
                    color="uqu"
                    delay="delay-200"
                    extraSubtext={
                      hydrated && expectedGpa != null
                        ? `المعدل المتوقع بناءً على مسارك: ${expectedGpa.toFixed(2)}`
                        : undefined
                    }
                  />
                </DialogTrigger>
                <DialogContent className="glass border-foreground/10 sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                      <Target className="w-5 h-5 text-uqu-accent" />
                      المطلوب للوصول لهدفك
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                      حساب رياضي بناءً على معدلك الحالي وساعاتك المكتسبة.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-3">
                    <div className="grid grid-cols-2 gap-2">
                      <KvTile label="الحالي" value={currentGpa.toFixed(2)} accent="muted" />
                      <KvTile label="الهدف" value={targetGpa.toFixed(2)} accent="uqu" />
                    </div>
                    <KvRow label="ساعات الفصل القادم" value={`${STANDARD_NEXT_SEMESTER_HOURS} ساعة`} mono />

                    <TargetGpaCallout
                      status={requiredNext.status}
                      required={requiredNext.required}
                      targetGpa={targetGpa}
                      nextHours={STANDARD_NEXT_SEMESTER_HOURS}
                    />

                    {/* Inline editor — replaces the old "go to /profile"
                        link so the user can update their target GPA
                        without leaving the dashboard. */}
                    <TargetGpaEditDialog targetGpa={targetGpa} />
                  </div>
                </DialogContent>
              </Dialog>
            </div>

          {/* ╔═══ MIDDLE ROW · Chart + Calendar ═══╗ */}
            <div className="grid lg:grid-cols-2 gap-6 mb-6">
              {/* العمود الأول: مخطط المعدل التراكمي وتحليله */}
              <div className="flex flex-col gap-3 min-w-0">
                <CumulativeGpaCard
                  series={gpaSeries}
                  loading={analyticsLoading && !analyticsData}
                  completedCount={completedCourses.length}
                  badgeStatus={requiredNext.status}
                />
                {analyticsData?.gpa_trend_analysis && (
                  <GpaTrendInsight text={analyticsData.gpa_trend_analysis} />
                )}
              </div>

              {/* العمود الثاني: التقويم الجامعي (بديل الرادار المحذوف) */}
              <Dialog>
                <DialogTrigger
                  nativeButton={false}
                  render={
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="افتح التقويم الجامعي"
                      className="block w-full text-right cursor-pointer focus:outline-none h-full"
                    />
                  }
                >
                  <AcademicCalendarCard />
                </DialogTrigger>
                <AcademicCalendarDialogContent />
              </Dialog>
            </div>

            {/* ╔═══ BOTTOM ROW · High-ROI + Adherence ═══╗ */}
            <div className="grid lg:grid-cols-2 gap-6">
              <Dialog>
                <DialogTrigger
                  nativeButton={false}
                  render={
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="افتح محاكي السيناريوهات للمواد الحالية"
                      className="block w-full text-right cursor-pointer focus:outline-none h-full"
                    />
                  }
                >
                  <HighRoiCard
                    courses={roiCourses}
                    loading={analyticsLoading && !analyticsData}
                    hasCurrentTerm={currentCourses.length > 0}
                  />
                </DialogTrigger>
                <RoiSimulatorDialog
                  roster={roiRoster}
                  currentGpa={currentGpa}
                  earnedHours={earnedHours}
                />
              </Dialog>
              {/* Pulse-check sits ABOVE the adherence card in the same
                  bento cell when triggered. Keeping it outside the
                  Dialog trigger keeps its inline action buttons free
                  of click-bubbling concerns. */}
              <div className="flex flex-col gap-3 min-w-0 h-full">
                {last3DaysSnapshot.shouldShowPulse && (
                  <PulseCheckCard
                    pendingCount={last3DaysSnapshot.tasks.length}
                    onAck={handleAckPulse}
                    onLate={() => setRolloverOpen(true)}
                  />
                )}
                <Dialog>
                  <DialogTrigger
                    nativeButton={false}
                    render={
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="افتح تحليل الانضباط الدراسي"
                        className="block w-full text-right cursor-pointer focus:outline-none h-full"
                      />
                    }
                  >
                    <AdherenceCard {...adherence} hasPlan={!!plan} />
                  </DialogTrigger>
                  <AdherenceDialogContent
                    {...adherence}
                    hasPlan={!!plan}
                    perDay={adherencePerDay}
                    overdueTasks={overdueTasks}
                    onOpenRollover={() => setRolloverOpen(true)}
                  />
                </Dialog>
              </div>
            </div>
            {/* Soft error footer — non-migration server/network failures.
                Keeps the page useful while signalling that something's off.
                The outer ternary already excludes "migration", so this branch
                only sees `kind: "network" | "server"`. */}
            {analyticsError && (
              <div className="mt-6 p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 text-rose-200 text-xs flex items-start gap-3">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {analyticsError.kind === "network"
                    ? "تعذّر الاتصال بخادم التحليلات. الأرقام أعلاه قد لا تكون محدّثة — تحقق من اتصال السيرفر."
                    : `تعطّل التحليل: ${analyticsError.detail.slice(0, 200)}`}
                </span>
              </div>
            )}

            {/* Sprint-5: page-scoped rollover modal. Opened from either
                the Pulse Check's "لا، لقد تأخرت" button OR the Overdue
                section inside the adherence dialog. */}
            <TaskRolloverDialog
              open={rolloverOpen}
              onOpenChange={setRolloverOpen}
              overdue={overdueTasks}
              onAckAll={() => {
                planMarkTasksDone(overdueTasks.map((t) => taskKey(t)));
                setRolloverOpen(false);
              }}
              onGoToPlan={() => {
                setRolloverOpen(false);
                router.push("/plan");
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Agentic Self-Healing Banner
// ──────────────────────────────────────────────────────────────────

/**
 * Renders the dashboard's top-of-page intervention banner when the
 * backend self-healing loop has fired. The page's dispatch effect has
 * already injected the agent's suggested pomodoro tasks into the plan
 * store by the time this paints, so the banner's "scheduled" claim is
 * literally true — the user can scroll down to /plan and find them.
 */
function AgenticInterventionBanner({ action }: { action: AgenticAction }) {
  const severityTone =
    action.severity === "high"
      ? {
          ring: "border-rose-500/40",
          bg: "from-rose-500/[0.10] via-fuchsia-500/[0.08] to-uqu-accent/[0.10]",
          pulse: "bg-rose-500",
          chipBg: "bg-rose-500/15 text-rose-200 border-rose-500/30",
          icon: "text-rose-300",
        }
      : action.severity === "medium"
        ? {
            ring: "border-amber-500/40",
            bg: "from-amber-500/[0.10] via-orange-500/[0.06] to-uqu-accent/[0.08]",
            pulse: "bg-amber-500",
            chipBg: "bg-amber-500/15 text-amber-200 border-amber-500/30",
            icon: "text-amber-300",
          }
        : {
            ring: "border-uqu-accent/40",
            bg: "from-uqu-accent/[0.10] via-cyan-500/[0.06] to-emerald-500/[0.08]",
            pulse: "bg-uqu-accent",
            chipBg: "bg-uqu-accent/15 text-uqu-accent border-uqu-accent/30",
            icon: "text-uqu-accent",
          };

  return (
    <div
      className={cn(
        "relative overflow-hidden mb-8 rounded-[28px] border bg-gradient-to-l p-6 md:p-7",
        "shadow-[0_0_40px_-12px_rgba(99,102,241,0.4)] animate-in fade-in slide-in-from-top-2 duration-500",
        severityTone.ring,
        severityTone.bg,
      )}
    >
      {/* Aurora glow accents */}
      <span className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full bg-uqu-accent/20 blur-3xl" />
      <span className="pointer-events-none absolute -bottom-24 -left-10 w-64 h-64 rounded-full bg-emerald-400/10 blur-3xl" />

      <div className="relative flex items-start gap-4 flex-wrap md:flex-nowrap">
        {/* Pulsing status dot + icon */}
        <div className="shrink-0 relative">
          <div className="w-12 h-12 rounded-2xl bg-black/40 border border-foreground/10 flex items-center justify-center backdrop-blur-md">
            <Sparkles className={cn("w-6 h-6", severityTone.icon)} />
          </div>
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
              severityTone.pulse,
              "before:content-[''] before:absolute before:inset-0 before:rounded-full before:animate-ping",
              severityTone.pulse,
            )}
          />
        </div>

        {/* Copy */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge
              variant="outline"
              className={cn("text-[10px] font-black px-2 py-0.5", severityTone.chipBg)}
            >
              <Activity className="w-3 h-3 ml-1" />
              تدخل ذكي نشط
            </Badge>
            <span className="text-[10px] font-mono text-muted">
              {action.intervention_id}
            </span>
          </div>
          <h3 className="text-lg md:text-xl font-black mb-1.5 leading-tight">
            {action.headline}
          </h3>
          <p className="text-sm text-foreground leading-relaxed">{action.body}</p>

          {/* Scheduled tasks preview chips */}
          {action.scheduled_tasks.length > 0 && (
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              {action.scheduled_tasks.map((t, i) => (
                <span
                  key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/30 border border-foreground/10 text-[11px] font-bold"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_hsl(160,95%,55%)]" />
                  {t.suggestedDay} · {t.suggestedTime}
                  <span className="text-muted font-mono">
                    {t.durationMinutes}د
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* CTA — stopPropagation so clicking "افتح الخطة" navigates
            instead of opening the parent banner's decision-log dialog. */}
        <Link
          href="/plan"
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="outline"
            className="rounded-2xl glass border-foreground/10 gap-2 hover:border-foreground/10 transition-colors"
          >
            <ArrowUpRight className="w-4 h-4" />
            افتح الخطة
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Migration Boundary — surfaces the 422 case
// ──────────────────────────────────────────────────────────────────

function MigrationBoundary({ detail }: { detail: string }) {
  return (
    <Card className="glass p-10 md:p-14 rounded-[32px] border-amber-500/30 bg-amber-500/[0.04] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-amber-300" />
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl md:text-3xl font-black">
            بياناتك بحاجة لإعادة المزامنة
          </h2>
          <p className="text-base text-foreground leading-relaxed">
            بياناتك الحالية لا تتوافق مع نظام الـ 4 نقاط الجديد. يرجى الذهاب
            للبروفايل وإعادة رفع السجل الأكاديمي.
          </p>
          <p className="text-xs text-muted font-mono leading-relaxed pt-2">
            {detail.slice(0, 220)}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link href="/profile">
            <Button className="rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg shadow-amber-500/20 gap-2">
              <ArrowUpRight className="w-4 h-4" />
              فتح صفحة البروفايل
            </Button>
          </Link>
          <Link href="/gpa">
            <Button
              variant="outline"
              className="rounded-xl glass border-foreground/10 gap-2"
            >
              المتابعة لحاسبة المعدل
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
// Middle Row — Cumulative GPA Chart
// ──────────────────────────────────────────────────────────────────

function CumulativeGpaCard({
  series,
  loading,
  completedCount,
  badgeStatus,
}: {
  series: { semester: string; cumulativeGpa: number; semesterGpa: number }[];
  loading: boolean;
  completedCount: number;
  badgeStatus: "achieved" | "feasible" | "stretch" | "impossible" | "unknown";
}) {
  return (
    <Card className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden min-h-[400px] flex flex-col">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
            <LineChartIcon className="w-5 h-5 text-uqu-accent" />
            تقدم المعدل التراكمي
          </h3>
          <p className="text-sm text-muted-foreground">مسارك نحو الهدف الدراسي</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            badgeStatus === "achieved" || badgeStatus === "feasible"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : badgeStatus === "stretch"
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                : badgeStatus === "impossible"
                  ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  : "bg-foreground/5 text-muted border-foreground/10",
          )}
        >
          {badgeStatus === "achieved"
            ? "تجاوزت الهدف 🎯"
            : badgeStatus === "feasible"
              ? "على المسار الصحيح 🎯"
              : badgeStatus === "stretch"
                ? "يحتاج مجهوداً 💪"
                : badgeStatus === "impossible"
                  ? "غير قابل بـ 15 ساعة"
                  : "حدد هدفك"}
        </Badge>
      </div>

      <div className="flex-1 min-h-[280px]">
        {loading ? (
          <ChartSkeleton />
        ) : series.length < 2 ? (
          <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-foreground/10 rounded-2xl p-8 text-center gap-2">
            <LineChartIcon className="w-8 h-8 text-muted" />
            <p className="text-sm text-muted-foreground">
              نحتاج فصلين دراسيين على الأقل لرسم منحنى التقدم.
            </p>
            <p className="text-xs text-muted">
              {completedCount === 0
                ? "ارفع سجلك الأكاديمي للبدء."
                : `لديك بيانات ${series.length} فصل فقط — أكمل ترماً آخر وستظهر هنا.`}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={series} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gpaGlow" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="hsl(245, 78%, 62%)" />
                  <stop offset="100%" stopColor="hsl(187, 80%, 48%)" />
                </linearGradient>
                <filter id="gpaGlowFilter" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="semester" hide />
              <YAxis domain={[0, 4]} hide />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
                contentStyle={{
                  background: "rgba(10,10,10,0.92)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  backdropFilter: "blur(8px)",
                  padding: "8px 12px",
                  fontSize: 12,
                }}
                labelStyle={{ color: "rgba(255,255,255,0.5)", fontSize: 10, marginBottom: 4 }}
                formatter={(value, name) => {
                  const num = typeof value === "number" ? value : Number(value);
                  const label = name === "cumulativeGpa" ? "تراكمي" : "فصلي";
                  return [Number.isFinite(num) ? num.toFixed(2) : String(value), label];
                }}
              />
              <Line
                type="monotone"
                dataKey="semesterGpa"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={false}
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="cumulativeGpa"
                stroke="url(#gpaGlow)"
                strokeWidth={3}
                filter="url(#gpaGlowFilter)"
                dot={{ r: 4, fill: "hsl(245, 78%, 62%)", strokeWidth: 0 }}
                activeDot={{ r: 6, fill: "#fff", stroke: "hsl(245, 78%, 62%)", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {series.length >= 2 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-foreground/10 text-[11px] flex-wrap gap-2">
          <span className="text-muted font-mono">
            {series[0].semester} → {series[series.length - 1].semester}
          </span>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full bg-uqu-accent" />
              <span className="text-muted font-bold">تراكمي</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full bg-white/30 [background-image:repeating-linear-gradient(90deg,white_0_2px,transparent_2px_4px)]" />
              <span className="text-muted font-bold">فصلي</span>
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Sprint-4 Bug #8 — GPA trend insight box.
 * Renders the backend's one-sentence narrative about per-semester
 * variance directly under the cumulative-GPA chart. The card is glass
 * + glow + AI sparkle icon to read as "model said this" rather than
 * "static label".
 */
function GpaTrendInsight({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="glass rounded-2xl border border-uqu-accent/20 bg-gradient-to-l from-uqu-accent/[0.06] via-cyan-500/[0.04] to-transparent p-4 flex items-start gap-3 shadow-[0_0_24px_-12px_hsla(245,78%,62%,0.5)]">
      <div className="w-9 h-9 rounded-xl bg-uqu-accent/15 border border-uqu-accent/30 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-4 h-4 text-uqu-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-black uppercase tracking-widest text-uqu-accent mb-1">
          تحليل ذكي للمسار
        </div>
        <p className="text-[13px] text-foreground leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Middle Row — Strengths Radar
// ──────────────────────────────────────────────────────────────────

function StrengthsRadarCard({
  data,
  loading,
}: {
  data: {
    category: string;
    student: number;
    market: number;
    skillGap: number;
    creditHours: number;
    courseCount: number;
    isReliable: boolean;
    courses?: RadarCourseRef[];
  }[];
  loading: boolean;
}) {
  // Two polygons need ≥3 axes to read as a radar; otherwise fall back
  // to the dual-bar list view further down.
  const useChart = data.length >= 3;

  // Surface the biggest skill gap as a tiny callout above the chart so
  // the user immediately sees the most actionable insight even before
  // hovering any spoke. Sprint-3: EXCLUDE unreliable categories (<9
  // credits) — we won't tell the student "your weakness is Math" based
  // on a single 2-credit lab.
  const dominantGap = useMemo(() => {
    const candidates = data.filter((d) => d.isReliable);
    if (candidates.length === 0) return null;
    const sorted = [...candidates].sort((a, b) => b.skillGap - a.skillGap);
    const top = sorted[0];
    if (top.skillGap <= 0.05) return null; // already at/above market — no callout
    return top;
  }, [data]);

  return (
    <Card className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden min-h-[400px] flex flex-col">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
            <RadarIcon className="w-5 h-5 text-emerald-400" />
            مصفوفة الـDNA الأكاديمي
          </h3>
          <p className="text-sm text-muted-foreground">
            كفاءتك مقابل متطلبات سوق العمل (رؤية 2030).
          </p>
        </div>
        {data.length > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          >
            {data.length} مجالات
          </Badge>
        )}
      </div>

      {/* Twin legend chips so users instantly grok which polygon is which. */}
      {data.length > 0 && !loading && (
        <div className="flex items-center gap-3 mb-4 text-[11px] flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm border"
              style={{
                background: "hsla(160, 95%, 55%, 0.45)",
                borderColor: "hsl(160, 95%, 55%)",
                boxShadow: "0 0 10px hsla(160, 95%, 55%, 0.45)",
              }}
            />
            <span className="font-bold text-foreground">كفاءتك</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm border"
              style={{
                background: "hsla(210, 100%, 60%, 0.25)",
                borderColor: "hsl(210, 100%, 60%)",
                boxShadow: "0 0 10px hsla(210, 100%, 60%, 0.35)",
              }}
            />
            <span className="font-bold text-foreground">طلب سوق العمل · رؤية 2030</span>
          </span>
        </div>
      )}

      <div className="flex-1 min-h-[260px]">
        {loading ? (
          <ChartSkeleton />
        ) : data.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-foreground/10 rounded-2xl p-8 text-center gap-2">
            <RadarIcon className="w-8 h-8 text-muted" />
            <p className="text-sm text-muted-foreground">
              ارفع سجلك الأكاديمي حتى نحلّل مجالات قوّتك.
            </p>
          </div>
        ) : useChart ? (
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={data} cx="50%" cy="50%" outerRadius="60%">
              <defs>
                {/* Subtle glow on each polygon edge so the dual-radar
                    reads as "alive" against the dark glass card. */}
                <filter id="radarGlowGreen" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.5" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="radarGlowBlue" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.5" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <PolarGrid stroke="var(--color-chart-grid)" />
              {/* Custom tick wraps each label in a glass pill (semantic
                  surface) so it stays legible against the polygons in
                  both light and dark themes. */}
              <PolarAngleAxis
                dataKey="category"
                tick={CustomPolarTick}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 4]}
                tick={{ fill: "var(--muted-text)", fontSize: 9 }}
                tickCount={5}
                stroke="var(--color-chart-grid)"
              />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.2)" }}
                content={<SkillsDnaTooltip />}
              />
              {/* Market demand drawn FIRST so the student polygon sits
                  on top. fillOpacity=0 keeps it as a pure dashed outline
                  — overlapping student polygon stays crisp instead of
                  muddying into the blue fill. */}
              <Radar
                name="market"
                dataKey="market"
                stroke="hsl(210, 100%, 65%)"
                fill="hsl(210, 100%, 60%)"
                fillOpacity={0}
                strokeWidth={2}
                strokeDasharray="4 3"
                filter="url(#radarGlowBlue)"
                isAnimationActive
              />
              <Radar
                name="student"
                dataKey="student"
                stroke="hsl(160, 95%, 55%)"
                fill="hsl(160, 95%, 55%)"
                fillOpacity={0.35}
                strokeWidth={2.5}
                filter="url(#radarGlowGreen)"
                dot={{ r: 3, fill: "hsl(160, 95%, 55%)", strokeWidth: 0 }}
                isAnimationActive
              />
            </RadarChart>
          </ResponsiveContainer>
        ) : (
          // Fallback list — fewer than 3 categories. Twin bars (student
          // vs market) so the gap concept stays visible.
          <div className="h-full flex flex-col justify-center gap-4">
            {data.map((d) => (
              <DnaBarRow key={d.category} row={d} />
            ))}
          </div>
        )}
      </div>

      {dominantGap && (
        <div className="mt-4 p-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/20 text-amber-200 text-[11px] leading-relaxed">
          <strong className="font-black">أبرز فجوة:</strong>{" "}
          <span className="font-bold">{dominantGap.category}</span> —
          أنت عند{" "}
          <span className="font-mono font-bold">{dominantGap.student.toFixed(2)}</span>{" "}
          والسوق يطلب{" "}
          <span className="font-mono font-bold">{dominantGap.market.toFixed(2)}</span>{" "}
          (فارق{" "}
          <span className="font-mono font-bold">+{dominantGap.skillGap.toFixed(2)}</span>،
          بناءً على {dominantGap.creditHours} ساعة معتمدة).
        </div>
      )}
    </Card>
  );
}

/** Custom glassmorphic tooltip that explains the skill-gap delta. */
function SkillsDnaTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { category: string; student: number; market: number; skillGap: number; creditHours: number; isReliable: boolean } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const gap = row.skillGap;
  const gapTone =
    gap > 0.5
      ? "text-rose-300"
      : gap > 0.05
        ? "text-amber-300"
        : "text-emerald-300";
  const gapLabel =
    gap > 0.5
      ? "فجوة كبيرة"
      : gap > 0.05
        ? "فجوة معتدلة"
        : "متفوق على السوق";

  return (
    <div
      className="rounded-xl px-3 py-2.5 text-[11px] min-w-[210px]"
      style={{
        background: "rgba(10, 10, 10, 0.92)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div className="font-black text-foreground text-[12px] mb-1.5">{row.category}</div>
      <div className="flex items-center justify-between gap-3 mb-0.5">
        <span className="text-emerald-300 inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_hsl(160,95%,55%)]" />
          كفاءتك
        </span>
        <span className="font-mono font-bold text-foreground">
          {row.student.toFixed(2)} / 4.00
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-sky-300 inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_hsl(210,100%,60%)]" />
          سوق العمل
        </span>
        <span className="font-mono font-bold text-foreground">
          {row.market.toFixed(2)} / 4.00
        </span>
      </div>
      <div className="pt-1.5 border-t border-foreground/10 flex items-center justify-between gap-3">
        <span className={cn("font-bold", gapTone)}>{gapLabel}</span>
        <span className={cn("font-mono font-black", gapTone)}>
          {gap > 0 ? "+" : ""}{gap.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-muted font-mono">
        {row.creditHours} ساعة معتمدة
      </div>
      {!row.isReliable && <UnreliableWarning className="mt-1.5" />}
    </div>
  );
}

/**
 * Small amber warning chip flagged on every surface that displays a
 * RadarCategoryPoint with `is_reliable === false`. Centralised so the
 * copy stays in sync between the tooltip, the dialog's category panel,
 * and the fallback bar rows.
 */
function UnreliableWarning({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 px-2 py-1 rounded-md bg-amber-500/[0.08] border border-amber-500/25 text-amber-200 text-[10px] font-bold leading-snug",
        className,
      )}
    >
      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
      <span>بيانات غير كافية لتقييم دقيق (&lt; 9 ساعات)</span>
    </div>
  );
}

/**
 * Custom Recharts PolarAngleAxis tick. Uses a `<foreignObject>` so the
 * label pill is rendered as ordinary HTML — Tailwind handles the styling
 * and `whitespace-nowrap` keeps the Arabic taxonomy on one line without
 * needing the brittle SVG width math the previous version did.
 *
 * The fixed-size foreignObject (140×30) is positioned relative to
 * Recharts' textAnchor signal so right/left/center spokes still nest
 * correctly off the outer radius.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomPolarTick = ({ payload, x, y, textAnchor }: any) => {
  const isStart = textAnchor === "start";
  const isEnd = textAnchor === "end";
  // Provide a fixed bounding box for the HTML, then align content inside
  const width = 140;
  const height = 30;
  const xOffset = isStart ? x : isEnd ? x - width : x - width / 2;
  const yOffset = y - height / 2;

  return (
    <foreignObject x={xOffset} y={yOffset} width={width} height={height} className="overflow-visible">
      <div className={`w-full h-full flex items-center ${isStart ? "justify-start" : isEnd ? "justify-end" : "justify-center"}`}>
        {/* Pill background uses semantic tokens so it inverts cleanly:
            light surface + light border in light mode, near-black pill in
            dark mode (matches the original visual). */}
        <div className="bg-card/90 border border-border dark:bg-black/80 dark:border-foreground/10 backdrop-blur-md px-2.5 py-1 rounded-md shadow-xl">
          <span className="text-[9px] font-bold text-foreground whitespace-nowrap">
            {payload.value}
          </span>
        </div>
      </div>
    </foreignObject>
  );
};

function DnaBarRow({
  row,
}: {
  row: {
    category: string;
    student: number;
    market: number;
    skillGap: number;
    creditHours: number;
    courseCount: number;
    isReliable: boolean;
  };
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-bold text-foreground">{row.category}</span>
        <span className="text-[10px] font-mono text-muted">
          فجوة {row.skillGap > 0 ? "+" : ""}{row.skillGap.toFixed(2)}
        </span>
      </div>
      {!row.isReliable && <UnreliableWarning />}
      {/* Student bar (neon green) */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-emerald-300 font-bold w-12">كفاءتك</span>
        <div className="flex-1 h-2 rounded-full bg-foreground/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-l from-emerald-400 to-cyan-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
            style={{ width: `${Math.min(100, (row.student / 4) * 100)}%` }}
          />
        </div>
        <span className="text-[10px] font-mono font-black text-emerald-300 w-10 text-right">
          {row.student.toFixed(2)}
        </span>
      </div>
      {/* Market bar (electric blue) */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-sky-300 font-bold w-12">السوق</span>
        <div className="flex-1 h-2 rounded-full bg-foreground/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-l from-sky-400 to-indigo-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]"
            style={{ width: `${Math.min(100, (row.market / 4) * 100)}%` }}
          />
        </div>
        <span className="text-[10px] font-mono font-black text-sky-300 w-10 text-right">
          {row.market.toFixed(2)}
        </span>
      </div>
      <div className="text-[10px] text-muted font-mono">
        {row.courseCount} مادة · {row.creditHours} ساعة معتمدة
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Bottom Row — High-ROI Courses
// ──────────────────────────────────────────────────────────────────

function HighRoiCard({
  courses,
  loading,
  hasCurrentTerm,
}: {
  courses: HighRoiCourse[];
  loading: boolean;
  hasCurrentTerm: boolean;
}) {
  return (
    <Card className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            روافع المعدل
          </h3>
          <p className="text-sm text-muted-foreground">
            المواد الحالية الأعلى تأثيراً على معدلك التراكمي.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-20 rounded-2xl bg-foreground/5" />
          <div className="h-20 rounded-2xl bg-foreground/5" />
        </div>
      ) : courses.length === 0 ? (
        <div className="h-[180px] flex flex-col items-center justify-center border-2 border-dashed border-foreground/10 rounded-2xl text-center gap-2 p-6">
          <Zap className="w-8 h-8 text-muted" />
          <p className="text-sm text-muted-foreground">
            {hasCurrentTerm
              ? "لا تتوفر بيانات كافية لحساب الرافعة الآن."
              : "لا توجد مواد مسجّلة في الفصل الحالي. أكمل الإعداد من البروفايل."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {courses.map((c, i) => (
            <RoiRow key={c.code} course={c} rank={i + 1} />
          ))}
          <p className="text-[10px] text-muted mt-3 leading-relaxed">
            الحساب: <span className="font-mono">credits × 4.00</span> +
            تقدير الرفعة المحتملة على المعدل التراكمي عند الحصول على A+.
            اضغط البطاقة لفتح محاكي السيناريوهات الكامل.
          </p>
        </div>
      )}
    </Card>
  );
}

function RoiRow({ course, rank }: { course: HighRoiCourse; rank: number }) {
  return (
    <div className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10 hover:border-amber-500/30 transition-colors flex items-start gap-4">
      <div
        className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shrink-0 border",
          rank === 1
            ? "bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-[0_0_18px_rgba(245,158,11,0.18)]"
            : "bg-foreground/5 text-muted border-foreground/10",
        )}
      >
        #{rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h4 className="text-[14px] font-black truncate">{course.name}</h4>
          <span className="text-[10px] font-mono text-muted shrink-0">{course.code}</span>
        </div>
        <p className="text-[11px] text-muted leading-relaxed mt-1">{course.label}</p>
        <div className="flex items-center gap-4 mt-2 text-[11px]">
          <span className="text-muted">
            الساعات:{" "}
            <span className="font-mono font-bold text-foreground">{course.credits}</span>
          </span>
          <span className="text-muted">
            أقصى مساهمة:{" "}
            <span className="font-mono font-bold text-amber-300">
              {course.max_point_contribution.toFixed(2)}
            </span>
          </span>
          {course.projected_delta > 0 && (
            <span className="text-muted">
              رفعة محتملة:{" "}
              <span className="font-mono font-bold text-emerald-300">
                +{course.projected_delta.toFixed(2)}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Bottom Row — Adherence Indicator
// ──────────────────────────────────────────────────────────────────

function AdherenceCard({
  completed,
  total,
  pct,
  hasPlan,
}: {
  completed: number;
  total: number;
  pct: number;
  hasPlan: boolean;
}) {
  const tone =
    pct >= 70
      ? "emerald"
      : pct >= 40
        ? "uqu"
        : "rose";

  const toneClasses = {
    emerald: {
      ring: "stroke-emerald-400",
      glow: "drop-shadow(0 0 8px hsla(160,80%,50%,0.5))",
      pill: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
      icon: "text-emerald-400",
    },
    uqu: {
      ring: "stroke-uqu-accent",
      glow: "drop-shadow(0 0 8px hsla(245,78%,62%,0.5))",
      pill: "bg-uqu-accent/15 text-uqu-accent border-uqu-accent/30",
      icon: "text-uqu-accent",
    },
    rose: {
      ring: "stroke-rose-400",
      glow: "drop-shadow(0 0 8px hsla(0,80%,60%,0.4))",
      pill: "bg-rose-500/15 text-rose-300 border-rose-500/30",
      icon: "text-rose-400",
    },
  } as const;

  const t = toneClasses[tone];
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(1, pct / 100));

  const headline = !hasPlan
    ? "لم تُولَّد خطة بعد"
    : total === 0
      ? "لا توجد مهام في الخطة"
      : pct >= 70
        ? "انضباط ممتاز 🔥"
        : pct >= 40
          ? "تقدّم جيد — استمر"
          : "ركّز على إكمال مهام اليوم";

  return (
    <Card className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
            <ListChecks className={cn("w-5 h-5", t.icon)} />
            مؤشر الانضباط
          </h3>
          <p className="text-sm text-muted-foreground">
            نسبة إنجازك من مهام خطتك الذكية لهذا الأسبوع.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn("text-[10px] font-bold", t.pill)}
        >
          {headline}
        </Badge>
      </div>

      <div className="grid grid-cols-[140px_1fr] gap-6 items-center">
        {/* Progress ring */}
        <div className="relative w-[140px] h-[140px] mx-auto">
          <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={10}
            />
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              className={t.ring}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{
                transition: "stroke-dashoffset 700ms ease-out",
                filter: t.glow,
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-3xl font-black font-mono">{pct}%</div>
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">
              إنجاز
            </div>
          </div>
        </div>

        {/* Numbers */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-bold text-muted">المهام المكتملة</span>
            <span className="font-mono font-black text-lg">{completed}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-bold text-muted">إجمالي مهام الخطة</span>
            <span className="font-mono font-black text-lg">{total}</span>
          </div>
          <div className="flex items-baseline justify-between pt-3 border-t border-foreground/10">
            <span className="text-[12px] font-bold text-muted">المتبقي</span>
            <span className="font-mono font-black text-lg text-foreground">
              {Math.max(0, total - completed)}
            </span>
          </div>
          {/* stopPropagation so the inner CTA navigates rather than
              opening the parent card's adherence drill-down dialog. */}
          {hasPlan && total > 0 ? (
            <Link href="/plan" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="outline"
                className="w-full rounded-xl glass border-foreground/10 gap-2 mt-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                إدارة المهام
              </Button>
            </Link>
          ) : (
            <Link href="/plan" onClick={(e) => e.stopPropagation()}>
              <Button className="w-full rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 mt-2">
                ولّد خطتك الذكية
              </Button>
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
// Drill-down Dialogs — Phase-2 interactivity
// ──────────────────────────────────────────────────────────────────
//
// Each of the four data widgets (Skills Radar, Agentic Banner, High-ROI
// Courses, Adherence Indicator) opens a dedicated dialog co-located here.
// They follow the same glass / rounded-[28px] / animated-base-ui pattern
// the Top KPI cards already use — no new visual language introduced.
//
// All four are uncontrolled (`<Dialog>` self-manages open state via its
// trigger button). The dashboard page just wraps the widget JSX in
// `<DialogTrigger render={<button … />}>` and the matching
// `<DialogContent>` lives as its sibling, exactly mirroring the KPI
// cards above.

// ── 1. Skills Radar Dialog ───────────────────────────────────────
function SkillsRadarDialogContent({
  data,
}: {
  data: {
    category: string;
    student: number;
    market: number;
    skillGap: number;
    creditHours: number;
    courseCount: number;
    isReliable: boolean;
    courses: RadarCourseRef[];
  }[];
}) {
  // Default-selected category: biggest gap AMONG reliable categories
  // (Sprint-3 — same gating rule as the dominant-gap callout). Only
  // falls back to including unreliable rows if literally every category
  // is unreliable (fresh student with one elective per area).
  const initialCategory = useMemo(() => {
    if (data.length === 0) return null;
    const reliable = data.filter((d) => d.isReliable);
    const pool = reliable.length > 0 ? reliable : data;
    return [...pool].sort((a, b) => b.skillGap - a.skillGap)[0]?.category ?? null;
  }, [data]);
  const [selected, setSelected] = useState<string | null>(initialCategory);

  // Re-seed selection when the data refreshes (transcript re-upload).
  useEffect(() => {
    setSelected(initialCategory);
  }, [initialCategory]);

  const active = data.find((d) => d.category === selected) ?? data[0] ?? null;

  return (
    <DialogContent
      className="glass border-foreground/10 bg-card/95 backdrop-blur-2xl rounded-[28px] p-0 sm:max-w-[min(900px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-foreground/10 shrink-0">
        <DialogTitle className="text-xl font-black flex items-center gap-3">
          <RadarIcon className="w-6 h-6 text-emerald-400" />
          مصفوفة الـDNA الأكاديمي — تفاصيل المجالات
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          اختر مجالاً لاستعراض المواد المكتملة الداخلة في حسابه ونقطها المساهمة.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
        {data.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            لا توجد بيانات سجل أكاديمي لاستعراضها.
          </div>
        ) : (
          <div className="grid md:grid-cols-[260px_1fr] gap-4">
            {/* Category picker rail */}
            <div className="space-y-1.5 md:max-h-[60vh] md:overflow-y-auto md:pr-1">
              {data.map((d) => {
                const isActive = d.category === selected;
                // Unreliable categories get a muted gap tone — we don't
                // want a red "high gap" pill drawing attention to a row
                // the user shouldn't trust yet.
                const gapTone = !d.isReliable
                  ? "text-muted"
                  : d.skillGap > 0.5
                    ? "text-rose-300"
                    : d.skillGap > 0.05
                      ? "text-amber-300"
                      : "text-emerald-300";
                return (
                  <button
                    key={d.category}
                    onClick={() => setSelected(d.category)}
                    className={cn(
                      "w-full text-right rounded-2xl p-3 border transition-all",
                      isActive
                        ? "bg-uqu-accent/[0.08] border-uqu-accent/40 shadow-[0_0_18px_-6px_hsla(245,78%,62%,0.6)]"
                        : "bg-foreground/5 border-foreground/10 hover:bg-foreground/5 hover:border-foreground/10",
                      !d.isReliable && !isActive && "opacity-60",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-[13px] font-black truncate">
                        {d.category}
                      </span>
                      <span className={cn("text-[10px] font-mono font-bold", gapTone)}>
                        {d.skillGap > 0 ? "+" : ""}
                        {d.skillGap.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
                      <span>أنت {d.student.toFixed(2)}</span>
                      <span className="text-muted">·</span>
                      <span>سوق {d.market.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted mt-0.5">
                      <span>{d.courseCount} مادة · {d.creditHours} ساعة</span>
                      {!d.isReliable && (
                        <span className="text-amber-300/80 font-bold">
                          عيّنة صغيرة
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Course breakdown for the active category */}
            <div className="space-y-2 min-w-0">
              {active ? (
                <>
                  <div className="p-4 rounded-2xl bg-gradient-to-l from-emerald-500/[0.06] via-cyan-500/[0.04] to-uqu-accent/[0.06] border border-foreground/10 mb-3 space-y-3">
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <h4 className="text-base font-black">{active.category}</h4>
                      <span className="text-[10px] font-mono text-muted">
                        {active.courses.length} مادة في هذا المجال
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <DialogStat
                        label="كفاءتك"
                        value={active.student.toFixed(2)}
                        accent="emerald"
                      />
                      <DialogStat
                        label="سوق العمل"
                        value={active.market.toFixed(2)}
                        accent="sky"
                      />
                      <DialogStat
                        label="الفجوة"
                        value={`${active.skillGap > 0 ? "+" : ""}${active.skillGap.toFixed(2)}`}
                        accent={
                          active.skillGap > 0.5
                            ? "rose"
                            : active.skillGap > 0.05
                              ? "amber"
                              : "emerald"
                        }
                      />
                    </div>
                    {!active.isReliable && <UnreliableWarning />}
                  </div>

                  {active.courses.length === 0 ? (
                    <div className="text-center py-8 text-xs text-muted-foreground">
                      لا توجد مواد مكتملة في هذا المجال بعد.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-12 px-3 text-[10px] font-black uppercase tracking-wider text-muted">
                        <span className="col-span-5">المادة</span>
                        <span className="col-span-2 text-center">ساعات</span>
                        <span className="col-span-2 text-center">درجة</span>
                        <span className="col-span-3 text-left">مساهمة نقطية</span>
                      </div>
                      {active.courses.map((c) => (
                        <div
                          key={`${c.code}-${c.semester}`}
                          className="grid grid-cols-12 items-center px-3 py-2.5 rounded-xl bg-foreground/5 border border-foreground/10 text-[12px]"
                        >
                          <div className="col-span-5 min-w-0">
                            <div className="font-bold truncate">
                              {c.name || c.code}
                            </div>
                            <div className="text-[10px] font-mono text-muted">
                              {c.semester}
                            </div>
                          </div>
                          <div className="col-span-2 text-center font-mono font-bold text-foreground">
                            {c.credits}
                          </div>
                          <div className="col-span-2 flex justify-center">
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded-md text-[11px] font-black font-mono border",
                                gradeTone(c.grade || "—"),
                              )}
                            >
                              {c.grade || "—"}
                            </span>
                          </div>
                          <div className="col-span-3 text-left">
                            <span className="font-mono font-black text-emerald-300">
                              {c.contribution.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-muted font-mono mr-1">
                              نقطة
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </DialogContent>
  );
}

// ── 2. Agentic Intervention Dialog (AI Decision Log) ─────────────
function InterventionDialogContent({ action }: { action: AgenticAction }) {
  const totalMinutes = action.scheduled_tasks.reduce(
    (s, t) => s + t.durationMinutes,
    0,
  );

  return (
    <DialogContent
      className="glass border-foreground/10 bg-card/95 backdrop-blur-2xl rounded-[28px] p-0 sm:max-w-[min(820px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-foreground/10 shrink-0">
        <DialogTitle className="text-xl font-black flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-uqu-accent" />
          سجل قرار الذكاء الاصطناعي
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          الأسباب التي دفعت النظام لتفعيل التدخّل الاستدراكي تلقائياً.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Identity block */}
        <div className="grid grid-cols-3 gap-3">
          <DialogStat label="المُشغّل" value={triggerLabel(action.trigger)} accent="uqu" />
          <DialogStat label="الشدّة" value={severityLabel(action.severity)} accent={severityToAccent(action.severity)} />
          <DialogStat label="رقم التدخّل" value={action.intervention_id.replace("intv_", "#")} accent="muted" mono />
        </div>

        {/* Decision log rows */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-black uppercase tracking-widest text-muted mb-1">
            سلسلة القرارات
          </h4>
          {action.reasoning.length === 0 ? (
            <p className="text-xs text-muted italic">
              لم يُرفق سجل قرارات لهذا التدخّل.
            </p>
          ) : (
            action.reasoning.map((row, i) => (
              <DecisionLogRow key={i} row={row} index={i + 1} />
            ))
          )}
        </div>

        {/* Scheduled tasks recap */}
        {action.scheduled_tasks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-muted">
                الجلسات المُجدْولة في خطتك
              </h4>
              <span className="text-[10px] font-mono text-muted">
                {action.scheduled_tasks.length} جلسات · {totalMinutes} دقيقة
              </span>
            </div>
            <div className="space-y-1.5">
              {action.scheduled_tasks.map((t, i) => (
                <div
                  key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/15"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_hsl(160,95%,55%)]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold truncate">{t.title}</div>
                    <div className="text-[10px] text-muted font-mono mt-0.5">
                      {t.suggestedDay} · {t.suggestedTime} · {t.durationMinutes}د
                      {t.courseCode ? ` · ${t.courseCode}` : ""}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-uqu-accent/15 text-uqu-accent border border-uqu-accent/30">
                    {t.priority === "high" ? "أولوية عالية" : t.priority === "medium" ? "متوسطة" : "منخفضة"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Link href="/plan">
          <Button className="w-full rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 mt-2">
            <ArrowUpRight className="w-4 h-4" />
            افتح صفحة الخطة لمراجعة الجلسات
          </Button>
        </Link>
      </div>
    </DialogContent>
  );
}

function DecisionLogRow({ row, index }: { row: DecisionLogEntry; index: number }) {
  const tone =
    row.severity === "alert"
      ? "border-rose-500/30 bg-rose-500/[0.05]"
      : row.severity === "warn"
        ? "border-amber-500/30 bg-amber-500/[0.05]"
        : "border-foreground/10 bg-foreground/5";
  const dot =
    row.severity === "alert"
      ? "bg-rose-400 shadow-[0_0_6px_hsla(0,80%,60%,0.6)]"
      : row.severity === "warn"
        ? "bg-amber-400 shadow-[0_0_6px_hsla(40,90%,60%,0.6)]"
        : "bg-white/30";
  return (
    <div className={cn("p-3 rounded-xl border flex gap-3 items-start", tone)}>
      <div className="flex flex-col items-center pt-0.5 gap-1 shrink-0">
        <span className="text-[10px] font-mono font-black text-muted">
          {String(index).padStart(2, "0")}
        </span>
        <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono text-muted leading-relaxed break-all">
          {row.fact}
        </div>
        <p className="text-[13px] text-foreground leading-relaxed mt-1.5">
          {row.interpretation}
        </p>
      </div>
    </div>
  );
}

// ── 3. High-ROI Course Dialog — Unified What-If Simulator ────────
// Sprint 2 — Bug #12 fix:
// Replaces the old per-row isolated tables with ONE interactive dialog
// that lets the user dial in a hypothetical grade for every current-term
// course at once and watch the projected cumulative GPA recompute in
// real time. Strategy banner highlights the single biggest leverage
// course so users know where to invest the most effort.
const SIMULATION_GRADES: { letter: string; points: number }[] = [
  { letter: "A+", points: 4.0 },
  { letter: "A", points: 3.75 },
  { letter: "B+", points: 3.5 },
  { letter: "B", points: 3.0 },
  { letter: "C+", points: 2.5 },
  { letter: "C", points: 2.0 },
  { letter: "D+", points: 1.5 },
  { letter: "D", points: 1.0 },
  { letter: "F", points: 0.0 },
];

/** Full roster row for the simulator — every in-progress course, credits already resolved. */
type RoiRosterCourse = { code: string; name: string; credits: number };

function RoiSimulatorDialog({
  roster,
  currentGpa,
  earnedHours,
}: {
  roster: RoiRosterCourse[];
  currentGpa: number;
  earnedHours: number;
}) {
  // Default every course to A+ ("maximum potential") per spec.
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(roster.map((c) => [c.code, "A+"])),
  );

  // Reconcile when the roster changes (e.g., a new term gets imported
  // while the user has the dialog open). Add defaults for new codes,
  // drop entries for codes that disappeared — preserve any picks the
  // user already chose.
  useEffect(() => {
    setPicks((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const c of roster) {
        if (prev[c.code]) {
          next[c.code] = prev[c.code];
        } else {
          next[c.code] = "A+";
          changed = true;
        }
      }
      if (!changed && Object.keys(prev).length === roster.length) return prev;
      return next;
    });
  }, [roster]);

  // ── Live projection math ──
  const { termPoints, termHours, projectedGpa, delta } = useMemo(() => {
    const lookup = new Map(SIMULATION_GRADES.map((g) => [g.letter, g.points]));
    let pts = 0;
    let hrs = 0;
    for (const c of roster) {
      const pickedLetter = picks[c.code] ?? "A+";
      const p = lookup.get(pickedLetter) ?? 4.0;
      pts += p * c.credits;
      hrs += c.credits;
    }
    const currentPoints = currentGpa * earnedHours;
    const newHours = earnedHours + hrs;
    const projected = newHours > 0 ? (currentPoints + pts) / newHours : currentGpa;
    return {
      termPoints: pts,
      termHours: hrs,
      projectedGpa: projected,
      delta: projected - currentGpa,
    };
  }, [picks, roster, currentGpa, earnedHours]);

  // ── AI strategy banner ──
  // Highest-credits current course = the biggest GPA leverage. If we have
  // ties, prefer the one whose CURRENT pick is below A+ (more impactful
  // to call out a "don't compromise here" choice when the student has
  // already lowered their expectation).
  const leverageCourse = useMemo(() => {
    if (roster.length === 0) return null;
    const sorted = [...roster].sort((a, b) => {
      if (b.credits !== a.credits) return b.credits - a.credits;
      const aDown = (picks[a.code] ?? "A+") !== "A+" ? 1 : 0;
      const bDown = (picks[b.code] ?? "A+") !== "A+" ? 1 : 0;
      return bDown - aDown;
    });
    return sorted[0];
  }, [roster, picks]);

  const projectionTone =
    delta >= 0.05
      ? { glow: "hsl(160, 95%, 55%)", text: "text-emerald-300" }
      : delta <= -0.05
        ? { glow: "hsl(0, 80%, 60%)", text: "text-rose-300" }
        : { glow: "hsl(245, 78%, 62%)", text: "text-uqu-accent" };

  const resetAll = () =>
    setPicks(Object.fromEntries(roster.map((c) => [c.code, "A+"])));

  return (
    <DialogContent
      className="glass border-foreground/10 bg-card/95 backdrop-blur-2xl rounded-[28px] p-0 sm:max-w-[min(820px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-foreground/10 shrink-0">
        <DialogTitle className="text-xl font-black flex items-center gap-3">
          <Zap className="w-6 h-6 text-amber-400" />
          محاكي السيناريوهات — ماذا لو؟
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          جرّب درجات افتراضية على مواد فصلك الحالي وشاهد أثرها الفوري على
          معدلك التراكمي.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* HERO — projected cumulative GPA, glowing, updates instantly */}
        <div
          className="relative rounded-3xl border border-foreground/10 bg-gradient-to-l from-uqu-accent/[0.08] via-cyan-500/[0.06] to-emerald-500/[0.08] p-6 text-center overflow-hidden"
          style={{
            boxShadow: `0 0 40px -10px ${projectionTone.glow}`,
          }}
        >
          <span
            className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full blur-3xl opacity-50"
            style={{ background: projectionTone.glow }}
          />
          <div className="relative">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">
              المعدل التراكمي المتوقع
            </div>
            <div
              className={cn(
                "text-6xl md:text-7xl font-black tracking-tighter font-mono leading-none",
                projectionTone.text,
              )}
              style={{ textShadow: `0 0 24px ${projectionTone.glow}` }}
            >
              {projectedGpa.toFixed(2)}
            </div>
            <div className="text-[11px] text-muted mt-3 font-mono">
              من أصل 4.00 · حالياً {currentGpa.toFixed(2)} ·{" "}
              <span className={cn("font-bold", projectionTone.text)}>
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* AI strategy banner */}
        {leverageCourse && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/[0.06] border border-amber-500/25">
            <Sparkles className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-amber-200 leading-relaxed">
              <span className="font-black">استراتيجية ذكية:</span>{" "}
              لتحقيق أعلى قفزة، لا تتنازل عن{" "}
              <span className="font-mono font-black bg-amber-500/20 px-1.5 py-0.5 rounded">
                A+
              </span>{" "}
              في مادة{" "}
              <span className="font-black">{leverageCourse.name}</span>{" "}
              <span className="text-amber-200/70 font-normal">
                ({leverageCourse.credits} ساعات — أعلى ثقل في فصلك).
              </span>
            </p>
          </div>
        )}

        {/* Per-course pickers */}
        {roster.length === 0 ? (
          <div className="h-[180px] flex flex-col items-center justify-center border-2 border-dashed border-foreground/10 rounded-2xl text-center gap-2 p-6">
            <Zap className="w-8 h-8 text-muted" />
            <p className="text-sm text-muted-foreground">
              لا توجد مواد مسجّلة في الفصل الحالي. أكمل الإعداد من البروفايل.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-muted">
                مواد الفصل الحالي ({roster.length})
              </h4>
              <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
                <span>مجموع الساعات: {termHours}</span>
                <span>·</span>
                <span>نقاط متوقعة: {termPoints.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={resetAll}
                  className="text-uqu-accent hover:text-uqu-accent/80 font-bold underline mr-1"
                >
                  إعادة الكل لـA+
                </button>
              </div>
            </div>

            <div className="grid grid-cols-12 px-3 text-[10px] font-black uppercase tracking-wider text-muted">
              <span className="col-span-6">المادة</span>
              <span className="col-span-2 text-center">ساعات</span>
              <span className="col-span-2 text-center">الدرجة</span>
              <span className="col-span-2 text-left">المساهمة</span>
            </div>
            {roster.map((c) => (
              <RoiSimRow
                key={c.code}
                course={c}
                pick={picks[c.code] ?? "A+"}
                onChange={(letter) =>
                  setPicks((prev) => ({ ...prev, [c.code]: letter }))
                }
              />
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted leading-relaxed pt-1 border-t border-foreground/10">
          الحساب:{" "}
          <span className="font-mono">
            projected = (current_gpa × earned + Σ(grade × credits)) / (earned + Σcredits)
          </span>
          — على مقياس UQU 4.00 الرسمي.
        </p>
      </div>
    </DialogContent>
  );
}

function RoiSimRow({
  course,
  pick,
  onChange,
}: {
  course: RoiRosterCourse;
  pick: string;
  onChange: (letter: string) => void;
}) {
  const points = SIMULATION_GRADES.find((g) => g.letter === pick)?.points ?? 4;
  const contribution = points * course.credits;
  const tone = gradeTone(pick);
  return (
    <div className="grid grid-cols-12 items-center px-3 py-2.5 rounded-xl bg-foreground/5 border border-foreground/10 text-[12px] gap-2">
      <div className="col-span-6 min-w-0">
        <div className="font-bold truncate">{course.name}</div>
        <div className="text-[10px] font-mono text-muted mt-0.5">{course.code}</div>
      </div>
      <div className="col-span-2 text-center font-mono font-bold text-foreground">
        {course.credits}
      </div>
      <div className="col-span-2 flex justify-center">
        <div
          className={cn(
            "relative inline-flex items-center rounded-md border font-mono font-black text-[11px]",
            tone,
          )}
        >
          <select
            value={pick}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`اختر درجة افتراضية لمادة ${course.name}`}
            className="appearance-none bg-transparent pr-2 pl-6 py-1 outline-none cursor-pointer"
          >
            {SIMULATION_GRADES.map((g) => (
              <option key={g.letter} value={g.letter} className="bg-background text-foreground">
                {g.letter}
              </option>
            ))}
          </select>
          <span className="w-2 h-2 absolute left-2 pointer-events-none opacity-50 border-l-2 border-b-2 border-current rotate-[-45deg]" />
        </div>
      </div>
      <div className="col-span-2 text-left font-mono font-black text-amber-300">
        {contribution.toFixed(2)}
      </div>
    </div>
  );
}

// ── Sprint-5 Pulse Check + Smart Task Rollover ───────────────────
//
// Two complementary surfaces:
//   • PulseCheckCard — supportive, micro-interactive card that pops
//     above the AdherenceCard when the user has logged zero activity
//     for ≥3 days despite scheduled tasks. Two CTAs: forgive (mark
//     done) or open rollover.
//   • TaskRolloverDialog — focused modal listing overdue tasks with
//     two paths: accept-all (bulk-mark done) or jump to /plan to
//     regenerate (the planStore auto-injects backlog into the prompt).

/** Days/tasks pulse — the friendly nudge. */
function PulseCheckCard({
  pendingCount,
  onAck,
  onLate,
}: {
  pendingCount: number;
  onAck: () => void;
  onLate: () => void;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[24px] border border-uqu-accent/30",
        "bg-gradient-to-l from-uqu-accent/[0.10] via-cyan-500/[0.06] to-emerald-500/[0.06]",
        "p-4 md:p-5 shadow-[0_0_32px_-12px_hsla(245,78%,62%,0.55)]",
        "animate-in fade-in slide-in-from-top-2 duration-400",
      )}
    >
      <span className="pointer-events-none absolute -top-12 -right-8 w-40 h-40 rounded-full bg-uqu-accent/15 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-uqu-accent/15 border border-uqu-accent/30 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-uqu-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-uqu-accent mb-1">
            فحص نبض الانضباط
          </div>
          <p className="text-[13px] font-bold text-foreground leading-relaxed">
            تبدو مشغولاً هذا الأسبوع! هل تذاكر بطريقتك الخاصة خارج النظام؟
          </p>
          <p className="text-[10px] text-muted font-mono mt-1">
            {pendingCount} مهام في آخر 3 أيام بلا تأكيد إنجاز.
          </p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button
              size="sm"
              onClick={onAck}
              className="rounded-xl bg-emerald-500/90 hover:bg-emerald-500 text-foreground gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              نعم، أنجزت مهامي
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onLate}
              className="rounded-xl glass border-foreground/10 gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" />
              لا، لقد تأخرت
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Page-scoped task rollover modal — see TaskRolloverDialog spec above. */
function TaskRolloverDialog({
  open,
  onOpenChange,
  overdue,
  onAckAll,
  onGoToPlan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overdue: PlanTask[];
  onAckAll: () => void;
  onGoToPlan: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="glass border-foreground/10 bg-card/95 backdrop-blur-2xl rounded-[28px] p-0 sm:max-w-[min(640px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
        dir="rtl"
      >
        <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-foreground/10 shrink-0">
          <DialogTitle className="text-xl font-black flex items-center gap-3">
            <ListChecks className="w-6 h-6 text-amber-300" />
            ترحيل المهام المتأخرة
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            هذه المهام جدولتها من قبل ولم تُعلَّم كمكتملة. اختر كيف نتعامل معها.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
          {overdue.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              لا توجد مهام متأخرة. أحسنت!
            </div>
          ) : (
            <>
              <div className="text-[11px] font-black uppercase tracking-widest text-amber-300">
                {overdue.length} مهمة متأخرة
              </div>
              <div className="space-y-1.5">
                {overdue.map((t, i) => (
                  <div
                    key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/20"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_hsl(40,90%,60%)]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-bold truncate">
                        {t.title}
                      </div>
                      <div className="text-[10px] text-muted font-mono mt-0.5">
                        {t.suggestedDay} · {t.suggestedTime} · {t.durationMinutes}د
                        {t.courseCode ? ` · ${t.courseCode}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-foreground/10">
            <Button
              onClick={onAckAll}
              disabled={overdue.length === 0}
              className="rounded-xl bg-emerald-500/90 hover:bg-emerald-500 text-foreground gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              اعتبر كل المهام مكتملة
            </Button>
            <Button
              onClick={onGoToPlan}
              variant="outline"
              className="rounded-xl glass border-uqu-accent/40 text-uqu-accent gap-2"
            >
              <ArrowUpRight className="w-4 h-4" />
              ولّد خطة جديدة (مع ترحيل البقايا)
            </Button>
          </div>
          <p className="text-[10px] text-muted leading-relaxed">
            عند توليد خطة جديدة، يحقن النظام تلقائياً قائمة المتأخرات في
            طلب الذكاء الاصطناعي ليُضيفها للأسبوع القادم مع ملاحظة استراتيجية.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 4. Adherence Dialog ──────────────────────────────────────────
function AdherenceDialogContent({
  completed,
  total,
  pct,
  hasPlan,
  perDay,
  overdueTasks,
  onOpenRollover,
}: {
  completed: number;
  total: number;
  pct: number;
  hasPlan: boolean;
  perDay: { day: string; total: number; done: number; pct: number }[];
  /** Sprint-5: tasks scheduled before today this week that aren't done. */
  overdueTasks: PlanTask[];
  onOpenRollover: () => void;
}) {
  return (
    <DialogContent
      className="glass border-foreground/10 bg-card/95 backdrop-blur-2xl rounded-[28px] p-0 sm:max-w-[min(760px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-foreground/10 shrink-0">
        <DialogTitle className="text-xl font-black flex items-center gap-3">
          <ListChecks className="w-6 h-6 text-uqu-accent" />
          تحليل الانضباط الدراسي
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          توزيع نسبة إنجاز مهام خطتك الذكية على أيام الأسبوع.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Sprint-5: Overdue carry-over section pinned to the top of
            today's view so the user sees the backlog before the chart. */}
        {overdueTasks.length > 0 && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 className="text-[12px] font-black uppercase tracking-widest text-amber-300">
                مهام متأخرة من الأيام السابقة (Overdue)
              </h4>
              <span className="text-[10px] font-mono text-amber-300/70">
                {overdueTasks.length} مهمة
              </span>
            </div>
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded">
              {overdueTasks.map((t, i) => (
                <div
                  key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                  className="flex items-center gap-3 p-2 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px]"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_hsl(40,90%,60%)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{t.title}</div>
                    <div className="text-[10px] font-mono text-muted mt-0.5">
                      {t.suggestedDay} · {t.suggestedTime} · {t.durationMinutes}د
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button
              onClick={onOpenRollover}
              variant="outline"
              className="w-full rounded-xl glass border-amber-500/30 text-amber-200 hover:bg-amber-500/10 gap-2"
            >
              <ArrowUpRight className="w-4 h-4" />
              ترحيل البقايا إلى الأسبوع الجديد
            </Button>
          </div>
        )}

        {/* Overall stats */}
        <div className="grid grid-cols-3 gap-3">
          <DialogStat
            label="نسبة الإنجاز"
            value={`${pct}%`}
            accent={pct >= 70 ? "emerald" : pct >= 40 ? "uqu" : "rose"}
            mono
          />
          <DialogStat label="مكتملة" value={String(completed)} accent="emerald" mono />
          <DialogStat label="إجمالي المهام" value={String(total)} accent="muted" mono />
        </div>

        {/* Weekly per-day adherence chart */}
        {!hasPlan || total === 0 ? (
          <div className="h-[260px] flex flex-col items-center justify-center border-2 border-dashed border-foreground/10 rounded-2xl gap-2 text-center p-6">
            <Activity className="w-8 h-8 text-muted" />
            <p className="text-sm text-muted-foreground">
              ولّد خطتك الذكية أولاً لاستعراض توزيع الانضباط.
            </p>
            <Link href="/plan">
              <Button className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 mt-2">
                إنشاء خطة
              </Button>
            </Link>
          </div>
        ) : (
          <div>
            <h4 className="text-[11px] font-black uppercase tracking-widest text-muted mb-3">
              الانضباط حسب اليوم
            </h4>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={perDay}
                  margin={{ top: 10, right: 12, left: 12, bottom: 0 }}
                >
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: 700 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
                    contentStyle={{
                      background: "rgba(10,10,10,0.92)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 12,
                      backdropFilter: "blur(8px)",
                      padding: "8px 12px",
                      fontSize: 12,
                    }}
                    formatter={(value, name, props) => {
                      const num = typeof value === "number" ? value : Number(value);
                      const p = props?.payload as
                        | { done?: number; total?: number }
                        | undefined;
                      return [
                        `${num.toFixed(0)}%${p ? ` · ${p.done}/${p.total} مهام` : ""}`,
                        "الإنجاز",
                      ];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="pct"
                    stroke="hsl(245, 78%, 62%)"
                    strokeWidth={3}
                    dot={{ r: 4, fill: "hsl(245, 78%, 62%)", strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: "#fff", stroke: "hsl(245, 78%, 62%)", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Per-day breakdown table */}
            <div className="mt-4 space-y-1.5">
              {perDay.map((d) => (
                <div
                  key={d.day}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-foreground/5 border border-foreground/10"
                >
                  <span className="text-[12px] font-bold w-20">{d.day}</span>
                  <div className="flex-1 h-2 rounded-full bg-foreground/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-uqu-accent to-cyan-400"
                      style={{ width: `${d.pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-muted w-16 text-left">
                    {d.done}/{d.total} · {d.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted leading-relaxed pt-1 border-t border-foreground/10">
          ملاحظة: التتبع التاريخي عبر الفصول الدراسية سيُتاح في إصدار قادم — حالياً
          نعرض توزيع الانضباط على خطتك الحالية فقط.
        </p>
      </div>
    </DialogContent>
  );
}

// ── Dialog primitives shared by the four drill-downs ─────────────
function DialogStat({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent: "emerald" | "sky" | "amber" | "rose" | "uqu" | "muted";
  mono?: boolean;
}) {
  const tone = {
    emerald: "bg-emerald-500/10 border-emerald-500/25 text-emerald-300",
    sky: "bg-sky-500/10 border-sky-500/25 text-sky-300",
    amber: "bg-amber-500/10 border-amber-500/25 text-amber-300",
    rose: "bg-rose-500/10 border-rose-500/25 text-rose-300",
    uqu: "bg-uqu-accent/10 border-uqu-accent/25 text-uqu-accent",
    muted: "bg-foreground/5 border-foreground/10 text-foreground",
  }[accent];
  return (
    <div className={cn("p-3 rounded-xl border text-center", tone)}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80 mb-1">
        {label}
      </div>
      <div className={cn("text-xl font-black", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function triggerLabel(t: AgenticAction["trigger"]): string {
  switch (t) {
    case "low_gpa":
      return "هبوط في المعدل";
    case "skill_gap":
      return "فجوة مهارية";
    case "combined":
      return "تدخّل مزدوج";
    default:
      return "—";
  }
}

function severityLabel(s: AgenticAction["severity"]): string {
  return s === "high" ? "عالية" : s === "medium" ? "متوسطة" : "منخفضة";
}

function severityToAccent(
  s: AgenticAction["severity"],
): "emerald" | "amber" | "rose" {
  return s === "high" ? "rose" : s === "medium" ? "amber" : "emerald";
}

// ──────────────────────────────────────────────────────────────────
// Target GPA inline editor (Task 4 + Sprint-2 Task 1: max-possible validation)
// ──────────────────────────────────────────────────────────────────
//
// Lives INSIDE the Target GPA card's existing analytics dialog —
// replaces the old "تعديل الهدف" button that used to route the user
// away to /profile. Updates `useProfileStore.goals.targetGpa`
// directly; the parent dashboard's analytics fetch effect re-runs as
// soon as the value changes, so the math/banner refresh in place.
//
// Sprint 2 — Bug #5 fix:
// The user (especially seniors with high earned_hours and a mid-tier
// current GPA) can no longer set a target that is mathematically
// unreachable. We compute the absolute ceiling assuming every single
// remaining credit is scored at A+ (4.00):
//
//   max_possible = (current_points + remaining_hours × 4.0)
//                / (earned_hours + remaining_hours)
//
// `remaining_hours` comes from the profile's `totalPlanHours`. When
// the user hasn't filled their plan length we fall back to 160 — the
// number you specified, intentionally generous so we don't trap the
// user on a fresh-install profile.
const FALLBACK_TOTAL_DEGREE_HOURS = 160;

function TargetGpaEditDialog({ targetGpa }: { targetGpa: number }) {
  const setGoals = useProfileStore((s) => s.setGoals);
  const totalPlanHours = useProfileStore((s) => {
    const v = s.basic.totalPlanHours;
    return typeof v === "number" && v > 0 ? v : 0;
  });
  const profileCurrentGpa = useProfileStore((s) => s.goals.currentGpa) ?? 0;
  const transcriptGpa = useTranscriptStore((s) => s.gpa);
  const transcriptEarned = useTranscriptStore((s) => s.earnedHours);
  const completedCourses = useTranscriptStore((s) => s.completedCourses);

  // Same source-of-truth resolution as the dashboard's main fetch effect.
  const currentGpa = transcriptGpa ?? profileCurrentGpa ?? 0;
  const earnedHours = useMemo(
    () =>
      transcriptEarned ??
      completedCourses.reduce((sum, c) => sum + (c.creditHours ?? 0), 0),
    [transcriptEarned, completedCourses],
  );

  // Max-possible GPA computation. Three regimes:
  //   1. earned_hours + remaining > 0 → standard formula
  //   2. earned_hours > 0, remaining = 0 (already at plan ceiling) →
  //      max is whatever the student already has
  //   3. earned_hours = 0 (fresh student) → max is the universal 4.00
  const maxPossible = useMemo(() => {
    const totalDegreeHours =
      totalPlanHours > 0 ? totalPlanHours : FALLBACK_TOTAL_DEGREE_HOURS;
    const remainingHours = Math.max(0, totalDegreeHours - earnedHours);
    if (earnedHours <= 0) return 4.0;
    if (remainingHours <= 0) return Math.min(4, currentGpa);
    const currentPoints = currentGpa * earnedHours;
    const raw =
      (currentPoints + remainingHours * 4.0) /
      (earnedHours + remainingHours);
    // Round DOWN to 2 decimals so we never advertise a target the user
    // can't actually hit by 0.001 of a point.
    return Math.min(4, Math.floor(raw * 100) / 100);
  }, [currentGpa, earnedHours, totalPlanHours]);

  const [draft, setDraft] = useState<string>(
    targetGpa > 0 ? targetGpa.toFixed(2) : "",
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-sync the input whenever the underlying target changes (e.g., the
  // chat agent fired an UPDATE_TARGET_GPA action while this dialog was
  // mounted) so the field never shows stale data.
  useEffect(() => {
    setDraft(targetGpa > 0 ? targetGpa.toFixed(2) : "");
  }, [targetGpa]);

  const parsed = parseFloat(draft);
  const inRange =
    !Number.isNaN(parsed) && parsed >= 0 && parsed <= 4 && parsed !== targetGpa;
  const exceedsMax = !Number.isNaN(parsed) && parsed > maxPossible;
  const belowZero = !Number.isNaN(parsed) && parsed < 0;
  const isValid = inRange && !exceedsMax;

  const handleSave = () => {
    if (!isValid) return;
    // Hard-clamp to both the UQU scale (0–4) AND the per-student max.
    // Belt + braces against any input that snuck past the validators.
    const next = Math.max(0, Math.min(maxPossible, parsed));
    setGoals({ targetGpa: Number(next.toFixed(2)) });
    setSavedAt(Date.now());
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <label
          htmlFor="target-gpa-input"
          className="text-[11px] font-black uppercase tracking-widest text-muted"
        >
          تعديل الهدف
        </label>
        <span className="text-[10px] font-mono text-muted">
          الحد الأقصى الممكن: {maxPossible.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="target-gpa-input"
          type="number"
          inputMode="decimal"
          min={0}
          max={maxPossible}
          step={0.05}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder={`0.00 – ${maxPossible.toFixed(2)}`}
          className="flex-1 bg-foreground/5 border border-foreground/10 rounded-xl px-3 py-2.5 text-sm font-mono font-black text-foreground outline-none focus:border-uqu-accent/50 focus:ring-1 focus:ring-uqu-accent/30 transition-all"
        />
        <Button
          onClick={handleSave}
          disabled={!isValid}
          className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          حفظ
        </Button>
      </div>

      {/* Validation messages — ordered by severity. The amber "max possible"
          warning is the headline fix for Bug #5. */}
      {exceedsMax && (
        <p className="text-[11px] text-amber-300 font-bold flex items-center gap-1.5 leading-relaxed">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          أقصى معدل ممكن رياضياً هو{" "}
          <span className="font-mono font-black">{maxPossible.toFixed(2)}</span>
          <span className="text-amber-300/70 font-normal">
            (بافتراض A+ في كل ساعة متبقية)
          </span>
        </p>
      )}
      {belowZero && (
        <p className="text-[11px] text-rose-300 font-bold">
          القيمة لا يمكن أن تكون سالبة.
        </p>
      )}
      {savedAt && parsed === targetGpa && (
        <p className="text-[11px] text-emerald-300 font-bold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          تم تحديث الهدف إلى {targetGpa.toFixed(2)}
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Reused sub-components (KPI cards / Dialogs)
// ──────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  subtitle,
  footer,
  icon,
  color,
  delay,
  sparkline,
  extraSubtext,
}: {
  title: string;
  value: string;
  subtitle: string;
  footer: string;
  icon: React.ReactNode;
  color: "emerald" | "uqu" | "cyan" | "rose";
  delay?: string;
  /** Optional predictive-GPA topography rendered between value and footer. */
  sparkline?: {
    data: { i: number; v: number }[];
    direction: "up" | "down" | "flat";
  };
  /** Sprint-4 Bug #7: subtle second-line muted text rendered below the
   *  primary subtitle (e.g., "Expected GPA based on trajectory: X.XX"
   *  on the Target GPA card). Optional so other cards stay unchanged. */
  extraSubtext?: string;
}) {
  const colorMap = {
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
    uqu: "bg-uqu-accent/10 border-uqu-accent/20 text-uqu-accent",
    cyan: "bg-cyan-500/10 border-cyan-500/20 text-cyan-500",
    rose: "bg-rose-500/10 border-rose-500/20 text-rose-500",
  } as const;

  const textColors = {
    emerald: "text-emerald-500",
    uqu: "text-uqu-accent",
    cyan: "text-cyan-500",
    rose: "text-rose-500",
  } as const;

  return (
    <Card
      className={cn(
        // h-full + flex column ensures every card in the top row pulls
        // to the same grid-cell height regardless of which one carries
        // the sparkline. The sparkline itself is taken out of flow
        // below (absolute) so it can't push the card taller.
        "glass p-6 rounded-[28px] border-foreground/10 hover:border-foreground/10 transition-all group animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both",
        "relative overflow-hidden h-full flex flex-col",
        delay,
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border", colorMap[color])}>
          {icon}
        </div>
      </div>
      <div className="space-y-1">
        <div className={cn("text-4xl font-black tracking-tighter", textColors[color])}>{value}</div>
        <div className="text-[10px] font-bold text-muted-foreground">{subtitle}</div>
        {extraSubtext && (
          <div className="text-[10px] font-medium text-muted leading-relaxed pt-0.5">
            {extraSubtext}
          </div>
        )}
      </div>
      {/* Footer pushed to the bottom of the flex column. The sparkline
          slips BEHIND it (absolute, lower z-index, low opacity) so it
          reads as ambient texture, never as a height contributor. */}
      <div className="mt-auto pt-4 border-t border-foreground/10 text-[10px] text-muted-foreground font-medium relative z-10">
        {footer}
      </div>
      {sparkline && sparkline.data.length >= 2 && (
        <PredictiveGpaSparkline
          data={sparkline.data}
          direction={sparkline.direction}
        />
      )}
    </Card>
  );
}

/**
 * Predictive GPA Topography — a thin, axis-less area chart inside the
 * Current GPA card. Green stroke + fill when the most recent term-over-
 * term delta is positive ("resilience vector up"), orange when negative.
 * Flat (within ±0.01) defaults to a muted accent.
 */
function PredictiveGpaSparkline({
  data,
  direction,
}: {
  data: { i: number; v: number }[];
  direction: "up" | "down" | "flat";
}) {
  const stroke =
    direction === "up"
      ? "hsl(160, 80%, 50%)"
      : direction === "down"
        ? "hsl(28, 92%, 55%)"
        : "hsl(220, 12%, 60%)";
  const gradientId =
    direction === "up"
      ? "sparkUp"
      : direction === "down"
        ? "sparkDown"
        : "sparkFlat";

  // Ensure the area never bottoms out at 0 — looks better when the
  // band hugs the actual data range. Recharts auto-domains by default
  // but we pin a tiny floor below min so a steady trajectory still
  // shows a sliver of fill.
  const vs = data.map((d) => d.v);
  const minV = Math.min(...vs);
  const maxV = Math.max(...vs);
  const yMin = Math.max(0, minV - 0.15);
  const yMax = Math.min(4, maxV + 0.15);

  return (
    <div
      // Absolutely positioned at the card's bottom edge so it never
      // contributes to layout height — guarantees the three top-row
      // KPI cards remain perfectly uniform whether or not this card
      // owns a sparkline. opacity-50 + pointer-events-none keep it
      // visually ambient and never intercept clicks meant for the card.
      className="absolute bottom-0 left-0 right-0 h-[40px] opacity-50 pointer-events-none z-0"
      aria-label={
        direction === "up"
          ? "اتجاه المعدل: صاعد"
          : direction === "down"
            ? "اتجاه المعدل: هابط"
            : "اتجاه المعدل: مستقر"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.55} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[yMin, yMax]} />
          <XAxis dataKey="i" hide />
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            fillOpacity={1}
            isAnimationActive
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function KvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-3 rounded-xl bg-foreground/5 border border-foreground/10 flex justify-between items-center">
      <span className="text-muted-foreground text-sm font-bold">{label}:</span>
      <span className={cn("font-bold", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function KvTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "muted" | "uqu";
}) {
  const tone =
    accent === "uqu"
      ? "bg-uqu-accent/10 border-uqu-accent/20 text-uqu-accent"
      : "bg-foreground/5 border-foreground/10 text-foreground";
  return (
    <div className={cn("p-3 rounded-xl border", tone)}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-black font-mono">{value}</div>
    </div>
  );
}

function TargetGpaCallout({
  status,
  required,
  targetGpa,
  nextHours,
}: {
  status: "achieved" | "feasible" | "stretch" | "impossible" | "unknown";
  required: number;
  targetGpa: number;
  nextHours: number;
}) {
  if (status === "unknown") {
    return (
      <div className="p-4 rounded-xl bg-foreground/5 border border-foreground/10 text-sm text-muted">
        حدّد هدفاً وارفع سجلك الأكاديمي حتى نستطيع حساب المطلوب.
      </div>
    );
  }

  if (status === "achieved") {
    return (
      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm leading-relaxed">
        🎉 وصلت لهدفك بالفعل! حافظ على مستواك الحالي في الفصل القادم.
      </div>
    );
  }

  if (status === "impossible") {
    return (
      <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm leading-relaxed">
        ⚠️ المطلوب{" "}
        <strong className="font-black font-mono">{required.toFixed(2)}</strong> وهو فوق سقف الـ
        4.00. غيّر الهدف لقيمة قابلة للتحقيق، أو تابع التقدم على فصلين أو أكثر.
      </div>
    );
  }

  const accent =
    status === "stretch"
      ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
      : "bg-uqu-accent/10 border-uqu-accent/30 text-foreground";

  return (
    <div className={cn("p-4 rounded-xl border text-sm leading-relaxed", accent)}>
      للوصول لهدفك{" "}
      <strong className="font-black font-mono">{targetGpa.toFixed(2)}</strong>، تحتاج إلى تحقيق
      معدل{" "}
      <strong className="font-black font-mono text-base">{required.toFixed(2)}</strong> في الـ{" "}
      {nextHours} ساعة القادمة.
    </div>
  );
}

function DegreeProgressRing({ earned, total }: { earned: number; total: number }) {
  const pct = total > 0 ? Math.min(1, earned / total) : 0;
  const radius = 64;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <div className="relative w-[160px] h-[160px]">
        <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90">
          <defs>
            <linearGradient id="ringGlow" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(187, 80%, 48%)" />
              <stop offset="100%" stopColor="hsl(245, 78%, 62%)" />
            </linearGradient>
          </defs>
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={stroke}
          />
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="url(#ringGlow)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{
              transition: "stroke-dashoffset 600ms ease-out",
              filter: "drop-shadow(0 0 8px hsla(187,80%,48%,0.4))",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-black font-mono">{Math.round(pct * 100)}%</div>
          <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">
            من الخطة
          </div>
        </div>
      </div>
      <div className="text-[11px] text-muted text-center">
        <span className="font-mono font-bold text-foreground">{earned}</span>
        {total > 0 && (
          <>
            {" "}
            <span className="text-muted">/</span>{" "}
            <span className="font-mono">{total}</span>{" "}
          </>
        )}
        ساعة
      </div>
      {total === 0 && (
        <p className="text-[10px] text-amber-400/70 text-center leading-tight px-2">
          أدخل عدد ساعات الخطة من البروفايل لمعرفة النسبة.
        </p>
      )}
    </div>
  );
}

function RecentCourseRow({ course }: { course: EnrichedCourse }) {
  const grade = course.grade || "—";
  const tone = gradeTone(grade);
  return (
    <div className="flex items-center gap-2.5 p-2 rounded-lg bg-foreground/5 border border-foreground/10">
      {/* PRIMARY: credit hours — big, monospaced, glowing accent tile. */}
      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/25 flex flex-col items-center justify-center shrink-0">
        <span className="text-[15px] font-black font-mono text-cyan-300 leading-none">
          {course.creditHours}
        </span>
        <span className="text-[8px] font-bold text-cyan-300/60 mt-0.5">
          ساعة
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold truncate">
          {course.nameAr || course.nameEn || course.code}
        </div>
        <div className="text-[10px] text-muted font-mono">
          {course.code}
        </div>
      </div>
      {/* SECONDARY: grade — smaller, lower contrast, no border. */}
      <div
        className={cn(
          "px-1.5 py-0.5 rounded text-[10px] font-bold font-mono shrink-0 opacity-70",
          tone,
        )}
      >
        {grade}
      </div>
    </div>
  );
}

function gradeTone(g: string): string {
  if (g === "A+" || g === "A") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (g === "B+" || g === "B") return "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
  if (g === "C+" || g === "C") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (g === "D+" || g === "D") return "bg-orange-500/15 text-orange-300 border-orange-500/30";
  if (g === "F" || g === "DN") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  return "bg-foreground/5 text-muted border-foreground/10";
}

function ChartSkeleton() {
  return (
    <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-foreground/10 rounded-2xl p-8 text-center gap-3 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-foreground/5" />
      <div className="h-2.5 w-40 rounded-full bg-foreground/5" />
      <div className="h-2 w-28 rounded-full bg-foreground/5" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// مكونات كارد التقويم الأكاديمي
// ──────────────────────────────────────────────────────────────────

function AcademicCalendarCard() {
  const [todayStr, setTodayStr] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);

  useEffect(() => {
    const today = new Date();
    
    // تنسيق تاريخ اليوم للعرض
    setTodayStr(
      new Intl.DateTimeFormat('ar-SA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(today)
    );

    const getEndDate = (dateStr: string) => {
      const parts = dateStr.split("-");
      return new Date(parts[parts.length - 1].trim());
    };

    const allEvents = UQU_CALENDAR.flatMap(term => term.events);
    const startOfToday = new Date(today);
    startOfToday.setHours(0, 0, 0, 0);

    const upcoming = allEvents
      .filter(ev => getEndDate(ev.date) >= startOfToday)
      .sort((a, b) => getEndDate(a.date).getTime() - getEndDate(b.date).getTime())
      .slice(0, 3);
      
    setUpcomingEvents(upcoming);
  }, []);

  return (
    <Card className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-sky-400" />
            التقويم الجامعي
          </h3>
          <p className="text-xs text-sky-300/80 font-medium mt-1">
            اليوم: {todayStr || "يتم التحميل..."}
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-400 border-sky-500/20 px-2.5 py-1 rounded-full">
          الأحداث القادمة
        </Badge>
      </div>

      <div className="space-y-3 flex-1">
        {upcomingEvents.length === 0 ? (
           <div className="flex flex-col items-center justify-center h-[120px] text-muted-foreground text-sm border-2 border-dashed border-foreground/10 rounded-2xl">
             لا توجد أحداث أكاديمية قادمة.
           </div>
        ) : (
          upcomingEvents.map((ev, i) => (
            <div 
              key={i} 
              className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10 flex flex-col gap-2.5 hover:border-sky-500/20 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2" 
              style={{ animationFillMode: "both", animationDelay: `${i * 100}ms` }}
            >
              {/* العنوان ونوع الحدث */}
              <div className="flex items-start justify-between gap-3">
                <span className="text-[13.5px] font-black text-foreground leading-tight">{ev.title}</span>
                <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-md border shrink-0 uppercase tracking-wider", getEventTone(ev.type))}>
                  {ev.type === "holiday" ? "إجازة" : ev.type === "exam" ? "اختبارات" : ev.type === "system" ? "نظام" : "أكاديمي"}
                </span>
              </div>
              
              {/* التواريخ المرتبة والمفصولة بصرياً */}
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px]">
                {/* كبسولة التاريخ الهجري */}
                <span className="inline-flex items-center gap-1.5 bg-black/30 dark:bg-background/40 px-2.5 py-1 rounded-lg text-muted-foreground border border-foreground/5 font-mono">
                  <span className="text-[9px] font-sans font-black text-amber-400/90 bg-amber-400/10 px-1 rounded-sm">هـ</span>
                  <span className="text-foreground/90 font-bold">{ev.hijri}</span>
                </span>

                {/* كبسولة التاريخ الميلادي */}
                <span className="inline-flex items-center gap-1.5 bg-black/30 dark:bg-background/40 px-2.5 py-1 rounded-lg text-muted-foreground border border-foreground/5 font-mono" dir="ltr">
                  <span className="text-foreground/90 font-bold">{ev.date}</span>
                  <span className="text-[9px] font-sans font-black text-sky-400/90 bg-sky-400/10 px-1 rounded-sm">م</span>
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      
      <div className="mt-5 pt-4 border-t border-foreground/10 text-[11px] text-muted-foreground font-medium text-center">
        اضغط لمعاينة التقويم الكامل للفصلين
      </div>
    </Card>
  );
}
function AcademicCalendarDialogContent() {
  return (
    <DialogContent
      className="glass border-foreground/10 bg-card/95 backdrop-blur-2xl rounded-[28px] p-0 sm:max-w-[min(700px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-foreground/10 shrink-0">
        <DialogTitle className="text-xl font-black flex items-center gap-3">
          <CalendarClock className="w-6 h-6 text-sky-400" />
          التقويم الجامعي لعام 1447 / 1448 هـ
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          جميع الأحداث الأكاديمية والأنظمة بناءً على التقويم المعتمد لجامعة أم القرى.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-8 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
        {UQU_CALENDAR.map((termData, termIdx) => (
          <div key={termIdx} className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-foreground/10" />
              <h4 className="text-sm font-black uppercase tracking-widest text-sky-400">
                {termData.term}
              </h4>
              <span className="h-px flex-1 bg-foreground/10" />
            </div>

            <div className="space-y-2">
              {termData.events.map((ev, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 p-3 rounded-xl bg-foreground/5 border border-foreground/10 hover:border-sky-500/30 transition-colors"
                >
                  <div className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[13px] truncate">{ev.title}</div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-muted">
                      <span>{ev.hijri}</span>
                      <span className="text-foreground/30">|</span>
                      <span>{ev.date}</span>
                    </div>
                  </div>
                  <span className={cn("text-[10px] font-black px-2 py-1 rounded-md border shrink-0", getEventTone(ev.type))}>
                     {ev.type === "holiday" ? "إجازة" : ev.type === "exam" ? "اختبارات" : ev.type === "system" ? "النظام" : "أكاديمي"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DialogContent>
  );
}