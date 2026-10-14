/**
 * Recent study packs generated from lecture PDFs. Persisted on this device
 * and mirrored to Firestore (users/{uid}/study/packs, see lib/firebase/sync.ts)
 * so they follow the student to every device.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MAX_STUDY_PACKS, capTombstones } from "@/lib/study-sync";
import { nextState, type CardState, type Rating } from "@/lib/flashcards";

export interface QuizQuestion {
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
}

export interface StudyPack {
  id: string;
  fileName: string;
  createdAt: string;
  /** Last local edit (review progress, …); falls back to createdAt. */
  updatedAt?: string;
  title: string;
  summary: string[];
  key_terms: { term: string; definition: string }[];
  quiz: QuizQuestion[];
  /** Flashcard progress per term (lib/flashcards.ts), synced with the pack. */
  reviews?: Record<string, CardState>;
  /** Set when the pack was made from a lecture in the smart study mode (/tutor). */
  lectureId?: string;
}

interface StudyState {
  packs: StudyPack[];
  /** Ids deleted on this device, so the delete reaches other devices. */
  deletedIds: string[];
  /** Last local change; null = nothing for the sync layer to push. */
  lastUpdated: string | null;
  ownerUid: string | null;
  addPack: (p: Omit<StudyPack, "id" | "createdAt">) => StudyPack;
  removePack: (id: string) => void;
  /** Add key terms to an existing pack (skips terms it already has). */
  addTerms: (packId: string, terms: { term: string; definition: string }[]) => void;
  /** Save a flashcard rating (spaced repetition) inside its pack. */
  reviewCard: (packId: string, key: string, rating: Rating, today: string) => void;
  clearPacks: () => void;
}

function newId(): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${Date.now().toString(36)}${rand}`;
}

export const useStudyStore = create<StudyState>()(
  persist(
    (set) => ({
      packs: [],
      deletedIds: [],
      lastUpdated: null,
      ownerUid: null,
      addPack: (p) => {
        const now = new Date().toISOString();
        const pack: StudyPack = { ...p, id: newId(), createdAt: now, updatedAt: now };
        set((s) => ({ packs: [pack, ...s.packs].slice(0, MAX_STUDY_PACKS), lastUpdated: now }));
        return pack;
      },
      removePack: (id) =>
        set((s) => ({
          packs: s.packs.filter((x) => x.id !== id),
          deletedIds: capTombstones([...s.deletedIds, id]),
          lastUpdated: new Date().toISOString(),
        })),
      addTerms: (packId, terms) => {
        const now = new Date().toISOString();
        set((s) => ({
          packs: s.packs.map((p) => {
            if (p.id !== packId) return p;
            const have = new Set(p.key_terms.map((t) => t.term.trim().toLowerCase()));
            const fresh = terms.filter((t) => !have.has(t.term.trim().toLowerCase()));
            return fresh.length ? { ...p, key_terms: [...p.key_terms, ...fresh], updatedAt: now } : p;
          }),
          lastUpdated: now,
        }));
      },
      reviewCard: (packId, key, rating, today) => {
        const now = new Date().toISOString();
        set((s) => ({
          packs: s.packs.map((p) =>
            p.id === packId
              ? { ...p, updatedAt: now, reviews: { ...p.reviews, [key]: nextState(p.reviews?.[key] ?? null, rating, today) } }
              : p,
          ),
          lastUpdated: now,
        }));
      },
      clearPacks: () => set({ packs: [], deletedIds: [], lastUpdated: null, ownerUid: null }),
    }),
    {
      name: "uqu_study_v1",
      version: 2,
      // v1 kept only `packs`; the new fields start empty.
      migrate: (persisted) => {
        const old = (persisted ?? {}) as Partial<StudyState>;
        return {
          packs: Array.isArray(old.packs) ? old.packs : [],
          deletedIds: [],
          // Packs made before sync existed still need their first upload.
          lastUpdated: Array.isArray(old.packs) && old.packs.length > 0 ? new Date().toISOString() : null,
          ownerUid: null,
        } as unknown as StudyState;
      },
      partialize: (s) => ({ packs: s.packs, deletedIds: s.deletedIds, lastUpdated: s.lastUpdated, ownerUid: s.ownerUid }),
    },
  ),
);
