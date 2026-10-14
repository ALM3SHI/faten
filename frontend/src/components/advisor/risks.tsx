"use client";

import { AlertOctagon, Database, FileCheck2, Info, ShieldAlert } from "lucide-react";
import { CONFIDENCE_LABEL, VERIFICATION_LABEL, type AdvisorRun } from "@/lib/advisor";

const SEVERITY = {
  high: { label: "مرتفع", cls: "border-rose-500/30 bg-rose-500/10" },
  medium: { label: "متوسط", cls: "border-amber-500/30 bg-amber-500/10" },
  low: { label: "منخفض", cls: "border-foreground/10 bg-foreground/5" },
} as const;

export function RisksPanel({ run }: { run: AdvisorRun }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="risks-title" className="space-y-3">
        <h3 id="risks-title" className="font-black flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-uqu-accent" aria-hidden />
          المخاطر
        </h3>
        {run.risks.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد مؤشرات خطر في بياناتك الحالية.</p>
        ) : (
          <ul className="space-y-2">
            {run.risks.map((r) => (
              <li key={r.kind + r.message} className={`rounded-2xl border p-3 text-sm ${SEVERITY[r.severity].cls}`}>
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  <span>خطر {SEVERITY[r.severity].label}</span>
                  <span className="rounded-full border border-foreground/15 px-2 text-[11px]">
                    {r.basis === "fact" ? "حقيقة من سجلك" : "تقدير وليس يقيناً"}
                  </span>
                </p>
                <p className="mt-1 leading-7">{r.message}</p>
                {r.evidence.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                    {r.evidence.join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="gaps-title" className="space-y-3">
        <h3 id="gaps-title" className="font-black flex items-center gap-2">
          <Database className="w-5 h-5 text-uqu-accent" aria-hidden />
          الثقة والبيانات الناقصة
        </h3>
        <p className="text-sm">
          درجة الثقة: <b>{CONFIDENCE_LABEL[run.confidence.level]}</b>
        </p>
        <ul className="text-sm list-disc ps-5 space-y-1 leading-7 text-muted-foreground">
          {run.confidence.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {run.data_gaps.length > 0 && (
          <ul className="space-y-2">
            {run.data_gaps.map((g) => (
              <li key={g.field} className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <p className="font-bold flex gap-2">
                  <AlertOctagon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                  {g.message}
                </p>
                <p className="text-muted-foreground mt-1">{g.impact}</p>
              </li>
            ))}
          </ul>
        )}
        {run.profile.notes.map((n) => (
          <p key={n} className="text-sm flex gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
            {n}
          </p>
        ))}
      </section>

      <section aria-labelledby="sources-title" className="space-y-3">
        <h3 id="sources-title" className="font-black flex items-center gap-2">
          <FileCheck2 className="w-5 h-5 text-uqu-accent" aria-hidden />
          المصادر
        </h3>
        <p className="text-sm leading-7">
          {run.curriculum.label} — حالة الخطة: <b>{VERIFICATION_LABEL[run.curriculum.verification]}</b>.{" "}
          <a href={run.curriculum.source_url} target="_blank" rel="noreferrer" className="underline">
            صفحة الخطة الرسمية
          </a>
        </p>
        <ul className="text-sm list-disc ps-5 space-y-1 leading-7">
          {run.curriculum.issues.map((i) => (
            <li key={i.code + i.message}>{i.message}</li>
          ))}
        </ul>
        <details className="text-sm rounded-2xl border border-foreground/10 p-4">
          <summary className="cursor-pointer font-bold">قواعد اللائحة التي طُبّقت</summary>
          <ul className="mt-2 space-y-2 leading-7">
            {run.rules.map((r) => (
              <li key={r.rule}>
                <span className={r.status === "verified" ? "text-emerald-700 dark:text-emerald-300 font-bold" : "text-amber-700 dark:text-amber-300 font-bold"}>
                  {r.status === "verified" ? "موثّقة: " : "غير منشورة: "}
                </span>
                {r.text}
                {r.article && <span className="text-muted-foreground"> — {r.article}</span>}
              </li>
            ))}
          </ul>
        </details>
        <p className="text-xs text-muted-foreground">
          نسخة المحرك {run.engine_version} · معرّف التحليل <span dir="ltr">{run.run_id}</span> — نفس البيانات تعطي نفس النتيجة.
        </p>
      </section>
    </div>
  );
}
