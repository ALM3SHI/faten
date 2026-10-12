/** Recent study packs generated from lecture PDFs (kept on this device). */

import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  title: string;
  summary: string[];
  key_terms: { term: string; definition: string }[];
  quiz: QuizQuestion[];
}

const MAX_PACKS = 5;

interface StudyState {
  packs: StudyPack[];
  addPack: (p: Omit<StudyPack, "id" | "createdAt">) => StudyPack;
  removePack: (id: string) => void;
  clearPacks: () => void;
}

export const useStudyStore = create<StudyState>()(
  persist(
    (set) => ({
      packs: [],
      addPack: (p) => {
        const pack: StudyPack = { ...p, id: Date.now().toString(36), createdAt: new Date().toISOString() };
        set((s) => ({ packs: [pack, ...s.packs].slice(0, MAX_PACKS) }));
        return pack;
      },
      removePack: (id) => set((s) => ({ packs: s.packs.filter((x) => x.id !== id) })),
      clearPacks: () => set({ packs: [] }),
    }),
    { name: "uqu_study_v1" },
  ),
);
