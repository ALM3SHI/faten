"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Dumbbell, Loader2, NotebookPen } from "lucide-react";
import { BotMarkdown } from "@/components/bot-markdown";
import { Button } from "@/components/ds/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatDayShort } from "@/lib/format-date";
import { loadMistakes, type Mistake } from "@/lib/tutor";
import { cn } from "@/lib/utils";

function RightAnswer({ m, onSlide }: { m: Mistake; onSlide: (p: number) => void }) {
  if (m.correctText) return <span dir="auto">{m.correctText}</span>;
  if (m.correctOrder) return <span dir="auto">{m.correctOrder.join(" ← ")}</span>;
  if (m.correctPairs) return <span>{m.correctPairs.map((p) => `${p.left} ← ${p.right}`).join("؛ ")}</span>;
  if (m.modelAnswer) return <BotMarkdown content={m.modelAnswer} onSlide={onSlide} />;
  return null;
}

/**
 * «دفتر أخطائي»: every question missed on the first try in this lecture —
 * what the student answered, what is right and why, the misunderstanding
 * behind it. A mistake closes once a later answer on the same idea is right;
 * «تدرّب» asks about the open ones again, in new questions where there are.
 */
export function MistakesDialog({
  lectureId,
  open,
  busy,
  onClose,
  onPractice,
  onSlide,
}: {
  lectureId: string;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onPractice: () => void;
  onSlide: (p: number) => void;
}) {
  const [data, setData] = useState<{ mistakes: Mistake[]; open: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadMistakes(lectureId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "تعذّر فتح الدفتر."));
    return () => {
      alive = false;
    };
  }, [open, lectureId]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl w-[calc(100%-1rem)] max-h-[85vh] overflow-y-auto p-5 gap-3" dir="rtl">
        <DialogTitle className="flex items-center gap-2 text-body font-bold">
          <NotebookPen className="size-5 text-info-ink" aria-hidden /> دفتر أخطائي
        </DialogTitle>
        <DialogDescription className="text-small leading-6 text-ink-muted">
          كل سؤال أخطأت فيه من أول مرة في هذه المحاضرة. يُغلق الخطأ عندما تجيب بعدها إجابة صحيحة عن نفس الفكرة.
        </DialogDescription>

        {!data && !error && (
          <div className="flex justify-center py-8 text-ink-muted" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            <span className="sr-only">جاري فتح الدفتر…</span>
          </div>
        )}
        {error && <p className="text-small text-danger-ink" role="alert">{error}</p>}
        {data && data.mistakes.length === 0 && (
          <p className="rounded-card border border-line bg-surface-sunken p-4 text-center text-small">ما في أخطاء مسجّلة بعد في هذه المحاضرة.</p>
        )}

        {data && data.open > 0 && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              onClose();
              onPractice();
            }}
            className="self-start"
          >
            <Dumbbell aria-hidden /> تدرّب على أخطائك المفتوحة ({data.open})
          </Button>
        )}

        {data && data.mistakes.length > 0 && (
          <ul className="space-y-3" aria-label="الأخطاء">
            {data.mistakes.map((m) => (
              <li key={m.qid} className={cn("rounded-card border p-3.5 text-small leading-7", m.fixed ? "border-success-line bg-success-soft/40" : "border-line bg-surface")}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-caption font-bold text-ink-muted">
                  <span>{m.topicTitle}</span>
                  {m.ts && <span>· {formatDayShort(m.ts)}</span>}
                  {m.fixed ? (
                    <span className="inline-flex items-center gap-1 text-success-ink">
                      <CheckCircle2 className="size-3.5" aria-hidden /> تجاوزته
                    </span>
                  ) : (
                    <span className="text-warning-ink">مفتوح</span>
                  )}
                </div>
                <div className="font-bold" dir="auto">
                  <BotMarkdown content={m.prompt} onSlide={onSlide} />
                </div>
                {m.answer && (
                  <p className="mt-1">
                    <span className="font-bold text-danger-ink">إجابتك: </span>
                    <span dir="auto">{m.answer}</span>
                  </p>
                )}
                <div className="mt-1">
                  <span className="font-bold text-success-ink">الصحيح: </span>
                  <RightAnswer m={m} onSlide={onSlide} />
                </div>
                {m.misconception && (
                  <p className="mt-1">
                    <span className="font-bold">ما يبدو أنه حصل: </span>
                    {m.misconception}
                  </p>
                )}
                {m.explanation && (
                  <div className="mt-1.5 border-t border-line pt-1.5 text-ink-muted">
                    <BotMarkdown content={m.explanation} onSlide={onSlide} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
