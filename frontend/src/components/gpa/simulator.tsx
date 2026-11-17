"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GRADE_POINTS, SELECTABLE_GRADES, gradeToneClass, MUTED_GRADE_TONE, type SelectableGrade } from "@/lib/grade-scale";

const CURRENT_TERM_LABEL = "الفصل الحالي";


export type MockCourse = {
  id: string;
  code: string;
  name: string;
  credits: number;
  grade: SelectableGrade;
};


export type SimRow = {
  key: string;
  code: string;
  name: string;
  credits: number;
  grade: SelectableGrade;
  origin: "registered" | "mock";
};


export function SimulatorSection({
  subtitle,
  children,
}: {
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border border-line bg-surface shadow-card rounded-card overflow-hidden">
      <div className="p-5 md:p-6 border-b border-line flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-body font-bold truncate">{CURRENT_TERM_LABEL}</h3>
          <p className="text-small md:text-body font-medium text-ink mt-1.5">
            {subtitle}
          </p>
        </div>
      </div>
      <div className="px-4 md:px-6 pb-5 md:pb-6 pt-4">{children}</div>
    </Card>
  );
}


export function RegisteredCourseRow({
  row,
  onGradeChange,
}: {
  row: SimRow;
  onGradeChange: (g: SelectableGrade) => void;
}) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 p-3 rounded-control bg-info-soft border border-info-line hover:border-info-line transition-colors">
      <div className="col-span-12 sm:col-span-6 min-w-0">
        <div className="text-small font-bold truncate">{row.name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-caption text-ink-muted font-mono">{row.code}</span>
          <span className="text-caption font-bold px-1.5 py-0.5 rounded bg-info-soft text-info-ink border border-info-line">
            مسجّلة
          </span>
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2 text-caption text-ink-muted">
        <span className="font-mono font-bold text-ink">{row.credits}</span> ساعة
      </div>
      <div className="col-span-4 sm:col-span-2 text-caption text-ink-muted font-mono">
        {((GRADE_POINTS[row.grade] ?? 0) * row.credits).toFixed(2)} نقطة
      </div>
      <div className="col-span-4 sm:col-span-2 flex justify-end">
        <GradePicker value={row.grade} onChange={onGradeChange} tone={gradeToneClass(row.grade, MUTED_GRADE_TONE)} />
      </div>
    </div>
  );
}


export function MockCourseRow({
  row,
  onChange,
  onRemove,
}: {
  row: SimRow;
  onChange: <K extends keyof MockCourse>(field: K, value: MockCourse[K]) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 p-3 rounded-control bg-warning-soft border border-warning-line group">
      <div className="col-span-12 sm:col-span-6 min-w-0 space-y-1">
        <input
          value={row.name === "مادة افتراضية" ? "" : row.name}
          onChange={(e) => onChange("name", e.target.value)}
          placeholder="اسم المادة الافتراضية"
          className="w-full bg-transparent outline-none text-small font-bold placeholder:text-ink-muted placeholder:font-normal"
        />
        <div className="flex items-center gap-2">
          <input
            value={row.code === "—" ? "" : row.code}
            onChange={(e) => onChange("code", e.target.value.toUpperCase())}
            placeholder="CODE"
            className="w-20 bg-surface-sunken rounded px-1.5 py-0.5 text-caption font-mono text-ink-muted outline-none focus:bg-surface-sunken"
          />
          <span className="text-caption font-bold px-1.5 py-0.5 rounded bg-warning-soft text-warning-ink border border-warning-line">
            افتراضية
          </span>
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2 flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          max={6}
          value={row.credits}
          onChange={(e) =>
            onChange(
              "credits",
              Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 1)),
            )
          }
          className="w-12 bg-surface-sunken rounded px-1.5 py-1 text-caption font-mono outline-none focus:bg-surface-sunken"
        />
        <span className="text-caption text-ink-muted">ساعة</span>
      </div>
      <div className="col-span-4 sm:col-span-2 text-caption text-ink-muted font-mono">
        {((GRADE_POINTS[row.grade] ?? 0) * row.credits).toFixed(2)} نقطة
      </div>
      <div className="col-span-4 sm:col-span-2 flex justify-end items-center gap-2">
        <GradePicker
          value={row.grade}
          onChange={(g) => onChange("grade", g)}
          tone={gradeToneClass(row.grade, MUTED_GRADE_TONE)}
        />
        <Button variant="bare"
          type="button"
          onClick={onRemove}
          aria-label="حذف المادة الافتراضية"
          className="text-ink-muted hover:text-danger-ink opacity-0 group-hover:opacity-100 transition-opacity p-1"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}


function GradePicker({
  value,
  onChange,
  tone,
}: {
  value: SelectableGrade;
  onChange: (g: SelectableGrade) => void;
  tone: string;
}) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center rounded-md border font-mono font-bold text-caption",
        tone,
      )}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SelectableGrade)}
        aria-label="التقدير المتوقع"
        className="appearance-none bg-transparent pr-2 pl-6 py-1 outline-none cursor-pointer"
      >
        {SELECTABLE_GRADES.map((g) => (
          <option key={g} value={g} className="bg-surface text-ink">
            {g}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3 h-3 absolute left-1.5 pointer-events-none opacity-70" />
    </div>
  );
}
