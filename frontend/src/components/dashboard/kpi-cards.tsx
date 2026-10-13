"use client";

/**
 * Top row of the dashboard — three KPI cards (current GPA, earned hours,
 * target GPA), each opening a drill-down dialog.
 */

import { useRouter } from "next/navigation";
import { TrendingUp, BookOpen, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EnrichedCourse } from "@/store/transcriptStore";
import type { GraduationProgress } from "@/lib/graduation";

/** "11% · باقي ~7–8 فصول" for the hours tile; the dialog has the full summary. */
function hoursHint(g: GraduationProgress | null): string {
  if (!g) return "حدّد ساعات خطتك من الملف الشخصي";
  if (g.remaining === 0) return "أكملت ساعات خطتك 🎓";
  if (g.graduatesThisTerm) return `${g.percent}% · تتخرج هذا الفصل 🎓`;
  const { min, max } = g.termsLeft;
  // "7 إلى 8" rather than "7–8": a dash between numbers flips in RTL text.
  const terms = min === max ? `${min}` : `${min} إلى ${max}`;
  return `${g.percent}% · باقي ${terms} ${max <= 2 ? "فصل" : "فصول"} تقريباً`;
}
import { StatTile, KvRow, KvTile } from "@/components/dashboard/stat-tiles";
import { RecentCourseRow } from "@/components/dashboard/recent-course-row";
import { GraduationSummary } from "@/components/dashboard/graduation-card";
import { TargetGpaEditDialog, TargetGpaCallout } from "@/components/dashboard/target-gpa";
import type { TargetCalloutStatus } from "@/components/dashboard/analytics";

const TRIGGER = (
  <div role="button" tabIndex={0} className="cursor-pointer text-right w-full h-full block focus:outline-none" />
);
const DIALOG_CLASS =
  "!bg-card border-border text-foreground shadow-2xl backdrop-blur-xl dark:!bg-card/95 dark:border-foreground/10";

export function CurrentGpaKpi({
  hydrated,
  currentGpa,
  earnedHours,
  completedCount,
}: {
  hydrated: boolean;
  currentGpa: number;
  earnedHours: number;
  completedCount: number;
}) {
  const router = useRouter();
  return (
    <Dialog>
      <DialogTrigger nativeButton={false} render={TRIGGER}>
        <StatTile
          title="المعدل"
          value={hydrated ? currentGpa.toFixed(2) : "—"}
          hint="من 4.00"
          icon={<TrendingUp className="w-4 h-4 text-emerald-700 dark:text-emerald-500" />}
          color="emerald"
        />
      </DialogTrigger>
      <DialogContent className={`${DIALOG_CLASS} sm:max-w-md`}>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-700 dark:text-emerald-500" />
            تفاصيل المعدل الحالي
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            بياناتك مستخرجة من السجل الأكاديمي.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3">
          <KvRow label="الساعات المكتسبة" value={`${earnedHours} ساعة`} />
          <KvRow label="المواد المنجزة" value={`${completedCount} مادة`} />
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-400 dark:border-emerald-400/20 flex justify-between items-center">
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
  );
}

export function EarnedHoursKpi({
  hydrated,
  earnedHours,
  graduation,
  recentCourses,
  completedCount,
}: {
  hydrated: boolean;
  earnedHours: number;
  graduation: GraduationProgress | null;
  recentCourses: EnrichedCourse[];
  completedCount: number;
}) {
  return (
    <Dialog>
      <DialogTrigger nativeButton={false} render={TRIGGER}>
        <StatTile
          title="الساعات"
          value={hydrated ? (graduation ? `${earnedHours}/${graduation.planHours}` : String(earnedHours)) : "—"}
          hint={hydrated ? hoursHint(graduation) : undefined}
          icon={<BookOpen className="w-4 h-4 text-cyan-700 dark:text-cyan-500" />}
          color="cyan"
        />
      </DialogTrigger>
      <DialogContent className={`${DIALOG_CLASS} sm:max-w-lg`}>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-cyan-700 dark:text-cyan-500" />
            تقدم الساعات
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            نسبة إنجازك من خطتك الأكاديمية + أحدث المواد المنجزة.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {graduation ? (
            <GraduationSummary p={graduation} />
          ) : (
            <p className="text-[11px] text-amber-800/90 dark:text-amber-400/70 leading-relaxed">
              أدخل عدد ساعات الخطة من الملف الشخصي لمعرفة النسبة.
            </p>
          )}
          <div className="space-y-2 min-w-0">
            <div className="flex items-baseline justify-between text-xs text-muted">
              <span className="font-bold">آخر المواد المنجزة</span>
              <span className="font-mono text-[10px]">
                {recentCourses.length} من {completedCount}
              </span>
            </div>
            <div className="max-h-[260px] overflow-y-auto space-y-1.5 pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded">
              {recentCourses.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  لا توجد مواد منجزة بعد. ارفع السجل الأكاديمي من الملف الشخصي.
                </p>
              ) : (
                recentCourses.map((c, i) => <RecentCourseRow key={`${c.code}-${i}`} course={c} />)
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function targetHint(status: TargetCalloutStatus, required: number, expected: number | null): string {
  if (status === "achieved") return "تجاوزت هدفك 🎯";
  if (status === "impossible") return "صعب الفصل القادم — شوف الخيارات";
  if (status === "feasible" || status === "stretch") return `تحتاج ${required.toFixed(2)} الفصل القادم`;
  return expected != null ? `المتوقع ${expected.toFixed(2)}` : "حدّد هدفك";
}

export function TargetGpaKpi({
  hydrated,
  currentGpa,
  targetGpa,
  expectedGpa,
  status,
  required,
  nextHours,
}: {
  hydrated: boolean;
  currentGpa: number;
  targetGpa: number;
  expectedGpa: number | null;
  status: TargetCalloutStatus;
  required: number;
  nextHours: number;
}) {
  return (
    <Dialog>
      <DialogTrigger nativeButton={false} render={TRIGGER}>
        <StatTile
          title="المستهدف"
          value={hydrated ? targetGpa.toFixed(2) : "—"}
          hint={hydrated ? targetHint(status, required, expectedGpa) : undefined}
          icon={<Target className="w-4 h-4 text-uqu-accent" />}
          color="uqu"
        />      </DialogTrigger>
      <DialogContent className={`${DIALOG_CLASS} sm:max-w-md`}>
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
          <KvRow label="ساعات الفصل القادم" value={`${nextHours} ساعة`} mono />
          <TargetGpaCallout status={status} required={required} targetGpa={targetGpa} nextHours={nextHours} />
          {/* Inline editor so the target can change without leaving the dashboard. */}
          <TargetGpaEditDialog targetGpa={targetGpa} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
