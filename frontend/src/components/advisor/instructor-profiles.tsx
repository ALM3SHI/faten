"use client";

/**
 * Instructor profiles from the team's compiled student reviews: a verdict,
 * recurring patterns, theory/practical differences, a survival guide and one
 * recommendation line. Comments themselves are never shown.
 */

import { ChevronDown, Lightbulb, ThumbsDown, ThumbsUp, UserRound } from "lucide-react";
import { Button } from "@/components/ds/button";
import type { InstructorMap, InstructorProfile, ProfileVerdict } from "@/lib/advisor";

const VERDICT_TONE: Record<ProfileVerdict, string> = {
  recommended: "bg-success-soft text-success-ink border-success-line",
  recommended_if: "bg-info-soft text-info-ink border-info-line",
  mixed: "bg-warning-soft text-warning-ink border-warning-line",
  avoid_if_alternative: "bg-danger-soft text-danger-ink border-danger-line",
};

export function VerdictBadge({ verdict, label }: { verdict: ProfileVerdict; label: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 h-6 text-caption font-bold ${VERDICT_TONE[verdict]}`}>{label}</span>;
}

function List({ title, items, icon }: { title: string; items: string[]; icon?: React.ReactNode }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <p className="font-bold text-small flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      <ul className="list-disc ps-5 text-small leading-7 text-ink">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

/** «محمد علي عيد الغامدي» → «محمد الغامدي». */
export const shortName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : full.trim();
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function ProfileCard({ p }: { p: InstructorProfile }) {
  const c = p.course;
  return (
    <article className="rounded-card border border-line p-4 space-y-3" aria-label={p.name}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-bold flex items-center gap-2">
            <UserRound className="w-4 h-4 text-info-ink" aria-hidden />
            {p.name}
          </h4>
          {p.department && <p className="text-caption text-ink-muted">{p.department}</p>}
        </div>
        <VerdictBadge verdict={p.verdict} label={p.verdict_label} />
      </header>

      <p className="text-small leading-7">{p.headline}</p>
      <p className="text-small font-bold leading-7 rounded-control bg-info-soft border border-info-line p-3 flex gap-2">
        <Lightbulb className="w-4 h-4 mt-1 shrink-0 text-info-ink" aria-hidden />
        {p.recommendation}
      </p>

      <p className="text-caption text-ink-muted leading-6">
        {c ? (
          <>
            في هذا المقرر: {c.reviews} تقييم · متوسط {c.average ?? "—"}/5 · إيجابية {pct(c.positive_share)} · {c.recent_reviews} خلال آخر سنتين
            {c.thin && <b className="text-warning-ink"> · تقييمات قليلة</b>}
            {c.confidence === "ambiguous" && " · ربط المقرر غير مؤكد"}
          </>
        ) : null}
        {c ? " — " : ""}
        إجمالاً: {p.overall.reviews} تقييم، متوسط {p.overall.average ?? "—"}/5
        {!p.data.complete && ` (حُلل ${p.data.reviews_analyzed} من ${p.data.reviews_stated} لأن الملف ناقص)`}
      </p>

      {p.badges.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="أكثر الصفات تكراراً">
          {p.badges.map((b) => (
            <li key={b.label} className="rounded-full bg-surface-sunken border border-line px-2.5 h-6 inline-flex items-center text-caption">
              {b.label} · {pct(b.share)}
            </li>
          ))}
        </ul>
      )}

      <details className="group">
        <summary className="cursor-pointer text-small font-bold flex items-center gap-1.5 list-none">
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden />
          التفاصيل ودليل النجاة
        </summary>
        <div className="mt-3 space-y-4">
          {(p.fits.length > 0 || p.not_for.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <List title="يناسب" items={p.fits} />
              <List title="لا يناسب" items={p.not_for} />
            </div>
          )}
          <List title="الإيجابيات المتكررة" items={p.strengths} icon={<ThumbsUp className="w-4 h-4 text-success-ink" aria-hidden />} />
          <List title="السلبيات المتكررة" items={p.weaknesses} icon={<ThumbsDown className="w-4 h-4 text-danger-ink" aria-hidden />} />
          {p.modes.length > 0 && (
            <div className="space-y-1">
              <p className="font-bold text-small">الفرق بين النظري والعملي والتدريب</p>
              <dl className="text-small leading-7 space-y-1">
                {p.modes.map((m) => (
                  <div key={m.context}>
                    <dt className="inline font-bold">{m.context}: </dt>
                    <dd className="inline text-ink">{m.pattern}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <List title="دليل النجاة" items={p.survival} />
          {p.caveats.length > 0 && (
            <ul className="text-caption text-warning-ink list-disc ps-5 leading-6">
              {p.caveats.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </article>
  );
}

export function ProgramInstructorMap({ map, onPick }: { map: InstructorMap; onPick: (code: string) => void }) {
  if (!map.courses.length) return null;
  return (
    <details className="rounded-card border border-line p-4">
      <summary className="cursor-pointer font-bold text-small">
        مقررات خطتك التي لدينا تحليل لمحاضريها ({map.covered} من {map.plan_courses})
      </summary>
      <ul className="mt-3 space-y-2 text-small">
        {map.courses.map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-2">
            <Button variant="bare" type="button" onClick={() => onPick(c.code)} className="font-bold underline underline-offset-4">
              <bdi dir="ltr">{c.code}</bdi> {c.name}
            </Button>
            <span className="text-ink-muted">المستوى {c.level}:</span>
            {c.instructors.map((i) => (
              <span key={i.id} className="inline-flex items-center gap-1">
                {i.short_name ?? shortName(i.name)}
                <VerdictBadge verdict={i.verdict} label={i.verdict_label} />
              </span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}
