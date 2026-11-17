"use client";

import { AlertOctagon, Database, FileCheck2, Info, ShieldAlert } from "lucide-react";
import { CONFIDENCE_LABEL, VERIFICATION_LABEL, type AdvisorRun } from "@/lib/advisor";
import { DocumentsList, RulesByKind, UncertaintyList } from "@/components/advisor/evidence";

const SEVERITY = {
  high: { label: "مرتفع", cls: "border-danger-line bg-danger-soft" },
  medium: { label: "متوسط", cls: "border-warning-line bg-warning-soft" },
  low: { label: "منخفض", cls: "border-line bg-surface-sunken" },
} as const;

export function RisksPanel({ run }: { run: AdvisorRun }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="risks-title" className="space-y-3">
        <h3 id="risks-title" className="font-bold flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-info-ink" aria-hidden />
          المخاطر
        </h3>
        {run.risks.length === 0 ? (
          <p className="text-small text-ink-muted">لا توجد مؤشرات خطر في بياناتك الحالية.</p>
        ) : (
          <ul className="space-y-2">
            {run.risks.map((r) => (
              <li key={r.kind + r.message} className={`rounded-card border p-3 text-small ${SEVERITY[r.severity].cls}`}>
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  <span>خطر {SEVERITY[r.severity].label}</span>
                  <span className="rounded-full border border-line-strong px-2 text-caption">
                    {r.basis === "fact" ? "حقيقة من سجلك" : "تقدير وليس يقيناً"}
                  </span>
                </p>
                <p className="mt-1 leading-7">{r.message}</p>
                {r.evidence.length > 0 && (
                  <p className="mt-1 text-caption text-ink-muted" dir="auto">
                    {r.evidence.join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <UncertaintyList run={run} />

      <section aria-labelledby="gaps-title" className="space-y-3">
        <h3 id="gaps-title" className="font-bold flex items-center gap-2">
          <Database className="w-5 h-5 text-info-ink" aria-hidden />
          الثقة والبيانات الناقصة
        </h3>
        <p className="text-small">
          درجة الثقة: <b>{CONFIDENCE_LABEL[run.confidence.level]}</b>
        </p>
        <ul className="text-small list-disc ps-5 space-y-1 leading-7 text-ink-muted">
          {run.confidence.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {run.data_gaps.length > 0 && (
          <ul className="space-y-2">
            {run.data_gaps.map((g) => (
              <li key={g.field} className="rounded-card border border-warning-line bg-warning-soft p-3 text-small">
                <p className="font-bold flex gap-2">
                  <AlertOctagon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                  {g.message}
                </p>
                <p className="text-ink-muted mt-1">{g.impact}</p>
              </li>
            ))}
          </ul>
        )}
        {run.profile.notes.map((n) => (
          <p key={n} className="text-small flex gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-ink-muted" aria-hidden />
            {n}
          </p>
        ))}
      </section>

      <section aria-labelledby="sources-title" className="space-y-3">
        <h3 id="sources-title" className="font-bold flex items-center gap-2">
          <FileCheck2 className="w-5 h-5 text-info-ink" aria-hidden />
          المصادر
        </h3>
        <p className="text-small leading-7">
          {run.curriculum.label} — حالة الخطة: <b>{VERIFICATION_LABEL[run.curriculum.verification]}</b>.{" "}
          <a href={run.curriculum.source_url} target="_blank" rel="noreferrer" className="underline">
            صفحة الخطة الرسمية
          </a>
        </p>
        <ul className="text-small list-disc ps-5 space-y-1 leading-7">
          {run.curriculum.issues.map((i) => (
            <li key={i.code + i.message}>{i.message}</li>
          ))}
        </ul>
        <DocumentsList run={run} />
        <RulesByKind rules={run.rules} />
        <p className="text-caption text-ink-muted">
          نسخة المحرك {run.engine_version} · معرّف التحليل <span dir="ltr">{run.run_id}</span> — نفس البيانات تعطي نفس النتيجة.
        </p>
      </section>
    </div>
  );
}
