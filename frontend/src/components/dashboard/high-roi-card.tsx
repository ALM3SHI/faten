"use client";

import { Zap } from "lucide-react";
import { PanelRoot } from "@/components/dashboard/panel-root";
import { cn } from "@/lib/utils";
import { HighRoiCourse } from "@/components/dashboard/analytics";

// ──────────────────────────────────────────────────────────────────
// Middle Row — Strengths Radar
// ──────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────
// Bottom Row — High-ROI Courses
// ──────────────────────────────────────────────────────────────────

export function HighRoiCard({
  courses,
  loading,
  hasCurrentTerm,
  bare,
}: {
  courses: HighRoiCourse[];
  loading: boolean;
  hasCurrentTerm: boolean;
  /** Inside the dashboard's tabbed card: no card chrome, title kept for screen readers. */
  bare?: boolean;
}) {
  return (
    <PanelRoot bare={bare} className="border border-line bg-surface shadow-card p-8 rounded-card border-line relative overflow-hidden">
      <div className={cn("flex items-center justify-between flex-wrap gap-3", bare ? "sr-only" : "mb-5")}>
        <div>
          <h3 className="text-heading font-bold mb-1 flex items-center gap-2">
            <Zap className="w-5 h-5 text-warning-ink" />
            روافع المعدل
          </h3>
          <p className="text-small text-ink-muted">
            المواد الحالية الأعلى تأثيراً على معدلك التراكمي.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-20 rounded-card bg-surface-sunken" />
          <div className="h-20 rounded-card bg-surface-sunken" />
        </div>
      ) : courses.length === 0 ? (
        <div className="min-h-[140px] flex flex-col items-center justify-center border-2 border-dashed border-line rounded-card text-center gap-2 p-6">
          <Zap className="w-8 h-8 text-ink-muted" />
          <p className="text-small text-ink-muted">
            {hasCurrentTerm
              ? "لا تتوفر بيانات كافية لحساب الرافعة الآن."
              : "لا توجد مواد مسجّلة في الفصل الحالي. أكمل الإعداد من الملف الشخصي."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {courses.map((c, i) => (
            <RoiRow key={c.code} course={c} rank={i + 1} />
          ))}
          <p className="text-caption text-ink-muted mt-3 leading-relaxed">
            الحساب: <span className="font-mono">credits × 4.00</span> +
            تقدير الرفعة المحتملة على المعدل التراكمي عند الحصول على A+.
            اضغط البطاقة لفتح محاكي السيناريوهات الكامل.
          </p>
        </div>
      )}
    </PanelRoot>
  );
}


function RoiRow({ course, rank }: { course: HighRoiCourse; rank: number }) {
  return (
    <div className="p-4 rounded-card bg-surface-sunken border border-line hover:border-warning-line transition-colors flex items-start gap-4">
      <div
        className={cn(
          "w-10 h-10 rounded-control flex items-center justify-center font-bold text-small shrink-0 border",
          rank === 1
            ? "bg-warning-soft text-warning-ink border-warning-line"
            : "bg-surface-sunken text-ink-muted border-line",
        )}
      >
        #{rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h4 className="text-body font-bold truncate">{course.name}</h4>
          <span className="text-caption font-mono text-ink-muted shrink-0">{course.code}</span>
        </div>
        <p className="text-caption text-ink-muted leading-relaxed mt-1">{course.label}</p>
        <div className="flex items-center gap-4 mt-2 text-caption">
          <span className="text-ink-muted">
            الساعات:{" "}
            <span className="font-mono font-bold text-ink">{course.credits}</span>
          </span>
          <span className="text-ink-muted">
            أقصى مساهمة:{" "}
            <span className="font-mono font-bold text-warning-ink">
              {course.max_point_contribution.toFixed(2)}
            </span>
          </span>
          {course.projected_delta > 0 && (
            <span className="text-ink-muted">
              رفعة محتملة:{" "}
              <span className="font-mono font-bold text-success-ink">
                +{course.projected_delta.toFixed(2)}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
