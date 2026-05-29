"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  HOURLY_24_SLOTS,
  PLAN_WEEK_DAYS,
  parseLocalDate,
  weekdayNameFromDate,
} from "@/lib/schedule-grid";
import type { EnrichedCourse } from "@/lib/transcript-parser";
import type { PlanPriority, PlanTask, PlanTaskType } from "@/store/planStore";

const CUSTOM_COURSE = "__custom__";

const PRIORITY_OPTIONS: { value: PlanPriority; label: string }[] = [
  { value: "high", label: "عالية" },
  { value: "medium", label: "متوسطة" },
  { value: "low", label: "خفيفة" },
];

const TASK_TYPE_OPTIONS: { value: PlanTaskType; label: string }[] = [
  { value: "study", label: "مذاكرة" },
  { value: "exam", label: "اختبار" },
  { value: "quiz", label: "كويز" },
  { value: "assignment", label: "واجب" },
  { value: "project", label: "مشروع" },
  { value: "other", label: "أخرى" },
];

const TIME_OPTIONS = HOURLY_24_SLOTS.map((s) => s.start);

export interface StudySessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  initialTask?: PlanTask;
  courses: EnrichedCourse[];
  onSubmit: (task: PlanTask) => void;
}

interface SessionFormState {
  title: string;
  /** "" = nothing chosen, CUSTOM_COURSE = custom, else a course code. */
  courseSelect: string;
  customCode: string;
  customName: string;
  /** "" = no day chosen. */
  suggestedDay: string;
  /** "" = no time chosen. */
  suggestedTime: string;
  /** "" = no duration chosen. */
  durationMinutes: string;
  /** "" = no priority chosen. */
  priority: PlanPriority | "";
  reason: string;
  targetDate: string;
  /** "" = no type chosen. */
  taskType: PlanTaskType | "";
}

/** Neutral ADD-mode state — nothing pre-selected so the user fills it intentionally. */
function emptyFormState(): SessionFormState {
  return {
    title: "",
    courseSelect: "",
    customCode: "",
    customName: "",
    suggestedDay: "",
    suggestedTime: "",
    durationMinutes: "",
    priority: "",
    reason: "",
    targetDate: "",
    taskType: "",
  };
}

function courseSelectValue(code: string, courses: EnrichedCourse[]): string {
  if (!code) return CUSTOM_COURSE;
  const match = courses.find((c) => c.code === code);
  return match ? match.code : CUSTOM_COURSE;
}

