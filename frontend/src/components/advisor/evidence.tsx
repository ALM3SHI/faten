"use client";

/**
 * Evidence panels for the advisor: academic standing, plan match, documented
 * electives, uncertainties (with their effect), official documents and the
 * applied rules grouped by kind. All content comes from the server run.
 */

import { AlertTriangle, BadgeCheck, FileText, HelpCircle, Scale } from "lucide-react";
import { RULE_KIND_LABEL, type AdvisorRun, type RuleCite } from "@/lib/advisor";

const BOX = "rounded-card border p-3 text-small leading-7";

export function StandingCard({ run }: { run: AdvisorRun }) {
  const st = run.standing;
  if (!st) return null;
  const w = st.warning;
  const tone =
    w.status === "warning"
      ? "border-danger-line bg-danger-soft"
      : w.status === "clear"
        ? "border-success-line bg-success-soft"
        : "border-line bg-surface-sunken";
  return (
    <section aria-labelledby="standing-title" className="grid gap-3 sm:grid-cols-2">
      <h3 id="standing-title" className="sr-only">
        الوضع الأكاديمي
      </h3>
      <div className={`${BOX} ${tone}`}>
        <p className="font-bold flex items-center gap-2">
          <Scale className="w-4 h-4" aria-hidden />
          الإنذار الأكاديمي: {w.status === "warning" ? "نعم" : w.status === "clear" ? "لا" : "غير محسوم"}
        </p>
        <p>{w.message}</p>
        <p className="text-caption text-ink-muted">{w.summer_note}</p>
      </div>
      <div className={`${BOX} border-line`}>
        <p className="font-bold">شرط التخرج</p>
        <p>{st.graduation.message}</p>
        <p className="text-caption text-ink-muted">
          الإنذار والتخرج قاعدتان مختلفتان تشتركان في معدل التخرج المحدد لتخصصك.
        </p>
      </div>
    </section>
  );
}

export function FitAlert({ run }: { run: AdvisorRun }) {
  const fit = run.curriculum_fit;
  const prep = run.prep_year;
  return (
    <>
      {fit && (fit.verdict === "other_edition" || fit.verdict === "mismatch") && (
        <p role="alert" className={`${BOX} border-danger-line bg-danger-soft flex gap-2 font-bold`}>
          <AlertTriangle className="w-4 h-4 mt-1.5 shrink-0" aria-hidden />
          <span>
            {fit.message}
            {fit.editions[0]?.url && (
              <>
                {" "}
                <a href={fit.editions[0].url} target="_blank" rel="noreferrer" className="underline">
                  دليل ذلك الإصدار
                </a>
              </>
            )}
          </span>
        </p>
      )}
      {prep?.in_prep && prep.notice && (
        <p role="status" className={`${BOX} border-info-line bg-info-soft`}>
          {prep.notice}
        </p>
      )}
    </>
  );
}

export function EquivalenceList({ run }: { run: AdvisorRun }) {
  const eq = run.equivalences;
  if (!eq || (eq.counts.total === 0 && eq.no_equivalent.length === 0)) return null;
  if (eq.counts.total === 0 && run.curriculum_fit?.verdict !== "transferred") return null;
  return (
    <details className="rounded-card border border-line p-4">
      <summary className="cursor-pointer font-bold text-small">
        معادلة مقرراتك من خطتك السابقة ({eq.counts.total} مقرر
        {eq.counts.likely > 0 && `، ${eq.counts.likely} مرجّحة`})
      </summary>
      <p className="mt-2 text-caption text-ink-muted leading-6">
        نحتسب مقرراتك القديمة لمتطلبات الخطة الحالية فقط؛ معدلك وساعاتك المكتسبة تبقى كما في سجلك. «مرجّحة» تعني أن المقرر
        نفسه بالاسم والمحتوى لكن القسم لم يؤكد المعادلة بعد.
      </p>
      <ul className="mt-3 space-y-2 text-small">
        {eq.applied.map((m) => (
          <li key={m.to} className="rounded-control border border-line p-3 leading-7">
            <p className="flex flex-wrap items-baseline gap-2">
              {m.from.map((f) => (
                <span key={f.code}>
                  <bdi dir="ltr">{f.code}</bdi> {f.name} <span className="text-caption text-ink-muted">({f.credits} س)</span>
                </span>
              ))}
              <span aria-hidden>←</span>
              <span className="font-bold">
                <bdi dir="ltr">{m.to}</bdi> {m.to_name}
              </span>
              <span className="text-caption text-ink-muted">({m.to_credits} س)</span>
              <span
                className={`text-caption rounded-full px-2 ${
                  m.confidence === "confirmed" ? "bg-success-soft text-success-ink " : "bg-warning-soft text-warning-ink "
                }`}
              >
                {m.confidence_label}
              </span>
            </p>
            {m.note && <p className="text-caption text-ink-muted">{m.note}</p>}
          </li>
        ))}
      </ul>
      {eq.no_equivalent.length > 0 && (
        <p className="mt-3 text-caption text-ink-muted leading-6">
          بلا مقابل في الخطة الحالية ({eq.no_equivalent.length}):{" "}
          {eq.no_equivalent.map((c) => c.name || c.code).join("، ")}. قد يحتسب القسم بعضها اختيارياً.
        </p>
      )}
    </details>
  );
}

