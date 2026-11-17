"use client";

import { AlertTriangle, ArrowLeftRight, BookOpen, Calculator, Lightbulb } from "lucide-react";
import { delayLabel, tagLabel, type AdvisorRun } from "@/lib/advisor";
import { ElectiveOptionsList } from "@/components/advisor/evidence";

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" | "warn" }) {
  const cls =
    tone === "accent"
      ? "bg-info-soft text-info-ink border-info-line"
      : tone === "warn"
        ? "bg-warning-soft text-warning-ink border-warning-line"
        : "bg-surface-sunken text-ink-muted border-line";
  return <span className={`inline-flex items-center rounded-full border px-2.5 h-6 text-caption font-bold ${cls}`}>{children}</span>;
}

export function NextTermPanel({ run }: { run: AdvisorRun }) {
  const nt = run.next_term;
  const what = run.gpa_what_if;
  if (!nt.courses.length) {
    return (
      <p className="text-small text-ink-muted leading-7">
        لا يوجد مقرر يمكن اقتراحه الآن. راجع «المخاطر والبيانات» لمعرفة السبب (متطلب غير مكتمل، أو بيانات ناقصة).
      </p>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-subheading font-bold flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-info-ink" aria-hidden />
          سجّل في {nt.label}
        </h3>
        <span className="text-small font-bold text-ink-muted">{nt.credits} ساعة</span>
      </div>

      {nt.warnings.map((w) => (
        <p key={w} role="alert" className="flex gap-2 text-small font-bold text-warning-ink bg-warning-soft border border-warning-line rounded-card p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          {w}
        </p>
      ))}

      <ul className="space-y-3">
        {nt.courses.map((c) => {
          const delay = delayLabel(c.delay_cost_terms);
          return (
            <li key={c.code} className="rounded-card border border-line p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold flex flex-wrap items-baseline gap-2">
                  <bdi dir="ltr" className="text-info-ink">{c.code}</bdi>
                  <span>{c.name}</span>
                </p>
                <span className="text-caption font-bold text-ink-muted">{c.credits} ساعات</span>
              </div>
              <ul className="text-small leading-7 list-disc ps-5 text-ink">
                {c.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-1.5">
                {c.tags.map((t) => (
                  <Tag key={t} tone={t === "critical" || t === "repeat" ? "accent" : t === "heavy" || t === "ahead_of_plan" || t === "needs_approval" || t === "conditional" ? "warn" : "muted"}>
                    {tagLabel(t)}
                  </Tag>
                ))}
                {delay && <Tag tone={c.delay_cost_terms && c.delay_cost_terms > 0 ? "warn" : "muted"}>{delay}</Tag>}
              </div>
              {c.workload_evidence && (
                <p className="text-caption text-ink-muted">
                  الصعوبة {c.workload_evidence.averages.difficulty ?? "؟"}/5، العبء {c.workload_evidence.averages.workload ?? "؟"}/5 —{" "}
                  {c.workload_evidence.count} تقييم. {c.workload_evidence.note}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <ElectiveOptionsList run={run} />

      {nt.alternatives.length > 0 && (
        <details className="rounded-card border border-line p-4">
          <summary className="cursor-pointer font-bold text-small flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4" aria-hidden />
            مقررات أخرى يمكنك تسجيلها ({nt.alternatives.length})
          </summary>
          <ul className="mt-3 space-y-2 text-small">
            {nt.alternatives.map((a) => (
              <li key={a.code} className="leading-7">
                <bdi dir="ltr" className="font-bold">{a.code}</bdi> {a.name} ({a.credits} س) —{" "}
                <span className="text-ink-muted">{a.why_not_now}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {what.available && (
        <section aria-labelledby="whatif-title" className="rounded-card border border-line p-4 space-y-3">
          <h4 id="whatif-title" className="font-bold text-small flex items-center gap-2">
            <Calculator className="w-4 h-4 text-info-ink" aria-hidden />
            أثر الفصل القادم على معدلك ({what.current_gpa.toFixed(2)} الآن)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-small">
              <caption className="sr-only">المعدل التراكمي الناتج حسب متوسطك في الفصل القادم</caption>
              <thead>
                <tr className="text-ink-muted">
                  <th scope="col" className="text-start font-medium py-1">لو كان متوسطك</th>
                  {what.rows.map((r) => (
                    <th key={r.term_average} scope="col" className="font-bold py-1" dir="ltr">
                      {r.term_average}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="text-start font-medium py-1">يصبح معدلك</th>
                  {what.rows.map((r) => (
                    <td key={r.term_average} className="text-center font-bold py-1">
                      {r.resulting_gpa.toFixed(2)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-caption text-ink-muted flex gap-1.5">
            <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
            {what.note}
          </p>
        </section>
      )}
    </div>
  );
}
