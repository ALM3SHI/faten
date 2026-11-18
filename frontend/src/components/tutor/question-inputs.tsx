"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ds/button";
import { cn } from "@/lib/utils";

/**
 * Put the steps of a process in order. Up/down buttons rather than dragging:
 * they work the same with a finger, a mouse, a keyboard and a screen reader.
 * `order` holds the shown items' positions, top to bottom.
 */
export function OrderInput({ items, order, onChange, disabled }: { items: string[]; order: number[]; onChange: (o: number[]) => void; disabled?: boolean }) {
  const move = (k: number, by: -1 | 1) => {
    const j = k + by;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[k], next[j]] = [next[j], next[k]];
    onChange(next);
  };
  return (
    <ol className="mt-3 space-y-2" aria-label="رتّب الخطوات من الأولى إلى الأخيرة">
      {order.map((i, k) => (
        <li key={i} className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2">
          <span className="nums w-6 shrink-0 text-center text-small font-bold text-ink-muted" aria-hidden>
            {k + 1}
          </span>
          <span className="flex-1 text-body" dir="auto">
            {items[i]}
          </span>
          <Button variant="quiet" size="sm" disabled={disabled || k === 0} onClick={() => move(k, -1)} aria-label={`انقل «${items[i]}» لأعلى`} className="px-2">
            <ArrowUp aria-hidden />
          </Button>
          <Button variant="quiet" size="sm" disabled={disabled || k === order.length - 1} onClick={() => move(k, 1)} aria-label={`انقل «${items[i]}» لأسفل`} className="px-2">
            <ArrowDown aria-hidden />
          </Button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Pair each item on the right with its match. `matches[i]` is the position of
 * the right-hand item chosen for left item i (null until chosen).
 */
export function MatchInput({
  lefts,
  rights,
  matches,
  onChange,
  disabled,
}: {
  lefts: string[];
  rights: string[];
  matches: (number | null)[];
  onChange: (m: (number | null)[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 space-y-2" role="group" aria-label="وصّل كل عنصر بما يناسبه">
      {lefts.map((left, i) => {
        const taken = matches[i] !== null && matches.filter((m) => m === matches[i]).length > 1;
        return (
          <label key={left} className="grid gap-1.5 rounded-control border border-line bg-surface px-3 py-2 sm:grid-cols-2 sm:items-center">
            <span className="text-body font-bold" dir="auto">
              {left}
            </span>
            <select
              value={matches[i] ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const next = matches.slice();
                next[i] = e.target.value === "" ? null : Number(e.target.value);
                onChange(next);
              }}
              aria-label={`ما يناسب «${left}»`}
              aria-invalid={taken || undefined}
              className={cn("h-10 rounded-control border bg-surface px-2 text-body", taken ? "border-warning-line" : "border-line-strong")}
            >
              <option value="">اختر…</option>
              {rights.map((r, j) => (
                <option key={r} value={j}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