export function ElectiveOptionsList({ run }: { run: AdvisorRun }) {
  const eo = run.elective_options;
  if (!eo || eo.options.length === 0) return null;
  return (
    <details className="rounded-card border border-line p-4">
      <summary className="cursor-pointer font-bold text-small">
        مقررات اختيارية موثّقة ({eo.options.length}) — قائمة جزئية
      </summary>
      <p className="mt-2 text-caption text-ink-muted leading-6">{eo.note}</p>
      <ul className="mt-3 space-y-2 text-small">
        {eo.options.map((o) => (
          <li key={o.code} className="rounded-control border border-line p-3 leading-7">
            <p className="font-bold flex flex-wrap gap-2 items-baseline">
              <bdi dir="ltr">{o.code}</bdi> <span>{o.title}</span>
              <span className="text-caption text-ink-muted">({o.credits} ساعات)</span>
            </p>
            <p className="text-ink-muted">
              {o.taken
                ? "اجتزته."
                : o.eligible
                  ? "متطلباته مستوفاة"
                  : `ينقصك: ${o.missing_prerequisites.join("، ")}`}
              {o.corequisites_to_pair.length > 0 && ` — متطلب متزامن: ${o.corequisites_to_pair.join("، ")} (قبله أو معه)`}
            </p>
            <a href={o.source_url} target="_blank" rel="noreferrer" className="text-caption underline">
              توصيف المقرر {o.document?.version ? `(الإصدار ${o.document.version})` : ""}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function UncertaintyList({ run }: { run: AdvisorRun }) {
  const items = run.uncertainties ?? [];
  if (!items.length) return null;
  return (
    <section aria-labelledby="unc-title" className="space-y-3">
      <h3 id="unc-title" className="font-bold flex items-center gap-2">
        <HelpCircle className="w-5 h-5 text-info-ink" aria-hidden />
        ما لا نعرفه وأثره على التوصية
      </h3>
      <ul className="space-y-2">
        {items.map((u) => (
          <li key={u.topic} className={`${BOX} border-warning-line bg-warning-soft`}>
            <p className="font-bold">{u.message}</p>
            <p className="text-ink-muted">الأثر: {u.effect}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DocumentsList({ run }: { run: AdvisorRun }) {
  const docs = run.documents ?? [];
  if (!docs.length) return null;
  return (
    <details className="text-small rounded-card border border-line p-4">
      <summary className="cursor-pointer font-bold flex items-center gap-2">
        <FileText className="w-4 h-4" aria-hidden />
        الوثائق الرسمية المستخدمة ({docs.length})
      </summary>
      <ul className="mt-2 space-y-2 leading-7">
        {docs.map((d) => (
          <li key={d.id}>
            <a href={d.url} target="_blank" rel="noreferrer" className="underline" dir="auto">
              {d.title}
            </a>
            <span className="text-ink-muted">
              {d.version ? ` — الإصدار ${d.version}` : ""}
              {d.date ? ` — ${d.date}` : ""}
            </span>
            {d.applicability === "not_applicable" ? (
              <p className="text-caption text-warning-ink">لا تنطبق على الخطة الحالية: {d.reason}</p>
            ) : (
              <span className="text-caption text-success-ink ms-2 inline-flex items-center gap-1">
                <BadgeCheck className="w-3.5 h-3.5" aria-hidden /> مطبّقة
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function RulesByKind({ rules }: { rules: RuleCite[] }) {
  const order = ["hard", "standing", "default", "unknown", "info"];
  const groups = order
    .map((k) => [k, rules.filter((r) => (r.kind ?? (r.status === "verified" ? "hard" : "unknown")) === k)] as const)
    .filter(([, list]) => list.length > 0);
  return (
    <details className="text-small rounded-card border border-line p-4">
      <summary className="cursor-pointer font-bold">قواعد اللائحة والافتراضات المطبّقة</summary>
      <div className="mt-2 space-y-3">
        {groups.map(([kind, list]) => (
          <div key={kind}>
            <p className="font-bold text-caption text-ink-muted mb-1">{RULE_KIND_LABEL[kind]}</p>
            <ul className="space-y-1.5 leading-7">
              {list.map((r) => (
                <li key={r.rule}>
                  {r.text}
                  {r.article && <span className="text-ink-muted"> — {r.article}</span>}
                  {r.source_url && (
                    <>
                      {" "}
                      <a href={r.source_url} target="_blank" rel="noreferrer" className="underline text-caption">
                        المصدر
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
