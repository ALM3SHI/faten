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
      className={`rounded-card border p-4 text-small leading-7 flex gap-3 ${
        grad ? "bg-success-soft border-success-line" : "bg-info-soft border-info-line"
      }`}
    >
      <Icon className={`w-5 h-5 mt-1 shrink-0 ${grad ? "text-success-ink " : "text-info-ink"}`} aria-hidden />
      <div>
        <p className="font-bold">{text.title}</p>
        <p>{text.body}</p>
        {assessment.reasons.length > 0 && <p className="text-caption text-ink-muted mt-1">{assessment.reasons.join(" ")}</p>}
      </div>
    </div>
  );
}
