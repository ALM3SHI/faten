"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  FileText,
  ArrowLeft,
  Loader2,
  BookOpen,
  RefreshCw,
  GraduationCap,
  IdCard,
  Calendar,
  TrendingUp,
  TrendingDown,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  parseTranscriptPDF,
  type ParsedTranscript,
  type EnrichedCourse,
} from "@/lib/transcript-parser";
import { useTranscriptStore } from "@/store/transcriptStore";
import { FAILING_GRADES, STRONG_GRADES, WEAK_GRADES } from "@/lib/grade-scale";
import { assessRecord } from "@/lib/record-status";
import { resolvePlanHours } from "@/lib/graduation";
import { useProfileStore } from "@/store/profileStore";
import { RecordStatusNote } from "@/components/record-status-note";

interface Step1Props {
  // Passing `null` for `parsed` signals: "use the transcript already in
  // the store, don't overwrite it". SetupWizard's handleFinalCommit
  // guards on `if (transcriptRaw) setTranscript(transcriptRaw)`, so a
  // null here just means "skip the re-commit".
  onConfirm: (parsed: ParsedTranscript | null, currentCourses: EnrichedCourse[]) => void;
}

type State =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "review"; parsed: ParsedTranscript; currentCourses: EnrichedCourse[] }
  | { kind: "error"; message: string };

/**
 * Step 1 — Academic transcript.
 *
 *   • If the transcript store is already populated (returning user clicking
 *     "View / Edit"), render a Summary View with the previously parsed
 *     identity, stats, strengths, weaknesses, and recommendations. The
 *     user can either continue to Step 2 with the existing data or opt
 *     to re-upload from scratch.
 *
 *   • If the store is empty (first-time setup) OR the user explicitly
 *     chose to re-upload, render the PDF upload UI. The local pdfjs
 *     parser extracts the transcript geometrically — no API call.
 *
 * On Step 2 transition, `onConfirm(parsed | null, currentCourses)` is
 * called. Passing `null` for `parsed` tells the wizard not to overwrite
 * the already-committed transcript at final commit time.
 */
