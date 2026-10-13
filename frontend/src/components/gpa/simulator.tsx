"use client";

import { ChevronDown, Trash2 } from "lucide-react";
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
    <Card className="glass rounded-[28px] border-foreground/10 overflow-hidden">
      <div className="p-5 md:p-6 border-b border-foreground/10 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-base font-black truncate">{CURRENT_TERM_LABEL}</h3>
          <p className="text-sm md:text-base font-medium text-foreground/80 mt-1.5">
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
    <div className="grid grid-cols-12 items-center gap-3 p-3 rounded-xl bg-uqu-accent/[0.04] border border-uqu-accent/15 hover:border-uqu-accent/30 transition-colors">
      <div className="col-span-12 sm:col-span-6 min-w-0">
        <div className="text-[13px] font-bold truncate">{row.name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted font-mono">{row.code}</span>
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-uqu-accent/20 text-uqu-accent border border-uqu-accent/30">
            مسجّلة
          </span>
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2 text-[11px] text-muted">
        <span className="font-mono font-bold text-foreground">{row.credits}</span> ساعة
      </div>
      <div className="col-span-4 sm:col-span-2 text-[11px] text-muted font-mono">
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
    <div className="grid grid-cols-12 items-center gap-3 p-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/15 group">
      <div className="col-span-12 sm:col-span-6 min-w-0 space-y-1">
        <input
          value={row.name === "مادة افتراضية" ? "" : row.name}
          onChange={(e) => onChange("name", e.target.value)}
          placeholder="اسم المادة الافتراضية"
          className="w-full bg-transparent outline-none text-[13px] font-bold placeholder:text-muted placeholder:font-normal"
        />
        <div className="flex items-center gap-2">
          <input
            value={row.code === "—" ? "" : row.code}
            onChange={(e) => onChange("code", e.target.value.toUpperCase())}
            placeholder="CODE"
            className="w-20 bg-foreground/5 rounded px-1.5 py-0.5 text-[10px] font-mono text-muted outline-none focus:bg-foreground/5"
          />
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30">
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
          className="w-12 bg-foreground/5 rounded px-1.5 py-1 text-[11px] font-mono outline-none focus:bg-foreground/5"
        />
        <span className="text-[11px] text-muted">ساعة</span>
      </div>
      <div className="col-span-4 sm:col-span-2 text-[11px] text-muted font-mono">
        {((GRADE_POINTS[row.grade] ?? 0) * row.credits).toFixed(2)} نقطة
      </div>
      <div className="col-span-4 sm:col-span-2 flex justify-end items-center gap-2">
        <GradePicker
          value={row.grade}
          onChange={(g) => onChange("grade", g)}
          tone={gradeToneClass(row.grade, MUTED_GRADE_TONE)}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="حذف المادة الافتراضية"
          className="text-muted hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
        >
          <Trash2 className="w-4 h-4" />
        </button>
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
        "relative inline-flex items-center rounded-md border font-mono font-black text-[11px]",
        tone,
      )}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SelectableGrade)}
        className="appearance-none bg-transparent pr-2 pl-6 py-1 outline-none cursor-pointer"
      >
        {SELECTABLE_GRADES.map((g) => (
          <option key={g} value={g} className="bg-background text-foreground">
            {g}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3 h-3 absolute left-1.5 pointer-events-none opacity-70" />
    </div>
  );
}
