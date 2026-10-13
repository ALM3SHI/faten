/**
 * Review cards from a study pack's key terms, with simple spaced repetition
 * (Leitner boxes):
 *
 *   box 1 → again tomorrow · box 2 → 3 days · box 3 → 7 days · box 4 → 14 days · box 5 → 30 days
 *
 *   "صعبة"   → back to box 1 and shown again a couple of cards later today
 *   "متوسطة" → stays in its box, due again after that box's interval
 *   "سهلة"   → moves up one box (longer wait)
 *
 * Hard cards therefore come back far more often than easy ones. Progress
 * is saved per pack (StudyPack.reviews), so it syncs with the pack.
 */

import { addDays } from "@/lib/exams";

export type Rating = "hard" | "medium" | "easy";

export interface CardState {
  box: number;
  /** YYYY-MM-DD the card is due again. */
  due: string;
  reviews: number;
  lapses: number;
}

export interface Flashcard {
  key: string;
  front: string;
  back: string;
  state: CardState | null;
}

export const BOX_INTERVAL_DAYS = [1, 3, 7, 14, 30];
export const MAX_BOX = BOX_INTERVAL_DAYS.length;
/** How many cards later a "hard" card is shown again in the same session. */
export const HARD_REQUEUE_GAP = 2;

/** Stable id for a term (survives definition edits and re-ordering). */
export function cardKey(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

export function cardsFromTerms(
  terms: { term: string; definition: string }[],
  reviews: Record<string, CardState> = {},
): Flashcard[] {
  const seen = new Set<string>();
  const cards: Flashcard[] = [];
  for (const t of terms) {
    const key = cardKey(t.term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cards.push({ key, front: t.term, back: t.definition, state: reviews[key] ?? null });
  }
  return cards;
}

export function isDue(card: Flashcard, today: string): boolean {
  return !card.state || card.state.due <= today;
}

/** Cards to study today: due ones first by lowest box (hardest), then new ones. */
export function dueCards(cards: Flashcard[], today: string): Flashcard[] {
  const due = cards.filter((c) => c.state && c.state.due <= today);
  const fresh = cards.filter((c) => !c.state);
  due.sort((a, b) => a.state!.box - b.state!.box || a.state!.due.localeCompare(b.state!.due));
  return [...due, ...fresh];
}

export function nextState(prev: CardState | null, rating: Rating, today: string): CardState {
  const box = prev?.box ?? 1;
  const nextBox = rating === "hard" ? 1 : rating === "easy" ? Math.min(MAX_BOX, box + 1) : box;
  return {
    box: nextBox,
    due: addDays(today, BOX_INTERVAL_DAYS[nextBox - 1]),
    reviews: (prev?.reviews ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (rating === "hard" && prev ? 1 : 0),
  };
}

/**
 * Session queue after rating the card at the front: hard cards go back in
 * HARD_REQUEUE_GAP positions later; the others leave today's queue.
 */
export function advanceQueue(queue: string[], rating: Rating): string[] {
  const [current, ...rest] = queue;
  if (current === undefined) return [];
  if (rating !== "hard") return rest;
  const at = Math.min(HARD_REQUEUE_GAP, rest.length);
  return [...rest.slice(0, at), current, ...rest.slice(at)];
}

/** Counts for the deck header. */
export function deckStats(cards: Flashcard[], today: string) {
  const due = cards.filter((c) => isDue(c, today)).length;
  const learned = cards.filter((c) => (c.state?.box ?? 0) >= 3).length;
  const nextDue = cards
    .filter((c) => c.state && c.state.due > today)
    .map((c) => c.state!.due)
    .sort()[0] ?? null;
  return { total: cards.length, due, learned, nextDue };
}