export function Step1Transcript({ onConfirm }: Step1Props) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  // When the store already has a transcript, we land on the summary
  // view by default. `reupload=true` switches to the upload UI so the
  // user can replace it.
  const [reupload, setReupload] = useState(false);

  // ── Read existing transcript from the store ────────────────────────
  const storedLastUpdated = useTranscriptStore((s) => s.lastUpdated);
  const storedName = useTranscriptStore((s) => s.name || s.nameEn);
  const storedStudentId = useTranscriptStore((s) => s.studentId);
  const storedMajor = useTranscriptStore((s) => s.major);
  const storedFaculty = useTranscriptStore((s) => s.faculty);
  const storedGpa = useTranscriptStore((s) => s.gpa);
  const storedEarned = useTranscriptStore((s) => s.earnedHours);
  const storedPlan = useTranscriptStore((s) => s.planHours);
  const storedConfidence = useTranscriptStore((s) => s.confidence);
  const storedCompleted = useTranscriptStore((s) => s.completedCourses);
  const storedCurrent = useTranscriptStore((s) => s.currentCourses);

  const hasStoredTranscript = storedLastUpdated !== null && storedCompleted.length > 0;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) setFile(picked);
  };

  const run = async () => {
    if (!file) return;
    setState({ kind: "parsing" });
    try {
      const parsed = await parseTranscriptPDF(file);

      // "Current Semester Courses" = registered but not yet graded.
      // The pdfjs parser already classifies semesters; we just take
      // the registeredCourses list. As a defensive fallback, also
      // accept any course whose grade is null/empty.
      const current = parsed.registeredCourses.length > 0
        ? parsed.registeredCourses
        : parsed.allCourses.filter((c) => !c.grade);

      // Every record is accepted: a fully graded one (between terms, or a
      // graduate) simply has no current courses — the review explains it.
      setState({ kind: "review", parsed, currentCourses: current });
    } catch (err) {
      const error = err as Error;
      setState({
        kind: "error",
        message: error.message || "تعذّر تحليل ملف السجل الأكاديمي.",
      });
    }
  };

  // ── Render: Summary view (stored transcript, not re-uploading) ─────
  if (hasStoredTranscript && !reupload && state.kind !== "review") {
    return (
      <SummaryView
        name={storedName}
        studentId={storedStudentId}
        major={storedMajor}
        faculty={storedFaculty}
        gpa={storedGpa}
        earnedHours={storedEarned}
        planHours={storedPlan}
        confidence={storedConfidence}
        completedCourses={storedCompleted}
        currentCourses={storedCurrent}
        lastUpdated={storedLastUpdated}
        onNext={() => onConfirm(null, storedCurrent)}
        onReupload={() => {
          setReupload(true);
          setFile(null);
          setState({ kind: "idle" });
        }}
      />
    );
  }

  // ── Render: Review view (just parsed a fresh PDF) ──────────────────
  if (state.kind === "review") {
    return (
      <ReviewView
        parsed={state.parsed}
        currentCourses={state.currentCourses}
        onConfirm={(patchedParsed, courses) => onConfirm(patchedParsed, courses)}
        onReset={() => {
          setFile(null);
          setState({ kind: "idle" });
        }}
      />
    );
  }

  // ── Render: Upload view (idle / parsing / error) ───────────────────
  return (
    <div className="space-y-6">
      <header className="space-y-2 flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h2 className="text-heading font-bold tracking-tight">الخطوة 1 — السجل الأكاديمي</h2>
          <p className="text-small text-ink-muted leading-relaxed">
            ارفع ملف PDF لسجلك الأكاديمي. سنستخرج مواد ترمك الحالي تلقائياً
            (محلياً، بدون أي اتصال بخوادم خارجية).
          </p>
        </div>
        {hasStoredTranscript && reupload && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReupload(false)}
            className="rounded-control border border-line bg-surface shadow-card gap-2"
          >
            <ArrowLeft className="w-4 h-4 rotate-180" />
            عودة للملخص
          </Button>
        )}
      </header>

      {state.kind === "error" && (
        <Card className="p-4 border-danger-line bg-danger-soft text-danger-ink rounded-card text-small">
          {state.message}
        </Card>
      )}

      {state.kind === "parsing" ? (
        <Card className="border border-line bg-surface shadow-card rounded-card p-16 flex flex-col items-center justify-center gap-6">
          <Loader2 className="w-12 h-12 text-info-ink animate-spin" />
          <p className="text-subheading font-bold">جاري تحليل السجل محلياً...</p>
          <p className="text-caption text-ink-muted">يتم استخراج المواد بدقة 100% بدون APIs.</p>
        </Card>
      ) : (
        <Card
          className="border border-line bg-surface shadow-card border-dashed rounded-card p-10 text-center flex flex-col items-center gap-5 hover:border-info-line transition-colors cursor-pointer"
          onClick={() => document.getElementById("wizard-transcript-file")?.click()}
        >
          <div className="w-20 h-20 rounded-card bg-info-soft flex items-center justify-center">
            <Upload className="w-9 h-9 text-info-ink" />
          </div>
          <div>
            <h3 className="text-subheading font-bold mb-1">ارفع السجل الأكاديمي (PDF)</h3>
            <p className="text-caption text-ink-muted">انقر للاختيار أو اسحب الملف هنا</p>
          </div>
          <input
            id="wizard-transcript-file"
            type="file"
            className="hidden"
            accept=".pdf"
            onChange={onPick}
          />
          {file && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-control bg-surface-sunken border border-line">
              <FileText className="w-4 h-4 text-info-ink" />
              <span className="text-small font-medium truncate max-w-[260px]">{file.name}</span>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  run();
                }}
                size="sm"
                className="mr-2 rounded-control bg-brand hover:bg-brand-hover"
              >
                تحليل الآن
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── Summary View ───────────────────────────────────────────────────────

function SummaryView({
  name,
  studentId,
  major,
  faculty,
  gpa,
  earnedHours,
  planHours,
  confidence,
  completedCourses,
  currentCourses,
  lastUpdated,
  onNext,
  onReupload,
}: {
  name: string | null;
  studentId: string | null;
  major: string | null;
  faculty: string | null;
  gpa: number | null;
  earnedHours: number | null;
  planHours: number | null;
  confidence: number;
  completedCourses: EnrichedCourse[];
  currentCourses: EnrichedCourse[];
  lastUpdated: string | null;
  onNext: () => void;
  onReupload: () => void;
}) {
  // ── Derived insights ─────────────────────────────────────────────
  const enrollmentYear = useMemo(() => deriveEnrollmentYear(completedCourses), [completedCourses]);
  // The stored transcript value may be the legacy attempted-hours footer; only a plan the student entered counts.
  const profilePlan = useProfileStore((s) => s.basic.totalPlanHours);
  const resolvedPlan = resolvePlanHours(profilePlan, planHours, earnedHours);
  const strengths = useMemo(() => deriveStrengths(completedCourses), [completedCourses]);
  const weaknesses = useMemo(() => deriveWeaknesses(completedCourses), [completedCourses]);
  const recommendations = useMemo(
    () => deriveRecommendations({ gpa, weaknesses, currentCount: currentCourses.length }),
    [gpa, weaknesses, currentCourses.length],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
      dir="rtl"
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-heading font-bold tracking-tight">السجل الأكاديمي</h2>
            <Badge
              variant="outline"
              className="bg-success-soft text-success-ink border-success-line text-caption"
            >
              <ShieldCheck className="w-3 h-3 ml-1" />
              محفوظ
            </Badge>
          </div>
          <p className="text-small text-ink-muted">
            بياناتك محفوظة من رفع سابق
            {lastUpdated && (
              <span className="text-ink-muted mr-1">
                · آخر تحديث {new Date(lastUpdated).toLocaleDateString("ar-SA")}
              </span>
            )}
            {confidence > 0 && (
              <span className="text-ink-muted mr-1">· دقة {confidence}%</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onReupload}
          className="rounded-control border border-line bg-surface shadow-card gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          إعادة رفع السجل 🔄
        </Button>
      </header>

      {/* Basic Info */}
      <Card className="border border-line bg-surface shadow-card rounded-card p-5 space-y-4">
        <SectionTitle icon={<IdCard className="w-4 h-4" />} title="البيانات الأساسية" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InfoTile label="الاسم" value={name || "—"} />
          <InfoTile label="الرقم الجامعي" value={studentId || "—"} mono />
          <InfoTile
            label="سنة الالتحاق"
            value={enrollmentYear ? String(enrollmentYear) : "—"}
            icon={<Calendar className="w-3 h-3" />}
          />
          <InfoTile label="التخصص" value={major || faculty || "—"} />
        </div>
      </Card>

      {/* Academic Stats */}
      <Card className="border border-line bg-surface shadow-card rounded-card p-5 space-y-4">
        <SectionTitle icon={<GraduationCap className="w-4 h-4" />} title="المؤشرات الأكاديمية" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="المعدل" value={gpa != null ? gpa.toFixed(2) : "—"} accent="emerald" />
          <StatTile
            label="الساعات المكتسبة"
            value={earnedHours != null ? `${earnedHours}` : "—"}
            accent="cyan"
          />
          <StatTile
            label="ساعات الخطة"
            value={resolvedPlan != null ? `${resolvedPlan}` : "—"}
            accent="cyan"
          />
          <StatTile label="مواد منجزة" value={String(completedCourses.length)} accent="violet" />
        </div>
      </Card>

      {/* Insights row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InsightCard
          icon={<TrendingUp className="w-4 h-4" />}
          title="نقاط القوة"
          accent="emerald"
          empty="ستظهر هنا أعلى تقديراتك بعد إنجاز مواد بدرجة A أو A+."
          items={strengths.map((c) => ({
            label: c.nameAr || c.nameEn || c.code,
            sub: `${c.code} · ${c.grade}`,
          }))}
        />
        <InsightCard
          icon={<TrendingDown className="w-4 h-4" />}
          title="نقاط تحتاج تركيز"
          accent="rose"
          empty="رائع — لا توجد مواد بدرجات منخفضة. حافظ على المستوى."
          items={weaknesses.map((c) => ({
            label: c.nameAr || c.nameEn || c.code,
            sub: `${c.code} · ${c.grade}`,
          }))}
        />
      </div>

      {/* Recommendations */}
      <Card className="border shadow-card border-warning-line bg-warning-soft rounded-card p-5 space-y-3">
        <SectionTitle
          icon={<Lightbulb className="w-4 h-4 text-warning-ink" />}
          title="توصيات سريعة"
        />
        <ul className="space-y-2">
          {recommendations.map((r, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-small text-ink leading-relaxed"
            >
              <span className="text-warning-ink mt-1.5 shrink-0">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Current semester */}
      <Card className="border border-line bg-surface shadow-card rounded-card p-5 space-y-4">
        <SectionTitle
          icon={<BookOpen className="w-4 h-4" />}
          title={`مواد الترم الحالي · ${currentCourses.length}`}
        />
        {currentCourses.length === 0 ? (
          <RecordStatusNote
            assessment={assessRecord({ completedCourses, registeredCourses: currentCourses, earnedHours, planHours: resolvedPlan })}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {currentCourses.map((c) => (
              <CourseChip key={`${c.code}-${c.semester}`} course={c} />
            ))}
          </div>
        )}
      </Card>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
        <Button
          variant="ghost"
          onClick={onReupload}
          className="rounded-control text-ink-muted hover:text-ink gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          إعادة رفع السجل
        </Button>
        <Button
          onClick={onNext}
          className={cn(
            "rounded-card bg-brand hover:bg-brand-hover gap-2 px-6 py-6 text-body font-bold mr-auto",
            " disabled:opacity-50 disabled:shadow-none",
          )}
        >
          {currentCourses.length > 0 ? "التالي: الجدول الدراسي" : "التالي"}
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>
    </motion.div>
  );
}

// ── Review View (fresh upload) ─────────────────────────────────────────

function ReviewView({
  parsed,
  currentCourses,
  onConfirm,
  onReset,
}: {
  parsed: ParsedTranscript;
  currentCourses: EnrichedCourse[];
  onConfirm: (parsed: ParsedTranscript, courses: EnrichedCourse[]) => void;
  onReset: () => void;
}) {
  const [editedCourses, setEditedCourses] = useState<EnrichedCourse[]>(() => currentCourses);
  const assessment = useMemo(() => assessRecord(parsed), [parsed]);
  const hasCurrent = currentCourses.length > 0;

  const setCourseHours = (code: string, creditHours: number) => {
    setEditedCourses((prev) =>
      prev.map((c) => (c.code === code ? applyCreditHours(c, creditHours) : c)),
    );
  };

  const handleConfirm = () => {
    onConfirm(patchParsedTranscriptCredits(parsed, editedCourses), editedCourses);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
      dir="rtl"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-heading font-bold tracking-tight mb-1">{hasCurrent ? "مواد الترم الحالي" : "السجل الأكاديمي"}</h2>
          <p className="text-small text-ink-muted">
            {hasCurrent ? (
              <>
                تم استخراج <strong className="text-success-ink">{currentCourses.length}</strong> مادة
                من السجل (دقة {parsed.confidence}%). راجعها وأكّدها للمتابعة.
              </>
            ) : (
              <>
                تم استخراج <strong className="text-success-ink">{parsed.completedCourses.length}</strong> مادة
                مرصودة من السجل (دقة {parsed.confidence}%).
              </>
            )}
          </p>
          {hasCurrent && (
            <p className="text-caption text-ink-muted leading-relaxed mt-2 max-w-xl">
              قد تظهر ساعات مواد الترم الحالي بصفر لأنها لا تُحتسب في السجل إلا بعد رصد الدرجة. يمكنك
              تعديلها يدويًا قبل المتابعة.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          onClick={onReset}
          className="rounded-control border border-line bg-surface shadow-card gap-2"
          size="sm"
        >
          <ArrowLeft className="w-4 h-4 rotate-180" />
          رفع ملف آخر
        </Button>
      </header>

      <RecordStatusNote assessment={assessment} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {editedCourses.map((c, i) => (
          <EditableCourseChip
            key={`${c.code}-${i}`}
            course={c}
            onHoursChange={(hours) => setCourseHours(c.code, hours)}
          />
        ))}
      </div>

      <div className="flex items-center justify-end pt-2">
        <Button
          onClick={handleConfirm}
          className={cn(
            "rounded-card bg-brand hover:bg-brand-hover gap-2 px-6 py-6 text-body font-bold",
            "",
          )}
        >
          {hasCurrent ? "تأكيد والمتابعة لإعداد الجدول" : "تأكيد وحفظ السجل"}
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>
    </motion.div>
  );
}

// ── Building blocks ────────────────────────────────────────────────────

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-control bg-surface-sunken flex items-center justify-center text-ink-muted">
        {icon}
      </div>
      <h3 className="text-body font-bold">{title}</h3>
    </div>
  );
}

function InfoTile({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-control bg-surface-sunken border border-line">
      <div className="text-caption font-bold uppercase tracking-wider text-ink-muted mb-1 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "text-small font-bold text-ink truncate",
          mono && "font-mono",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "emerald" | "cyan" | "violet";
}) {
  const tone = {
    emerald:
      "bg-success-soft border-success-line text-success-ink",
    cyan:
      "bg-info-soft border-info-line text-info-ink",
    violet:
      "bg-info-soft border-info-line text-info-ink",
  }[accent];
  return (
    <div className={cn("p-3 rounded-control border", tone)}>
      <div className="text-caption font-bold uppercase tracking-wider opacity-70 mb-1">
        {label}
      </div>
      <div className="text-heading font-bold font-mono">{value}</div>
    </div>
  );
}

function InsightCard({
  icon,
  title,
  accent,
  items,
  empty,
}: {
  icon: React.ReactNode;
  title: string;
  accent: "emerald" | "rose";
  items: { label: string; sub: string }[];
  empty: string;
}) {
  const tone = {
    emerald: {
      ring: "border-success-line bg-success-soft ",
      chip:
        "bg-success-soft border-success-line text-success-ink",
      icon:
        "text-success-ink bg-success-soft border border-success-line",
    },
    rose: {
      ring: "border-danger-line bg-danger-soft ",
      chip:
        "bg-danger-soft border-danger-line text-danger-ink",
      icon:
        "text-danger-ink bg-danger-soft border border-danger-line",
    },
  }[accent];

  return (
    <Card className={cn("rounded-card p-5 space-y-3 border", tone.ring)}>
      <div className="flex items-center gap-2">
        <div className={cn("w-7 h-7 rounded-control flex items-center justify-center", tone.icon)}>
          {icon}
        </div>
        <h3 className="text-body font-bold">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-caption text-ink-muted leading-relaxed">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-control border text-small font-bold",
                tone.chip,
              )}
            >
              <span className="truncate max-w-[160px]">{it.label}</span>
              <span className="font-mono text-caption opacity-70">{it.sub}</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function CourseChip({ course }: { course: EnrichedCourse }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-card bg-surface-sunken border border-line hover:border-line transition-colors">
      <div className="w-10 h-10 rounded-control bg-info-soft border border-info-line flex items-center justify-center shrink-0">
        <BookOpen className="w-4 h-4 text-info-ink" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-small font-bold truncate">
          {course.nameAr || course.nameEn || course.code}
        </div>
        <div className="text-caption text-ink-muted font-mono">{course.code}</div>
      </div>
      <Badge variant="outline" className="bg-surface-sunken text-ink-muted border-line shrink-0">
        {course.creditHours} س
      </Badge>
    </div>
  );
}

function EditableCourseChip({
  course,
  onHoursChange,
}: {
  course: EnrichedCourse;
  onHoursChange: (hours: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-card bg-surface-sunken border border-line hover:border-line transition-colors">
      <div className="w-10 h-10 rounded-control bg-info-soft border border-info-line flex items-center justify-center shrink-0">
        <BookOpen className="w-4 h-4 text-info-ink" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-small font-bold truncate">
          {course.nameAr || course.nameEn || course.code}
        </div>
        <div className="text-caption text-ink-muted font-mono">{course.code}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={6}
          step={1}
          value={course.creditHours}
          onChange={(e) => onHoursChange(clampCreditHours(Number(e.target.value)))}
          className="w-14 h-8 text-center font-mono text-small px-1"
          aria-label={`ساعات ${course.code}`}
        />
        <span className="text-caption text-ink-muted font-bold">س</span>
      </div>
    </div>
  );
}

const MIN_COURSE_CREDITS = 0;
const MAX_COURSE_CREDITS = 6;

function clampCreditHours(value: number): number {
  if (!Number.isFinite(value)) return MIN_COURSE_CREDITS;
  return Math.min(MAX_COURSE_CREDITS, Math.max(MIN_COURSE_CREDITS, Math.round(value)));
}

function applyCreditHours(course: EnrichedCourse, creditHours: number): EnrichedCourse {
  const hours = clampCreditHours(creditHours);
  return {
    ...course,
    creditHours: hours,
    difficulty: hours >= 4 ? "hard" : hours <= 2 ? "easy" : "medium",
  };
}

function patchParsedTranscriptCredits(
  parsed: ParsedTranscript,
  edited: EnrichedCourse[],
): ParsedTranscript {
  const hoursByCode = new Map(edited.map((c) => [c.code, c.creditHours]));

  const patchCourse = (c: EnrichedCourse): EnrichedCourse => {
    const hours = hoursByCode.get(c.code);
    if (hours === undefined) return c;
    return applyCreditHours(c, hours);
  };

  const isInProgress = (c: EnrichedCourse) =>
    hoursByCode.has(c.code) && !(c.grade ?? "").trim();

  return {
    ...parsed,
    registeredCourses: parsed.registeredCourses.map(patchCourse),
    currentSemesterCourses: parsed.currentSemesterCourses.map(patchCourse),
    allCourses: parsed.allCourses.map((c) => (isInProgress(c) ? patchCourse(c) : c)),
  };
}

// ── Derived-insight helpers ────────────────────────────────────────────

/**
 * Earliest 4-digit year found in any course's `semester` string. Works
 * for both Gregorian (2021) and Hijri (1442) — we just take the
 * numeric minimum, which corresponds to the earliest term either way.
 */
function deriveEnrollmentYear(courses: EnrichedCourse[]): number | null {
  let min: number | null = null;
  for (const c of courses) {
    const matches = (c.semester || "").match(/\d{4}/g);
    if (!matches) continue;
    for (const m of matches) {
      const n = parseInt(m, 10);
      if (Number.isFinite(n) && (min === null || n < min)) min = n;
    }
  }
  return min;
}

function deriveStrengths(courses: EnrichedCourse[]): EnrichedCourse[] {
  return courses
    .filter((c) => c.grade && STRONG_GRADES.has(c.grade))
    .sort((a, b) => (b.gradePoints ?? 0) - (a.gradePoints ?? 0))
    .slice(0, 6);
}

function deriveWeaknesses(courses: EnrichedCourse[]): EnrichedCourse[] {
  return courses
    .filter((c) => c.grade && WEAK_GRADES.has(c.grade))
    .sort((a, b) => (a.gradePoints ?? 0) - (b.gradePoints ?? 0))
    .slice(0, 6);
}

function deriveRecommendations({
  gpa,
  weaknesses,
  currentCount,
}: {
  gpa: number | null;
  weaknesses: EnrichedCourse[];
  currentCount: number;
}): string[] {
  const out: string[] = [];

  const failed = weaknesses.filter((c) => c.grade && FAILING_GRADES.has(c.grade));
  if (failed.length > 0) {
    out.push(
      `لديك ${failed.length} مادة بحاجة إلى إعادة. اجعل أولها في خطة الترم القادم وخصّص لها وقت مذاكرة إضافي.`,
    );
  }

  if (gpa != null) {
    if (gpa < 3.0) {
      out.push(
        "معدلك التراكمي تحت 3.0 — ركّز على المواد الأساسية واطلب الدعم من المرشد الأكاديمي مبكراً.",
      );
    } else if (gpa < 4.0) {
      out.push(
        "أنت على بُعد خطوات من مرتبة الشرف. حسّن مذاكرتك للمواد ذات الساعات العالية لرفع التراكمي.",
      );
    } else {
      out.push(
        "معدلك ممتاز — حافظ على نمط مذاكرتك الحالي وفكّر في مواد إثرائية أو بحث.",
      );
    }
  }

  if (currentCount >= 6) {
    out.push(
      `حملك الدراسي هذا الترم ${currentCount} مواد — وزّع أيامك بحيث لا تتراكم محاضرتان ثقيلتان في نفس اليوم.`,
    );
  } else if (currentCount > 0) {
    out.push(
      "حملك الدراسي معتدل — استغل الوقت الفائض لمراجعة المواد الصعبة بانتظام.",
    );
  }

  out.push("استخدم خطوة الجدول التالية لتهيئة المساعد لإنشاء جلسات بومودورو متوازنة.");

  return out;
}
