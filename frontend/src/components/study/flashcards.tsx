"use client";

import { useMemo, useState } from "react";
import { Button as DsButton } from "@/components/ds/button";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dayKey, daysBetween, whenLabel } from "@/lib/exams";
import { advanceQueue, cardsFromTerms, deckStats, dueCards, type Rating } from "@/lib/flashcards";
import { useStudyStore, type StudyPack } from "@/store/studyStore";

const RATINGS: { rating: Rating; label: string; hint: string; tone: string }[] = [
  { rating: "hard", label: "صعبة", hint: "ترجع لك بعد بطاقتين وبكرة", tone: "border-danger-line hover:bg-danger-soft text-danger-ink " },
  { rating: "medium", label: "متوسطة", hint: "نفس الفترة", tone: "border-warning-line hover:bg-warning-soft text-warning-ink " },
  { rating: "easy", label: "سهلة", hint: "فترة أطول", tone: "border-success-line hover:bg-success-soft text-success-ink " },
];

/** Review cards built from the pack's key terms, with spaced repetition. */
export function Flashcards({ pack }: { pack: StudyPack }) {
  const reviewCard = useStudyStore((s) => s.reviewCard);
  const today = dayKey(new Date());
  const cards = useMemo(() => cardsFromTerms(pack.key_terms, pack.reviews), [pack.key_terms, pack.reviews]);
  // Today's queue is fixed when the session starts; ratings reorder it.
  const [queue, setQueue] = useState<string[]>(() => dueCards(cards, today).map((c) => c.key));
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  const stats = deckStats(cards, today);
  const current = cards.find((c) => c.key === queue[0]);

  const rate = (rating: Rating) => {
    if (!current) return;
    reviewCard(pack.id, current.key, rating, today);
    setQueue((q) => advanceQueue(q, rating));
    setFlipped(false);
    setReviewed((n) => n + 1);
  };

  if (cards.length === 0) return <p className="text-small text-ink-muted">لا توجد مصطلحات لعمل بطاقات منها.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-small">
        <span className="font-bold">
          باقي اليوم: {queue.length} من {stats.total} بطاقة
        </span>
        <span className="text-ink-muted">حفظتها: {stats.learned}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden" aria-hidden>
        <div
          className="h-full bg-brand transition-all"
          style={{ width: `${(reviewed / Math.max(1, reviewed + queue.length)) * 100}%` }}
        />
      </div>

      {!current ? (
        <Card className="border border-line bg-surface shadow-card rounded-card p-8 text-center space-y-3">
          <div className="text-title" aria-hidden>🎉</div>
          <h3 className="text-subheading font-bold">خلصت مراجعة اليوم</h3>
          <p className="text-small text-ink-muted">
            {stats.nextDue
              ? `البطاقات الجاية ${whenLabel(daysBetween(today, stats.nextDue))}. الصعبة ترجع أبكر من السهلة.`
              : "رجعتلك البطاقات كلها — راجعها مرة ثانية متى ما حبيت."}
          </p>
          <Button
            variant="ghost"
            className="gap-2 rounded-control"
            onClick={() => {
              setQueue(cards.map((c) => c.key));
              setReviewed(0);
            }}
          >
            <RotateCcw className="w-4 h-4" aria-hidden /> راجع كل البطاقات الآن
          </Button>
        </Card>
      ) : (
        <>
          <DsButton variant="bare"
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? "إخفاء الإجابة" : "إظهار الإجابة"}
            className={cn(
              "w-full min-h-[220px] rounded-card border p-8 flex flex-col items-center justify-center gap-4 text-center transition-colors",
              flipped ? "border-info-line bg-info-soft" : "border-line bg-surface hover:border-info-line",
            )}
          >
            <span className="text-heading font-bold text-info-ink" dir="auto">{current.front}</span>
            {flipped ? (
              <span className="text-body leading-8 text-ink max-w-xl" dir="auto">{current.back}</span>
            ) : (
              <span className="text-caption text-ink-muted">تذكّر المعنى ثم اضغط لتشوف الإجابة</span>
            )}
          </DsButton>

          {flipped ? (
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="كيف كانت البطاقة؟">
              {RATINGS.map((r) => (
                <DsButton variant="bare"
                  key={r.rating}
                  type="button"
                  onClick={() => rate(r.rating)}
                  className={cn("rounded-card border px-2 py-3 text-center transition-colors", r.tone)}
                >
                  <span className="block font-bold">{r.label}</span>
                  <span className="block text-caption opacity-80 mt-0.5">{r.hint}</span>
                </DsButton>
              ))}
            </div>
          ) : (
            <Button onClick={() => setFlipped(true)} className="w-full h-11 rounded-control bg-brand hover:bg-brand-hover text-on-brand">
              أظهر الإجابة
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** "3 بطاقات للمراجعة" for the pack list. */
export function dueLabel(pack: StudyPack): string | null {
  const cards = cardsFromTerms(pack.key_terms, pack.reviews);
  const n = deckStats(cards, dayKey(new Date())).due;
  if (!cards.length || !n) return null;
  return n === 1 ? "بطاقة للمراجعة" : n === 2 ? "بطاقتان للمراجعة" : `${n} بطاقات للمراجعة`;
}
