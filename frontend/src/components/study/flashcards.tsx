"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dayKey, daysBetween, whenLabel } from "@/lib/exams";
import { advanceQueue, cardsFromTerms, deckStats, dueCards, type Rating } from "@/lib/flashcards";
import { useStudyStore, type StudyPack } from "@/store/studyStore";

const RATINGS: { rating: Rating; label: string; hint: string; tone: string }[] = [
  { rating: "hard", label: "صعبة", hint: "ترجع لك بعد بطاقتين وبكرة", tone: "border-rose-500/40 hover:bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  { rating: "medium", label: "متوسطة", hint: "نفس الفترة", tone: "border-amber-500/40 hover:bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  { rating: "easy", label: "سهلة", hint: "فترة أطول", tone: "border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
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

  if (cards.length === 0) return <p className="text-sm text-muted-foreground">لا توجد مصطلحات لعمل بطاقات منها.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="font-bold">
          باقي اليوم: {queue.length} من {stats.total} بطاقة
        </span>
        <span className="text-muted-foreground">حفظتها: {stats.learned}</span>
      </div>
      <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden" aria-hidden>
        <div
          className="h-full bg-uqu-accent transition-all"
          style={{ width: `${(reviewed / Math.max(1, reviewed + queue.length)) * 100}%` }}
        />
      </div>

      {!current ? (
        <Card className="glass border-foreground/10 rounded-3xl p-8 text-center space-y-3">
          <div className="text-3xl" aria-hidden>🎉</div>
          <h3 className="text-lg font-black">خلصت مراجعة اليوم</h3>
          <p className="text-sm text-muted-foreground">
            {stats.nextDue
              ? `البطاقات الجاية ${whenLabel(daysBetween(today, stats.nextDue))}. الصعبة ترجع أبكر من السهلة.`
              : "رجعتلك البطاقات كلها — راجعها مرة ثانية متى ما حبيت."}
          </p>
          <Button
            variant="ghost"
            className="gap-2 rounded-xl"
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
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? "إخفاء الإجابة" : "إظهار الإجابة"}
            className={cn(
              "w-full min-h-[220px] rounded-3xl border p-8 flex flex-col items-center justify-center gap-4 text-center transition-colors",
              flipped ? "border-uqu-accent/40 bg-uqu-accent/[0.06]" : "border-foreground/10 bg-card hover:border-uqu-accent/30",
            )}
          >
            <span className="text-2xl font-black text-uqu-accent" dir="auto">{current.front}</span>
            {flipped ? (
              <span className="text-base leading-8 text-foreground/90 max-w-xl" dir="auto">{current.back}</span>
            ) : (
              <span className="text-xs text-muted-foreground">تذكّر المعنى ثم اضغط لتشوف الإجابة</span>
            )}
          </button>

          {flipped ? (
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="كيف كانت البطاقة؟">
              {RATINGS.map((r) => (
                <button
                  key={r.rating}
                  type="button"
                  onClick={() => rate(r.rating)}
                  className={cn("rounded-2xl border px-2 py-3 text-center transition-colors", r.tone)}
                >
                  <span className="block font-black">{r.label}</span>
                  <span className="block text-[11px] opacity-80 mt-0.5">{r.hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <Button onClick={() => setFlipped(true)} className="w-full h-11 rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white">
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
