"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, Compass } from "lucide-react";
import { advisorApi, type AdvisorRun } from "@/lib/advisor";

type State = { status: "loading" } | { status: "ready"; run: AdvisorRun | null };

/**
 * The advisor's latest recommendation in one card inside «معدّلي».
 *
 * Reads the saved analysis (GET /api/advisor/latest) — it never starts a
 * new one; the full reasoning, scenarios and tools stay on /advisor.
 */
export function AdvisorTeaser() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    advisorApi
      .latest()
      .then((r) => alive && setState({ status: "ready", run: r.run }))
      .catch(() => alive && setState({ status: "ready", run: null }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading") {
    return <div className="h-28 rounded-card bg-surface-sunken animate-pulse" aria-busy="true" aria-label="المرشد الأكاديمي" />;
  }

  const run = state.run;
  if (!run) {
    return (
      <Link
        href="/advisor"
        prefetch={false}
        className="group flex items-center gap-4 rounded-card border border-line p-5 hover:bg-surface-sunken transition-colors"
      >
        <span className="w-11 h-11 rounded-card bg-info-soft text-info-ink flex items-center justify-center shrink-0">
          <Compass className="w-5 h-5" aria-hidden />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-bold">وش أسجّل الفصل القادم؟</span>
          <span className="block text-small text-ink-muted leading-6">
            المرشد يحسبها من خطتك الرسمية وسجلك، مع مسارات التخرج والمخاطر.
          </span>
        </span>
        <span className="text-small font-bold text-info-ink shrink-0">حلّل وضعي</span>
      </Link>
    );
  }

  const graduated = run.record_status?.status === "graduated" || run.record_status?.status === "likely_graduated";
  const planOk = run.plan_applicable !== false && !graduated;
  const next = run.next_term;
  const courses = planOk ? next.courses : [];
  const highRisks = run.risks.filter((r) => r.severity === "high");
  const date = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long" }).format(new Date(run.created_at));

  return (
    <section aria-labelledby="advisor-teaser-title" className="rounded-card bg-info-soft border border-info-line p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="advisor-teaser-title" className="text-caption font-bold text-info-ink">المرشد يقترح</h2>
        <span className="text-caption text-ink-muted">آخر تحليل {date}</span>
      </div>

      {courses.length > 0 ? (
        <>
          {/* Term and count on separate lines: "1448: 5" would reorder confusingly in RTL. */}
          <div>
            {next.label && <div className="text-small font-bold text-ink-muted">{next.label}</div>}
            <p className="font-bold text-subheading leading-7">
              {courses.length} {courses.length === 1 ? "مقرر" : courses.length <= 10 ? "مقررات" : "مقرراً"} · {next.credits} ساعة
            </p>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="المقررات المقترحة">
            {courses.slice(0, 4).map((c) => (
              <li key={c.code} className="text-caption font-bold px-2.5 py-1 rounded-full bg-surface border border-line">
                {c.name}
              </li>
            ))}
            {courses.length > 4 && (
              <li dir="ltr" className="text-caption font-bold px-2.5 py-1 rounded-full text-ink-muted">+{courses.length - 4}</li>
            )}
          </ul>
        </>
      ) : (
        <p className="font-bold leading-7">{run.summary?.what || run.withheld_reason || "شوف تفاصيل وضعك في المرشد الأكاديمي."}</p>
      )}

      {highRisks.length > 0 && (
        <p className="flex items-start gap-2 text-small text-danger-ink leading-6">
          <AlertTriangle className="w-4 h-4 mt-1 shrink-0" aria-hidden />
          <span>
            {highRisks[0].message}
            {highRisks.length > 1 ? ` (+${highRisks.length - 1} تنبيه آخر)` : ""}
          </span>
        </p>
      )}

      <Link href="/advisor" prefetch={false} className="inline-flex items-center gap-1 text-small font-bold text-info-ink">
        لماذا؟ والخطة كاملة
        <ChevronLeft className="w-4 h-4" aria-hidden />
      </Link>
    </section>
  );
}
