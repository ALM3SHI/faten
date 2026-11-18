"use client";

import { CheckCircle2, ChevronDown, Circle, CircleDot, RotateCcw, Trophy } from "lucide-react";
import { Button } from "@/components/ds/button";
import { count } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { Lecture, TopicStatus, TutorState } from "@/lib/tutor";

/**
 * One unit's state in words and a shape a student reads at a glance:
 *   ✓ green   mastered (a review may be due — that is said in words, not by
 *             painting a mastered unit orange)
 *   ↻ amber   not mastered yet after trying: needs another pass
 *   ◉ blue    being studied
 *   ○ grey    not started
 */
function unitState(status: TopicStatus): { Icon: typeof Circle; tone: string; label: string } {
  switch (status) {
    case "mastered":
      return { Icon: CheckCircle2, tone: "text-success-ink", label: "متقن" };
    case "review_due":
      return { Icon: CheckCircle2, tone: "text-success-ink", label: "متقن · حان وقت مراجعته" };
    case "needs_review":
      return { Icon: RotateCcw, tone: "text-warning-ink", label: "يحتاج جولة ثانية" };
    case "in_progress":
      return { Icon: CircleDot, tone: "text-info-ink", label: "قيد الدراسة" };
    default:
      return { Icon: Circle, tone: "text-ink-muted", label: "لم يبدأ" };
  }
}

/**
 * The course menu (focus mode): what the lecture covers and where the student
 * is. Collapsible beside the lesson on wide screens; the same list opens as a
 * drawer on phones (TopicPanel). Progress itself lives once, in the course
 * bar — not repeated here.
 */
export function CourseOutline({
  lecture,
  state,
  busy,
  onGoto,
  onFinal,
  className,
}: {
  lecture: Lecture;
  state: TutorState;
  busy: boolean;
  onGoto: (topicId: string) => void;
  onFinal?: () => void;
  className?: string;
}) {
  const minutes = lecture.estMinutes ?? lecture.topics.reduce((a, t) => a + (t.est_minutes || 0), 0);
  const outcomes = [...lecture.topics]
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .map((t) => t.objectives?.[0])
    .filter(Boolean)
    .slice(0, 4) as string[];
  const finalScore = state.final?.result?.score;

  return (
    <aside className={cn("w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface", className)} aria-label="محتوى الدورة">
      <div className="border-b border-line px-5 py-4">
        <p className="text-caption font-bold text-ink-muted">دورة من محاضرتك</p>
        <p className="nums mt-1 text-small text-ink-muted">
          {count(lecture.topics.length, "وحدة", "وحدات", "وحدتان")} · {Math.max(5, Math.round(minutes / 5) * 5)} دقيقة · {count(lecture.pageCount, "صفحة", "صفحات", "صفحتان")}
        </p>
        {outcomes.length > 0 && (
          <details className="group mt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-control text-small font-bold text-ink hover:text-info-ink [&::-webkit-details-marker]:hidden">
              بنهاية الدورة تقدر
              <ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
            </summary>
            <ul className="mt-2 space-y-1.5 text-small leading-6 text-ink-muted">
              {outcomes.map((o) => (
                <li key={o} className="flex gap-2">
                  <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-success-ink" aria-hidden />
                  <span dir="auto">{o}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <nav aria-label="وحدات الدورة" className="flex-1 py-2">
        <ol>
          {lecture.topics.map((t, i) => {
            const status = state.topics[t.id]?.status ?? "not_started";
            const { Icon, tone, label } = unitState(status);
            const current = state.currentTopicId === t.id && (state.phase === "topic" || state.phase === "review");
            const canGo = !current && !busy && state.phase !== "final";
            return (
              <li key={t.id}>
                <Button
                  variant="bare"
                  type="button"
                  // not `disabled`: that would fade the unit you are in; it just does nothing
                  aria-disabled={!canGo}
                  aria-current={current ? "step" : undefined}
                  onClick={() => canGo && onGoto(t.id)}
                  className={cn(
                    "relative flex h-auto w-full items-start gap-3 rounded-none px-5 py-3 text-start whitespace-normal transition-colors",
                    current ? "cursor-default bg-info-soft" : canGo ? "hover:bg-surface-sunken" : "cursor-default",
                  )}
                >
                  {/* the unit you are in is marked on its edge, like a bookmark */}
                  {current && <span aria-hidden className="absolute inset-y-0 right-0 w-1 bg-brand" />}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-small leading-6", current ? "font-bold text-ink" : "font-semibold text-ink")} dir="auto">
                      {i + 1}. {t.title}
                    </span>
                    <span className="nums block text-caption text-ink-muted">
                      {current && state.segments > 0 && typeof state.segment === "number" && state.segment >= 0
                        ? `الجزء ${Math.min(state.segment + 1, state.segments)} من ${state.segments} · `
                        : ""}
                      {label} · ~{t.est_minutes} د
                    </span>
                  </span>
                  <Icon className={cn("mt-1 size-5 shrink-0", tone)} aria-hidden />
                </Button>
              </li>
            );
          })}
          <li className="mt-1 border-t border-line">
            <Button
              variant="bare"
              type="button"
              disabled={busy || !onFinal || !(state.phase === "final_ready" || state.phase === "done")}
              onClick={onFinal}
              className="flex h-auto w-full items-start gap-3 rounded-none px-5 py-3 text-start whitespace-normal hover:bg-surface-sunken disabled:opacity-100 disabled:hover:bg-transparent"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-small font-semibold leading-6">الاختبار الشامل</span>
                <span className="nums block text-caption text-ink-muted">
                  {typeof finalScore === "number"
                    ? `نتيجتك ${Math.round(finalScore * 100)}%`
                    : state.phase === "final"
                      ? "قيد الحل"
                      : state.phase === "final_ready"
                        ? "جاهز لك الحين"
                        : "يفتح بعد ما تمر على الوحدات"}
                </span>
              </span>
              <Trophy className={cn("mt-1 size-5 shrink-0", typeof finalScore === "number" ? "text-success-ink" : "text-ink-muted")} aria-hidden />
            </Button>
          </li>
        </ol>
      </nav>
    </aside>
  );
}