export function StudySessionDialog({
  open,
  onOpenChange,
  mode,
  initialTask,
  courses,
  onSubmit,
}: StudySessionDialogProps) {
  const [form, setForm] = useState<SessionFormState>(emptyFormState);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFieldError(null);
    if (mode === "edit" && initialTask) {
      // EDIT mode pre-fills the existing task exactly as before.
      setForm({
        title: initialTask.title,
        courseSelect: courseSelectValue(initialTask.courseCode, courses),
        customCode: initialTask.courseCode,
        customName: initialTask.courseName ?? "",
        suggestedDay: initialTask.suggestedDay,
        suggestedTime: initialTask.suggestedTime,
        durationMinutes: String(initialTask.durationMinutes),
        priority: initialTask.priority,
        reason: initialTask.reason ?? "",
        targetDate: initialTask.targetDate ?? "",
        taskType: initialTask.taskType ?? "",
      });
    } else {
      // ADD mode opens fully neutral — no course/day/time/duration prefilled.
      setForm(emptyFormState());
    }
  }, [open, mode, initialTask, courses]);

  const selectedCourse = useMemo(
    () => courses.find((c) => c.code === form.courseSelect),
    [courses, form.courseSelect],
  );

  // When a calendar date is attached, the weekday is derived from it and the
  // manual day selector is locked to that value.
  const derivedDay = useMemo(() => {
    if (!form.targetDate) return null;
    const d = parseLocalDate(form.targetDate);
    return d ? weekdayNameFromDate(d) : null;
  }, [form.targetDate]);
  const hasDate = form.targetDate.trim().length > 0;

  const handleCourseChange = (value: string) => {
    if (value === "" || value === CUSTOM_COURSE) {
      setForm((f) => ({ ...f, courseSelect: value }));
      return;
    }
    const c = courses.find((x) => x.code === value);
    if (c) {
      const name = c.nameAr || c.nameEn || c.name;
      setForm((f) => ({
        ...f,
        courseSelect: value,
        customCode: c.code,
        customName: name,
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    const title = form.title.trim();
    if (!title) {
      setFieldError("أدخل عنوان الجلسة.");
      return;
    }

    if (form.courseSelect === "") {
      setFieldError("اختر المادة من القائمة أو اختر «مادة مخصصة».");
      return;
    }

    const isCustom = form.courseSelect === CUSTOM_COURSE;
    const courseCode = isCustom
      ? form.customCode.trim()
      : (selectedCourse?.code ?? form.customCode.trim());
    if (!courseCode) {
      setFieldError("أدخل رمز المادة المخصصة.");
      return;
    }

    const courseName = isCustom
      ? form.customName.trim() || null
      : selectedCourse
        ? selectedCourse.nameAr || selectedCourse.nameEn || selectedCourse.name
        : form.customName.trim() || null;

    // Day comes from the date when one is attached, otherwise it must be picked.
    const targetDate = form.targetDate.trim() || undefined;
    let suggestedDay = form.suggestedDay;
    if (targetDate) {
      const d = parseLocalDate(targetDate);
      if (!d) {
        setFieldError("التاريخ غير صالح. استخدم تاريخاً صحيحاً.");
        return;
      }
      suggestedDay = weekdayNameFromDate(d);
    } else if (!form.suggestedDay) {
      setFieldError("اختر اليوم أو حدّد تاريخاً للحدث.");
      return;
    }

    if (!form.suggestedTime) {
      setFieldError("اختر وقت البداية.");
      return;
    }

    if (!form.durationMinutes.trim()) {
      setFieldError("اختر مدة الجلسة.");
      return;
    }
    const durationMinutes = Number(form.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setFieldError("مدة الجلسة يجب أن تكون أكبر من صفر.");
      return;
    }

    if (form.priority === "") {
      setFieldError("اختر الأولوية.");
      return;
    }

    const task: PlanTask = {
      title,
      courseCode,
      courseName,
      durationMinutes,
      suggestedDay,
      suggestedTime: form.suggestedTime,
      priority: form.priority,
      reason: form.reason.trim() || "جلسة مذاكرة يدوية",
      // taskType is metadata and can be saved on any session when chosen.
      // Only `targetDate` decides whether this becomes a registered dated
      // event (see isDatedEvent / RegisteredEventsDialog).
      ...(form.taskType ? { taskType: form.taskType } : {}),
      ...(targetDate ? { targetDate } : {}),
    };

    onSubmit(task);
  };

  const fieldClass =
    "h-9 w-full rounded-lg border border-white/10 bg-[#1c1c1c] px-2.5 text-sm text-foreground";
  const selectClass = fieldClass;
  const inputClass = cn(fieldClass, "placeholder:text-muted-foreground");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-lg gap-0 p-0 overflow-hidden rounded-2xl",
          "!bg-[#151515] border border-white/10 shadow-2xl backdrop-blur-xl",
          "[&_[data-slot=dialog-close]]:text-muted-foreground [&_[data-slot=dialog-close]]:hover:text-foreground",
        )}
        dir="rtl"
      >
        <form onSubmit={handleSubmit} className="flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-2 text-right space-y-1">
            <DialogTitle className="text-lg font-bold text-foreground">
              {mode === "add" ? "إضافة جلسة" : "تعديل جلسة"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              حدد اليوم والوقت والمدة — سيتم التحقق من التعارض مع المحاضرات والجلسات الأخرى
              عند الحفظ.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pb-2 space-y-3 max-h-[min(60vh,480px)] overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="study-title">عنوان الجلسة</Label>
              <Input
                id="study-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="مثال: مراجعة الفصل الثاني"
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="study-course">المادة</Label>
              <select
                id="study-course"
                value={form.courseSelect}
                onChange={(e) => handleCourseChange(e.target.value)}
                className={selectClass}
              >
                <option value="" disabled hidden>
                  اختر المادة
                </option>
                {courses.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.nameAr || c.nameEn || c.name}
                  </option>
                ))}
                <option value={CUSTOM_COURSE}>مادة مخصصة</option>
              </select>
            </div>

            {form.courseSelect === CUSTOM_COURSE && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="study-code">رمز المادة</Label>
                  <Input
                    id="study-code"
                    value={form.customCode}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, customCode: e.target.value }))
                    }
                    placeholder="CS101"
                    className={cn(inputClass, "font-mono")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="study-name">اسم المادة (اختياري)</Label>
                  <Input
                    id="study-name"
                    value={form.customName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, customName: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="study-day">اليوم</Label>
                <select
                  id="study-day"
                  value={hasDate ? (derivedDay ?? "") : form.suggestedDay}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, suggestedDay: e.target.value }))
                  }
                  disabled={hasDate}
                  className={cn(selectClass, hasDate && "opacity-60 cursor-not-allowed")}
                >
                  <option value="" disabled hidden>
                    اختر اليوم
                  </option>
                  {PLAN_WEEK_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                {hasDate && (
                  <p className="text-[10px] text-muted-foreground">
                    يُحدد اليوم تلقائياً من التاريخ المختار.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="study-time">وقت البداية</Label>
                <select
                  id="study-time"
                  value={form.suggestedTime}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, suggestedTime: e.target.value }))
                  }
                  className={cn(selectClass, "font-mono")}
                >
                  <option value="" disabled hidden>
                    اختر الوقت
                  </option>
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="study-duration">المدة (دقيقة)</Label>
                <Input
                  id="study-duration"
                  type="number"
                  min={15}
                  max={480}
                  step={5}
                  value={form.durationMinutes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, durationMinutes: e.target.value }))
                  }
                  placeholder="اختر المدة"
                  className={cn(inputClass, "font-mono")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="study-priority">الأولوية</Label>
                <select
                  id="study-priority"
                  value={form.priority}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      priority: e.target.value as PlanPriority | "",
                    }))
                  }
                  className={selectClass}
                >
                  <option value="" disabled hidden>
                    اختر الأولوية
                  </option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="study-date">تاريخ محدد (اختياري)</Label>
                <Input
                  id="study-date"
                  type="date"
                  value={form.targetDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, targetDate: e.target.value }))
                  }
                  className={cn(inputClass, "font-mono [color-scheme:dark]")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="study-type">نوع الحدث</Label>
                <select
                  id="study-type"
                  value={form.taskType}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      taskType: e.target.value as PlanTaskType | "",
                    }))
                  }
                  className={selectClass}
                >
                  <option value="" disabled hidden>
                    اختر نوع الحدث
                  </option>
                  {TASK_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              التاريخ اختياري. عند إضافة تاريخ ستظهر الجلسة ضمن الأحداث المسجلة.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="study-reason">ملاحظات (اختياري)</Label>
              <Input
                id="study-reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="سبب الجلسة أو ملاحظات إضافية"
                className={inputClass}
              />
            </div>

            {fieldError && (
              <p className="text-xs text-rose-400 font-medium">{fieldError}</p>
            )}
          </div>

          <div className="flex flex-row items-center justify-start gap-3 border-t border-white/10 px-6 py-4 mt-1 shrink-0">
            <Button
              type="submit"
              className="h-9 px-4 rounded-xl text-sm font-bold bg-uqu-accent hover:bg-uqu-accent/90 text-foreground shadow-[0_0_16px_-4px_hsla(245,78%,62%,0.5)]"
            >
              {mode === "add" ? "إضافة الجلسة" : "حفظ التعديلات"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 px-4 rounded-xl text-sm font-medium border-white/10 bg-transparent hover:bg-white/5 text-foreground"
              onClick={() => onOpenChange(false)}
            >
              إلغاء
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
