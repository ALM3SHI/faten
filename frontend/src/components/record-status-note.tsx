"use client";

import { CalendarClock, GraduationCap } from "lucide-react";
import { RECORD_STATUS_TEXT, type RecordAssessment } from "@/lib/record-status";

/** Explains, without blocking anything, what kind of record was uploaded. Nothing is shown for an enrolled student. */
export function RecordStatusNote({ assessment }: { assessment: RecordAssessment }) {
  if (assessment.status === "enrolled") return null;
  const grad = assessment.status === "graduated" || assessment.status === "likely_graduated";
  const text = RECORD_STATUS_TEXT[assessment.status];
  const Icon = grad ? GraduationCap : CalendarClock;
  return (
    <div
      role="status"
      className={`rounded-2xl border p-4 text-sm leading-7 flex gap-3 ${
        grad ? "bg-emerald-500/10 border-emerald-500/30" : "bg-uqu-accent/5 border-uqu-accent/20"
      }`}
    >
      <Icon className={`w-5 h-5 mt-1 shrink-0 ${grad ? "text-emerald-700 dark:text-emerald-300" : "text-uqu-accent"}`} aria-hidden />
      <div>
        <p className="font-black">{text.title}</p>
        <p>{text.body}</p>
        {assessment.reasons.length > 0 && <p className="text-xs text-muted-foreground mt-1">{assessment.reasons.join(" ")}</p>}
      </div>
    </div>
  );
}
