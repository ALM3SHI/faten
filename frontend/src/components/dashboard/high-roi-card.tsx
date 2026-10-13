"use client";

import { Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
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
            <Zap className="w-5 h-5 text-amber-700 dark:text-amber-400" />
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
              : "لا توجد مواد مسجّلة في الفصل الحالي. أكمل الإعداد من الملف الشخصي."}
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
            ? "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 shadow-[0_0_18px_rgba(245,158,11,0.18)]"
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
            <span className="font-mono font-bold text-amber-800 dark:text-amber-300">
              {course.max_point_contribution.toFixed(2)}
            </span>
          </span>
          {course.projected_delta > 0 && (
            <span className="text-muted">
              رفعة محتملة:{" "}
              <span className="font-mono font-bold text-emerald-800 dark:text-emerald-300">
                +{course.projected_delta.toFixed(2)}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
