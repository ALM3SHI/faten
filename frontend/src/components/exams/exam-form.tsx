"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEFAULT_EXAM_MINUTES, EXAM_TYPE_LABELS, findConflicts, type Exam, type ExamType } from "@/lib/exams";
import type { ExamInput } from "@/store/examsStore";
import { useTranscriptStore } from "@/store/transcriptStore";

const OTHER = "__other__";
const DURATIONS = [60, 90, 120, 150, 180];

const FIELD = "h-11 rounded-xl bg-background border-border dark:bg-foreground/5 dark:border-foreground/10";

/** Add / edit one exam. Warns before saving when it clashes with another. */
export function ExamFormDialog({
  open,
  onOpenChange,
  initial,
  others,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Exam | null;
  /** The student's other exams, to warn about clashes. */
  others: Exam[];
  onSave: (input: ExamInput) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!bg-card border-border sm:max-w-lg rounded-[28px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">{initial ? "تعديل الاختبار" : "إضافة اختبار"}</DialogTitle>
          <DialogDescription>أدخل الموعد كما في جدول الاختبارات الرسمي.</DialogDescription>
        </DialogHeader>
        {/* key: reset the fields whenever a different exam is opened */}
        <ExamFields key={initial?.id ?? "new"} initial={initial} others={others} onSave={(v) => { onSave(v); onOpenChange(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function ExamFields({ initial, others, onSave }: { initial: Exam | null; others: Exam[]; onSave: (input: ExamInput) => void }) {
  const courses = useTranscriptStore((s) => s.currentCourses);
  const options = useMemo(
    () => courses.filter((c) => c.code).map((c) => ({ code: c.code, name: c.nameAr || c.nameEn || c.code })),
    [courses],
  );
  const knownCode = initial?.course_code && options.some((o) => o.code === initial.course_code) ? initial.course_code : null;

  const [course, setCourse] = useState<string>(knownCode ?? (initial ? OTHER : options[0]?.code ?? OTHER));
  const [subject, setSubject] = useState(initial && !knownCode ? initial.subject : "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [duration, setDuration] = useState(initial?.duration_minutes ?? DEFAULT_EXAM_MINUTES);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [type, setType] = useState<ExamType>(initial?.exam_type ?? "final");
  const [error, setError] = useState<string | null>(null);

  const chosen = options.find((o) => o.code === course);
  const draft: ExamInput = {
    subject: chosen ? chosen.name : subject.trim(),
    course_code: chosen ? chosen.code : null,
    date,
    time: time || null,
    duration_minutes: duration,
    location: location.trim() || null,
    exam_type: type,
    notes: initial?.notes ?? "",
  };
  const clash = date
    ? findConflicts([{ ...draft, id: initial?.id ?? "draft", done: false }, ...others.filter((o) => o.id !== initial?.id)]).find(
        (c) => c.exams.some((e) => e.id === (initial?.id ?? "draft")),
      )
    : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.subject) return setError("اختر المادة أو اكتب اسمها.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("حدّد تاريخ الاختبار.");
    onSave(draft);
  };

  return (
    <form onSubmit={submit} className="space-y-4 pt-1">
      <label className="block space-y-1.5">
        <span className="text-sm font-bold">المادة</span>
        <select value={course} onChange={(e) => setCourse(e.target.value)} className={`w-full px-3 border ${FIELD}`}>
          {options.map((o) => (
            <option key={o.code} value={o.code}>{o.name} ({o.code})</option>
          ))}
          <option value={OTHER}>مادة أخرى…</option>
        </select>
      </label>
      {course === OTHER && (
        <label className="block space-y-1.5">
          <span className="text-sm font-bold">اسم المادة</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="مثال: الإحصاء" className={FIELD} />
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-bold">التاريخ</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} required />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-bold">الوقت</span>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-bold">المدة</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={`w-full px-3 border ${FIELD}`}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>{m === 60 ? "ساعة" : m === 120 ? "ساعتان" : m === 180 ? "3 ساعات" : `${m} دقيقة`}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-bold">النوع</span>
          <select value={type} onChange={(e) => setType(e.target.value as ExamType)} className={`w-full px-3 border ${FIELD}`}>
            {(Object.keys(EXAM_TYPE_LABELS) as ExamType[]).map((t) => (
              <option key={t} value={t}>{EXAM_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-bold">المكان (اختياري)</span>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="مثال: قاعة 105 — العابدية" className={FIELD} />
      </label>

      {clash && (
        <p
          role="alert"
          className={
            clash.kind === "overlap"
              ? "text-sm font-bold text-rose-700 dark:text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3"
              : "text-sm font-bold text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3"
          }
        >
          {clash.kind === "overlap"
            ? `يتعارض في الوقت مع اختبار ${clash.exams.find((e) => e.id !== (initial?.id ?? "draft"))?.subject}.`
            : `في نفس اليوم اختبار ${clash.exams.find((e) => e.id !== (initial?.id ?? "draft"))?.subject} أيضاً.`}
        </p>
      )}
      {error && <p role="alert" className="text-sm font-bold text-rose-600 dark:text-rose-400">{error}</p>}

      <Button type="submit" className="w-full h-11 rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white font-bold">
        {initial ? "حفظ التعديل" : "إضافة الاختبار"}
      </Button>
    </form>
  );
}
