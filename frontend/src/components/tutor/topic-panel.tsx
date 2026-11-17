"use client";

import { useEffect } from "react";
import { Button } from "@/components/ds/button";
import { CheckCircle2, Circle, CircleDot, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, pct, type Lecture, type TopicStatus, type TutorState } from "@/lib/tutor";
import { formatDay } from "@/components/tutor/blocks";

const ICON: Record<TopicStatus, typeof Circle> = {
  not_started: Circle,
  in_progress: CircleDot,
  needs_review: RotateCcw,
  review_due: RotateCcw,
  mastered: CheckCircle2,
};

/**
 * Topics and their mastery — opened on demand so the lesson stays the focus.
 * Each row explains its status (score, confidence, what is still missing).
 */
export function TopicPanel({
  open,
  onClose,
  lecture,
  state,
  busy,
  onGoto,
  onReview,
}: {
  open: boolean;
  onClose: () => void;
  lecture: Lecture;
  state: TutorState;
  busy: boolean;
  onGoto: (topicId: string) => void;
  onReview: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl" role="dialog" aria-modal="true" aria-label="موضوعات المحاضرة">
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative mr-auto ml-0 h-full w-[min(420px,92vw)] bg-surface border-r border-line shadow-card flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-line">
          <div className="min-w-0">
            <h2 className="font-bold truncate">{lecture.title}</h2>
            <p className="text-small text-ink-muted">نقاط النشاط: {state.points} — منفصلة عن درجة الإتقان</p>
          </div>
          <Button variant="bare" type="button" onClick={onClose} className="p-2 rounded-control hover:bg-surface-sunken" aria-label="إغلاق" autoFocus>
            <X className="w-5 h-5" />
          </Button>
        </div>
        {state.reviewDue.length > 0 && (
          <div className="mx-4 mt-4 rounded-control border border-info-line bg-info-soft p-3 text-small flex items-center justify-between gap-3">
            <span>{state.reviewDue.length} موضوع حان وقت مراجعته حتى لا يُنسى.</span>
            <Button variant="bare" type="button" disabled={busy} onClick={onReview} className="h-8 px-3 rounded-control bg-brand text-on-brand text-small font-bold disabled:opacity-50">
              راجع الآن
            </Button>
          </div>
        )}
        <ol className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {lecture.topics.map((t, i) => {
            const p = state.topics[t.id];
            const status = p?.status ?? "not_started";
            const Icon = ICON[status];
            const current = state.currentTopicId === t.id && state.phase === "topic";
            return (
              <li key={t.id} className={cn("rounded-card border p-3", current ? "border-info-line bg-info-soft" : "border-line")}>
                <div className="flex items-start gap-2.5">
                  <Icon className={cn("w-5 h-5 mt-0.5 shrink-0", status === "mastered" ? "text-success-ink" : status === "in_progress" ? "text-info-ink" : status === "not_started" ? "text-ink-muted" : "text-warning-ink")} aria-hidden />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-body leading-6" dir="auto">{i + 1}. {t.title}</div>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className={cn("text-caption font-bold px-2 py-0.5 rounded-full border", STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>
                      {p && p.attempts > 0 && <span className="text-caption text-ink-muted">إتقان {pct(p.score)} · ثقة {pct(p.confidence)} · {p.correct}/{p.attempts}</span>}
                    </div>
                    {p?.reviewDue && (status === "mastered" || status === "review_due") && (
                      <div className="text-caption text-ink-muted mt-1">المراجعة: {formatDay(p.reviewDue)}</div>
                    )}
                    {p && p.attempts > 0 && !p.mastered && p.missing.length > 0 && (
                      <details className="mt-1.5 text-small">
                        <summary className="cursor-pointer text-ink-muted">ما الذي ينقص للإتقان؟</summary>
                        <ul className="list-disc pr-4 mt-1 space-y-0.5">{p.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                      </details>
                    )}
                  </div>
                  {!current && state.phase !== "final" && (
                    <Button variant="bare"
                      type="button"
                      disabled={busy}
                      onClick={() => onGoto(t.id)}
                      className="text-small font-bold text-info-ink hover:underline shrink-0 disabled:opacity-50"
                    >
                      {status === "not_started" ? "ابدأه" : "ادرسه"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="p-4 text-caption leading-5 text-ink-muted border-t border-line">
          يُحسب الموضوع متقناً بقواعد واضحة: 80% على الأقل من الإجابات الموزونة، 3 أسئلة تقييم أو أكثر، نجاح في سؤال تطبيقي دون تلميح وفي سؤال متوسط أو صعب، وأدلة كافية ومتنوعة. مشاهدة الشرح أو البطاقات وحدها لا تكفي.
        </p>
      </aside>
    </div>
  );
}
