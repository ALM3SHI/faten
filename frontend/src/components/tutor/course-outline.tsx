"use client";

import { CheckCircle2, Circle, CircleDot, Clock, FileText, Layers, RotateCcw } from "lucide-react";
import { Button } from "@/components/ds/button";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, masteredCount, type Lecture, type TopicStatus, type TutorState } from "@/lib/tutor";

const ICON: Record<TopicStatus, typeof Circle> = {
  not_started: Circle,
  in_progress: CircleDot,
  needs_review: RotateCcw,
  review_due: RotateCcw,
  mastered: CheckCircle2,
};

const TONE: Record<TopicStatus, string> = {
  not_started: "text-ink-muted",
  in_progress: "text-info-ink",
  needs_review: "text-warning-ink",
  review_due: "text-warning-ink",
  mastered: "text-success-ink",
};

/**
 * The lecture as a course: its units, how long it takes, what the student
 * will be able to do, and where they are. Shown beside the lesson on wide
 * screens (the topics drawer covers phones). Moving to a unit is the same
 * tutor action as in the drawer («goto»), so the learning state stays one.
 */
export function CourseOutline({
  lecture,
  state,
  busy,
  onGoto,
  className,
}: {
  lecture: Lecture;
  state: TutorState;
  busy: boolean;
  onGoto: (topicId: string) => void;
  className?: string;
}) {
  const { mastered, total } = masteredCount(state);
  const minutes = lecture.estMinutes ?? lecture.topics.reduce((a, t) => a + (t.est_minutes || 0), 0);
  const outcomes = [...lecture.topics]
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .map((t) => t.objectives?.[0])
    .filter(Boolean)
    .slice(0, 3) as string[];

  return (
    <aside className={cn("w-72 shrink-0 flex-col gap-3 overflow-y-auto pb-4", className)} aria-label="محتوى الدورة">
      <section className="rounded-card border-4 border-board-frame bg-board p-4 text-board-ink">
        <p className="chalk text-caption font-bold text-board-muted">دورة من محاضرتك</p>
        <h2 className="chalk mt-1 text-subheading font-bold leading-snug" dir="auto">{lecture.title}</h2>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat icon={Layers} value={total} label="وحدات" />
          <Stat icon={Clock} value={Math.max(5, Math.round(minutes / 5) * 5)} label="دقيقة" />
          <Stat icon={FileText} value={lecture.pageCount} label="صفحة" />
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-caption text-board-muted">
            <span>أتقنت</span>
            <span className="font-bold text-board-ink">
              {mastered} من {total}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-board-line" aria-hidden>
            <div className="h-full rounded-full bg-board-accent transition-all" style={{ width: `${total ? (mastered / total) * 100 : 0}%` }} />
          </div>
        </div>
      </section>

      {outcomes.length > 0 && (
        <section className="rounded-card border border-line bg-surface p-4">
          <h3 className="text-small font-bold">بنهاية الدورة تقدر:</h3>
          <ul className="mt-2 space-y-1.5 text-small leading-6 text-ink-muted">
            {outcomes.map((o) => (
              <li key={o} className="flex gap-2">
                <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-success-ink" aria-hidden />
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="rounded-card border border-line bg-surface p-2" aria-label="وحدات الدورة">
        <ol className="space-y-1">
          {lecture.topics.map((t, i) => {
            const status = state.topics[t.id]?.status ?? "not_started";
            const Icon = ICON[status];
            const current = state.currentTopicId === t.id && state.phase === "topic";
            const canGo = !current && !busy && state.phase !== "final";
            return (
              <li key={t.id}>
                <Button
                  variant="bare"
                  type="button"
                  disabled={!canGo}
                  aria-current={current ? "step" : undefined}
                  onClick={() => onGoto(t.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-start transition-colors",
                    current ? "bg-info-soft" : "hover:bg-surface-sunken disabled:hover:bg-transparent",
                  )}
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center">
                    <Icon className={cn("size-5", TONE[status])} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-small font-bold leading-6" dir="auto">
                      {i + 1}. {t.title}
                    </span>
                    <span className="block text-caption text-ink-muted">
                      {current && state.segments > 0 && typeof state.segment === "number" && state.segment >= 0
                        ? `الجزء ${Math.min(state.segment + 1, state.segments)} من ${state.segments} · `
                        : ""}
                      {STATUS_LABEL[status]} · ~{t.est_minutes} د
                    </span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Circle; value: number; label: string }) {
  return (
    <div className="rounded-control bg-board-line/40 px-1 py-2">
      <Icon className="mx-auto size-3.5 text-board-muted" aria-hidden />
      <span className="nums mt-0.5 block text-body font-bold leading-tight">{value}</span>
      <span className="block text-caption text-board-muted">{label}</span>
    </div>
  );
}
