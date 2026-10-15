"use client";

/**
 * Instructor profiles from the team's compiled student reviews: a verdict,
 * recurring patterns, theory/practical differences, a survival guide and one
 * recommendation line. Comments themselves are never shown.
 */

import { ChevronDown, Lightbulb, ThumbsDown, ThumbsUp, UserRound } from "lucide-react";
import type { InstructorMap, InstructorProfile, ProfileVerdict } from "@/lib/advisor";

const VERDICT_TONE: Record<ProfileVerdict, string> = {
  recommended: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  recommended_if: "bg-uqu-accent/10 text-uqu-accent border-uqu-accent/30",
  mixed: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30",
  avoid_if_alternative: "bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-500/30",
};

export function VerdictBadge({ verdict, label }: { verdict: ProfileVerdict; label: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 h-6 text-xs font-bold ${VERDICT_TONE[verdict]}`}>{label}</span>;
}

function List({ title, items, icon }: { title: string; items: string[]; icon?: React.ReactNode }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <p className="font-bold text-sm flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      <ul className="list-disc ps-5 text-sm leading-7 text-foreground/90">
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
    <article className="rounded-2xl border border-foreground/10 p-4 space-y-3" aria-label={p.name}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-black flex items-center gap-2">
            <UserRound className="w-4 h-4 text-uqu-accent" aria-hidden />
            {p.name}
          </h4>
          {p.department && <p className="text-xs text-muted-foreground">{p.department}</p>}
        </div>
        <VerdictBadge verdict={p.verdict} label={p.verdict_label} />
      </header>

      <p className="text-sm leading-7">{p.headline}</p>
      <p className="text-sm font-bold leading-7 rounded-xl bg-uqu-accent/5 border border-uqu-accent/20 p-3 flex gap-2">
        <Lightbulb className="w-4 h-4 mt-1 shrink-0 text-uqu-accent" aria-hidden />
        {p.recommendation}
      </p>

      <p className="text-xs text-muted-foreground leading-6">
        {c ? (
          <>
            في هذا المقرر: {c.reviews} تقييم · متوسط {c.average ?? "—"}/5 · إيجابية {pct(c.positive_share)} · {c.recent_reviews} خلال آخر سنتين
            {c.thin && <b className="text-amber-700 dark:text-amber-300"> · تقييمات قليلة</b>}
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
            <li key={b.label} className="rounded-full bg-foreground/5 border border-foreground/10 px-2.5 h-6 inline-flex items-center text-xs">
              {b.label} · {pct(b.share)}
            </li>
          ))}
        </ul>
      )}

      <details className="group">
        <summary className="cursor-pointer text-sm font-bold flex items-center gap-1.5 list-none">
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
          <List title="الإيجابيات المتكررة" items={p.strengths} icon={<ThumbsUp className="w-4 h-4 text-emerald-600" aria-hidden />} />
          <List title="السلبيات المتكررة" items={p.weaknesses} icon={<ThumbsDown className="w-4 h-4 text-rose-600" aria-hidden />} />
          {p.modes.length > 0 && (
            <div className="space-y-1">
              <p className="font-bold text-sm">الفرق بين النظري والعملي والتدريب</p>
              <dl className="text-sm leading-7 space-y-1">
                {p.modes.map((m) => (
                  <div key={m.context}>
                    <dt className="inline font-bold">{m.context}: </dt>
                    <dd className="inline text-foreground/90">{m.pattern}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <List title="دليل النجاة" items={p.survival} />
          {p.caveats.length > 0 && (
            <ul className="text-xs text-amber-800 dark:text-amber-300 list-disc ps-5 leading-6">
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
    <details className="rounded-2xl border border-foreground/10 p-4">
      <summary className="cursor-pointer font-bold text-sm">
        مقررات خطتك التي لدينا تحليل لمحاضريها ({map.covered} من {map.plan_courses})
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {map.courses.map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onPick(c.code)} className="font-bold underline underline-offset-4">
              <bdi dir="ltr">{c.code}</bdi> {c.name}
            </button>
            <span className="text-muted-foreground">المستوى {c.level}:</span>
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
