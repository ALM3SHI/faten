"use client";

/**
 * Evidence panels for the advisor: academic standing, plan match, documented
 * electives, uncertainties (with their effect), official documents and the
 * applied rules grouped by kind. All content comes from the server run.
 */

import { AlertTriangle, BadgeCheck, FileText, HelpCircle, Scale } from "lucide-react";
import { RULE_KIND_LABEL, type AdvisorRun, type RuleCite } from "@/lib/advisor";

const BOX = "rounded-2xl border p-3 text-sm leading-7";

export function StandingCard({ run }: { run: AdvisorRun }) {
  const st = run.standing;
  if (!st) return null;
  const w = st.warning;
  const tone =
    w.status === "warning"
      ? "border-rose-500/30 bg-rose-500/10"
      : w.status === "clear"
        ? "border-emerald-500/30 bg-emerald-500/10"
        : "border-foreground/10 bg-foreground/5";
  return (
    <section aria-labelledby="standing-title" className="grid gap-3 sm:grid-cols-2">
      <h3 id="standing-title" className="sr-only">
        الوضع الأكاديمي
      </h3>
      <div className={`${BOX} ${tone}`}>
        <p className="font-black flex items-center gap-2">
          <Scale className="w-4 h-4" aria-hidden />
          الإنذار الأكاديمي: {w.status === "warning" ? "نعم" : w.status === "clear" ? "لا" : "غير محسوم"}
        </p>
        <p>{w.message}</p>
        <p className="text-xs text-muted-foreground">{w.summer_note}</p>
      </div>
      <div className={`${BOX} border-foreground/10`}>
        <p className="font-black">شرط التخرج</p>
        <p>{st.graduation.message}</p>
        <p className="text-xs text-muted-foreground">
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
        <p role="alert" className={`${BOX} border-rose-500/30 bg-rose-500/10 flex gap-2 font-bold`}>
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
        <p role="status" className={`${BOX} border-uqu-accent/30 bg-uqu-accent/5`}>
          {prep.notice}
        </p>
      )}
    </>
  );
}

export function ElectiveOptionsList({ run }: { run: AdvisorRun }) {
  const eo = run.elective_options;
  if (!eo || eo.options.length === 0) return null;
  return (
    <details className="rounded-2xl border border-foreground/10 p-4">
      <summary className="cursor-pointer font-bold text-sm">
        مقررات اختيارية موثّقة ({eo.options.length}) — قائمة جزئية
      </summary>
      <p className="mt-2 text-xs text-muted-foreground leading-6">{eo.note}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {eo.options.map((o) => (
          <li key={o.code} className="rounded-xl border border-foreground/10 p-3 leading-7">
            <p className="font-bold flex flex-wrap gap-2 items-baseline">
              <bdi dir="ltr">{o.code}</bdi> <span>{o.title}</span>
              <span className="text-xs text-muted-foreground">({o.credits} ساعات)</span>
            </p>
            <p className="text-muted-foreground">
              {o.taken
                ? "اجتزته."
                : o.eligible
                  ? "متطلباته مستوفاة"
                  : `ينقصك: ${o.missing_prerequisites.join("، ")}`}
              {o.corequisites_to_pair.length > 0 && ` — متطلب متزامن: ${o.corequisites_to_pair.join("، ")} (قبله أو معه)`}
            </p>
            <a href={o.source_url} target="_blank" rel="noreferrer" className="text-xs underline">
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
      <h3 id="unc-title" className="font-black flex items-center gap-2">
        <HelpCircle className="w-5 h-5 text-uqu-accent" aria-hidden />
        ما لا نعرفه وأثره على التوصية
      </h3>
      <ul className="space-y-2">
        {items.map((u) => (
          <li key={u.topic} className={`${BOX} border-amber-500/30 bg-amber-500/5`}>
            <p className="font-bold">{u.message}</p>
            <p className="text-muted-foreground">الأثر: {u.effect}</p>
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
    <details className="text-sm rounded-2xl border border-foreground/10 p-4">
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
            <span className="text-muted-foreground">
              {d.version ? ` — الإصدار ${d.version}` : ""}
              {d.date ? ` — ${d.date}` : ""}
            </span>
            {d.applicability === "not_applicable" ? (
              <p className="text-xs text-amber-800 dark:text-amber-300">لا تنطبق على الخطة الحالية: {d.reason}</p>
            ) : (
              <span className="text-xs text-emerald-700 dark:text-emerald-300 ms-2 inline-flex items-center gap-1">
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
    <details className="text-sm rounded-2xl border border-foreground/10 p-4">
      <summary className="cursor-pointer font-bold">قواعد اللائحة والافتراضات المطبّقة</summary>
      <div className="mt-2 space-y-3">
        {groups.map(([kind, list]) => (
          <div key={kind}>
            <p className="font-black text-xs text-muted-foreground mb-1">{RULE_KIND_LABEL[kind]}</p>
            <ul className="space-y-1.5 leading-7">
              {list.map((r) => (
                <li key={r.rule}>
                  {r.text}
                  {r.article && <span className="text-muted-foreground"> — {r.article}</span>}
                  {r.source_url && (
                    <>
                      {" "}
                      <a href={r.source_url} target="_blank" rel="noreferrer" className="underline text-xs">
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
