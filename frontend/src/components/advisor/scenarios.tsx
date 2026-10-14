"use client";

import { useState } from "react";
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
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setOpen(k)}
              className={`text-start rounded-2xl border p-4 space-y-1 transition-colors ${
                active ? "border-uqu-accent/50 bg-uqu-accent/10" : "border-foreground/10 hover:bg-foreground/5"
              }`}
            >
              <p className="font-black flex items-center gap-2">
                {STRATEGY_LABEL[k]}
                {k === run.recommended_strategy && (
                  <span className="text-[11px] rounded-full bg-uqu-accent text-white px-2 py-0.5">المقترح لك</span>
                )}
              </p>
              <p className="text-sm">
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
            </button>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">{STRATEGY_HINT[open]}</p>

      {s.target && (
        <p
          role="status"
          className={`flex gap-2 text-sm font-bold rounded-2xl p-3 border ${
            s.target.verdict === "feasible"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
              : s.target.verdict === "impossible"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300"
                : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300"
          }`}
        >
          {s.target.verdict === "feasible" ? <CheckCircle2 className="w-4 h-4 mt-0.5" aria-hidden /> : <XCircle className="w-4 h-4 mt-0.5" aria-hidden />}
          هدفك ({s.target.target_label}): {s.target.message}
        </p>
      )}

      <ol className="relative space-y-3 border-s-2 border-foreground/10 ps-5">
        {s.terms.map((t) => (
          <li key={t.term} className="relative">
            <span className="absolute -start-[27px] top-1.5 size-3 rounded-full bg-uqu-accent" aria-hidden />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-black">
                {t.label}
                {t.summer && <span className="text-xs font-bold text-amber-700 dark:text-amber-300 ms-2">صيفي</span>}
              </p>
              <span className="text-xs font-bold text-muted-foreground">{t.credits} ساعة</span>
            </div>
            {t.courses.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {t.courses.map((c) => (
                  <li
                    key={c.code}
                    title={[c.name, ...c.tags.map(tagLabel)].join(" · ")}
                    className={`rounded-xl border px-2.5 py-1 text-xs font-bold ${
                      c.kind === "elective"
                        ? "border-dashed border-foreground/25 text-muted-foreground"
                        : c.kind === "coop"
                          ? "border-uqu-accent/40 bg-uqu-accent/10"
                          : c.tags.includes("repeat")
                            ? "border-rose-500/30 bg-rose-500/10"
                            : "border-foreground/10"
                    }`}
                  >
                    <span dir="ltr">{c.kind === "elective" ? "اختياري" : c.code}</span> · {c.credits}
                  </li>
                ))}
              </ul>
            ) : null}
            {t.warnings.map((w) => (
              <p key={w} className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                {w}
              </p>
            ))}
          </li>
        ))}
        {s.complete && (
          <li className="relative font-black text-uqu-accent flex items-center gap-2">
            <Flag className="w-4 h-4" aria-hidden /> التخرج بإذن الله
          </li>
        )}
      </ol>

      {s.unscheduled.length > 0 && (
        <div className="text-sm rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3">
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

      <details className="text-sm rounded-2xl border border-foreground/10 p-4">
        <summary className="cursor-pointer font-bold">افتراضات هذا المسار</summary>
        <ul className="mt-2 list-disc ps-5 space-y-1 text-muted-foreground leading-7">
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
