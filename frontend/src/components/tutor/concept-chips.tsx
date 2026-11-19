"use client";

import { Microscope } from "lucide-react";
import { Button } from "@/components/ds/button";
import { formatDayShort } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { ConceptChip } from "@/lib/tutor";

const LEVEL: Record<ConceptChip["level"], { label: string; dot: string }> = {
  strong: { label: "قوي", dot: "bg-success-ink" },
  developing: { label: "يتطور", dot: "bg-warning-ink" },
  weak: { label: "يحتاج تثبيت", dot: "bg-danger-ink" },
  unknown: { label: "لم يُقَس بعد", dot: "bg-line-strong" },
};

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A topic's concepts as the student sees them: how they answer on each one
 * and when its memory needs a review. Each opens its deep-dive page.
 */
export function ConceptChips({
  concepts,
  label,
  busy,
  onDeepDive,
}: {
  concepts: ConceptChip[];
  label: string;
  busy?: boolean;
  onDeepDive?: (conceptId: string) => void;
}) {
  if (!concepts?.length) return null;
  const today = todayYmd();
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-small font-bold">
        <Microscope className="size-3.5 text-info-ink" aria-hidden /> {label}
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={label}>
        {concepts.map((c) => {
          const lv = LEVEL[c.level] ?? LEVEL.unknown;
          const due = c.due ? (c.due <= today ? "حان وقت مراجعته" : `مراجعته ${formatDayShort(c.due)}`) : "";
          return (
            <li key={c.id}>
              <Button
                variant="bare"
                type="button"
                disabled={busy || !onDeepDive}
                onClick={() => onDeepDive?.(c.id)}
                aria-label={`تعمّق في «${c.name}» — ${lv.label}${due ? `، ${due}` : ""}`}
                className="inline-flex h-auto items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-small hover:border-info-line hover:text-info-ink disabled:opacity-60"
              >
                <span className={cn("size-2 shrink-0 rounded-full", lv.dot)} aria-hidden />
                <span dir="auto">{c.name}</span>
                {due && <span className="text-caption text-ink-muted">· {due}</span>}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
