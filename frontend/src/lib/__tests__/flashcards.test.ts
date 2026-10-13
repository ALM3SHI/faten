import { describe, expect, it } from "vitest";
import {
  advanceQueue,
  cardKey,
  cardsFromTerms,
  deckStats,
  dueCards,
  nextState,
  type CardState,
} from "@/lib/flashcards";

const TODAY = "2026-12-20";
const terms = [
  { term: "Neuron", definition: "وحدة حسابية" },
  { term: "Activation  function", definition: "ReLU" },
  { term: "neuron", definition: "مكرر" },
  { term: "Backpropagation", definition: "تحديث الأوزان" },
];

describe("cards", () => {
  it("one card per term, keyed case-insensitively", () => {
    const cards = cardsFromTerms(terms);
    expect(cards.map((c) => c.key)).toEqual(["neuron", "activation function", "backpropagation"]);
    expect(cardKey("  Activation   Function ")).toBe("activation function");
  });

  it("orders due cards hardest first, then new ones", () => {
    const reviews: Record<string, CardState> = {
      neuron: { box: 3, due: "2026-12-19", reviews: 3, lapses: 0 },
      backpropagation: { box: 1, due: "2026-12-20", reviews: 2, lapses: 1 },
      "activation function": { box: 2, due: "2026-12-25", reviews: 1, lapses: 0 },
    };
    const cards = cardsFromTerms([...terms, { term: "Loss", definition: "الخطأ" }], reviews);
    expect(dueCards(cards, TODAY).map((c) => c.key)).toEqual(["backpropagation", "neuron", "loss"]);
    expect(deckStats(cards, TODAY)).toEqual({ total: 4, due: 3, learned: 1, nextDue: "2026-12-25" });
  });
});

describe("spacing", () => {
  it("hard resets to box 1 (tomorrow), easy climbs, medium stays", () => {
    const s: CardState = { box: 3, due: TODAY, reviews: 4, lapses: 0 };
    expect(nextState(s, "hard", TODAY)).toEqual({ box: 1, due: "2026-12-21", reviews: 5, lapses: 1 });
    expect(nextState(s, "medium", TODAY)).toEqual({ box: 3, due: "2026-12-27", reviews: 5, lapses: 0 });
    expect(nextState(s, "easy", TODAY)).toEqual({ box: 4, due: "2027-01-03", reviews: 5, lapses: 0 });
    expect(nextState({ ...s, box: 5 }, "easy", TODAY).box).toBe(5);
  });

  it("new cards start in box 1 and hard does not count as a lapse", () => {
    expect(nextState(null, "easy", TODAY)).toEqual({ box: 2, due: "2026-12-23", reviews: 1, lapses: 0 });
    expect(nextState(null, "hard", TODAY).lapses).toBe(0);
  });

  it("hard cards come back later in the same session; others leave", () => {
    expect(advanceQueue(["a", "b", "c", "d"], "hard")).toEqual(["b", "c", "a", "d"]);
    expect(advanceQueue(["a", "b"], "hard")).toEqual(["b", "a"]);
    expect(advanceQueue(["a"], "hard")).toEqual(["a"]);
    expect(advanceQueue(["a", "b"], "easy")).toEqual(["b"]);
    expect(advanceQueue([], "medium")).toEqual([]);
  });
});
