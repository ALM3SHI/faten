"use client";

import { useState } from "react";
import { Button } from "@/components/ds/button";
import { CheckCircle2, Flag, XCircle } from "lucide-react";
import { STRATEGY_HINT, STRATEGY_LABEL, tagLabel, type AdvisorRun, type Strategy } from "@/lib/advisor";

const ORDER: Strategy[] = ["fastest", "balanced", "recovery"];

export function ScenariosPanel({ run }: { run: AdvisorRun }) {
  const [open, setOpen] = useState<Strategy>(run.recommended_strategy);
  const s = run.scenarios[open];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="مسارات التخرج">
        {ORDER.map((k) => {
          const sc = run.scenarios[k];
          const active = k === open;
          return (
            <Button variant="bare"
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setOpen(k)}
              className={`text-start rounded-card border p-4 space-y-1 transition-colors ${
                active ? "border-info-line bg-info-soft" : "border-line hover:bg-surface-sunken"
              }`}
            >
              <p className="font-bold flex items-center gap-2">
                {STRATEGY_LABEL[k]}
                {k === run.recommended_strategy && (
                  <span className="text-caption rounded-full bg-brand text-on-brand px-2 py-0.5">المقترح لك</span>
                )}
              </p>
              <p className="text-small">
                {sc.complete ? (
                  <>
                    تخرج محسوب <b>{sc.graduation_label}</b>
                    <br />
                    {sc.terms_needed} فصول · حتى {sc.load_cap} ساعة
                  </>
                ) : (
                  "لم يكتمل ضمن الأفق الزمني"
                )}
              </p>
            </Button>
          );
        })}
      </div>

      <p className="text-small text-ink-muted">{STRATEGY_HINT[open]}</p>

      {s.target && (
        <p
          role="status"
          className={`flex gap-2 text-small font-bold rounded-card p-3 border ${
            s.target.verdict === "feasible"
              ? "bg-success-soft border-success-line text-success-ink "
              : s.target.verdict === "impossible"
                ? "bg-danger-soft border-danger-line text-danger-ink "
                : "bg-warning-soft border-warning-line text-warning-ink "
          }`}
        >
          {s.target.verdict === "feasible" ? <CheckCircle2 className="w-4 h-4 mt-0.5" aria-hidden /> : <XCircle className="w-4 h-4 mt-0.5" aria-hidden />}
          هدفك ({s.target.target_label}): {s.target.message}
        </p>
      )}

      <ol className="relative space-y-3 border-s-2 border-line ps-5">
        {s.terms.map((t) => (
          <li key={t.term} className="relative">
            <span className="absolute -start-[27px] top-1.5 size-3 rounded-full bg-brand" aria-hidden />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-bold">
                {t.label}
                {t.summer && <span className="text-caption font-bold text-warning-ink ms-2">صيفي</span>}
              </p>
              <span className="text-caption font-bold text-ink-muted">{t.credits} ساعة</span>
            </div>
            {t.courses.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {t.courses.map((c) => (
                  <li
                    key={c.code}
                    title={[c.name, ...c.tags.map(tagLabel)].join(" · ")}
                    className={`rounded-control border px-2.5 py-1 text-caption font-bold ${
                      c.kind === "elective"
                        ? "border-dashed border-line-strong text-ink-muted"
                        : c.kind === "coop"
                          ? "border-info-line bg-info-soft"
                          : c.tags.includes("repeat")
                            ? "border-danger-line bg-danger-soft"
                            : "border-line"
                    }`}
                  >
                    <span dir="ltr">{c.kind === "elective" ? "اختياري" : c.code}</span> · {c.credits}
                  </li>
                ))}
              </ul>
            ) : null}
            {t.warnings.map((w) => (
              <p key={w} className="mt-1 text-caption text-warning-ink">
                {w}
              </p>
            ))}
          </li>
        ))}
        {s.complete && (
          <li className="relative font-bold text-info-ink flex items-center gap-2">
            <Flag className="w-4 h-4" aria-hidden /> التخرج بإذن الله
          </li>
        )}
      </ol>

      {s.unscheduled.length > 0 && (
        <div className="text-small rounded-card border border-danger-line bg-danger-soft p-3">
          <p className="font-bold mb-1">لم يُجدول:</p>
          <ul className="list-disc ps-5">
            {s.unscheduled.map((u) => (
              <li key={u.code}>
                <span dir="ltr">{u.code}</span> — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-small rounded-card border border-line p-4">
        <summary className="cursor-pointer font-bold">افتراضات هذا المسار</summary>
        <ul className="mt-2 list-disc ps-5 space-y-1 text-ink-muted leading-7">
          {s.lower_bound.earliest_label && (
            <li>
              أبكر تخرج ممكن رياضياً: {s.lower_bound.earliest_label} (
              {s.lower_bound.by === "chain" ? "تحدّه سلسلة المتطلبات" : "تحدّه الساعات المتبقية والعبء"}).
            </li>
          )}
          {s.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
