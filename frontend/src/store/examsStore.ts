/**
 * The student's exam timetable. Persisted on the device and mirrored to
 * Firestore (one document per exam at users/{uid}/exams/{id}) by
 * lib/firebase/sync.ts — the same documents the agent reads and writes.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_EXAM_MINUTES, type Exam } from "@/lib/exams";

export type ExamInput = Omit<Exam, "id" | "done" | "createdAt" | "updatedAt" | "source">;

interface ExamsState {
  exams: Exam[];
  /** Ids deleted on this device, so the delete reaches the account. */
  deletedIds: string[];
  /** Last local change; null = nothing for the sync layer to push. */
  lastUpdated: string | null;
  ownerUid: string | null;
  /** Study-plan sessions ticked off on this device (`${date}|${examId}`). */
  studyDone: Record<string, true>;
  /** Minutes per day the study plan may use. */
  dailyMinutes: number;
  addExam: (input: ExamInput) => Exam;
  updateExam: (id: string, patch: Partial<ExamInput> & { done?: boolean }) => void;
  removeExam: (id: string) => void;
  toggleSession: (key: string) => void;
  setDailyMinutes: (minutes: number) => void;
  clearExams: () => void;
}

function newId(): string {
  return `ex_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const useExamsStore = create<ExamsState>()(
  persist(
    (set) => ({
      exams: [],
      deletedIds: [],
      lastUpdated: null,
      ownerUid: null,
      studyDone: {},
      dailyMinutes: 180,
      addExam: (input) => {
        const now = new Date().toISOString();
        const exam: Exam = {
          ...input,
          duration_minutes: input.duration_minutes || DEFAULT_EXAM_MINUTES,
          id: newId(),
          done: false,
          createdAt: now,
          updatedAt: now,
          source: "app",
        };
        set((s) => ({ exams: [...s.exams, exam], lastUpdated: now }));
        return exam;
      },
      updateExam: (id, patch) => {
        const now = new Date().toISOString();
        set((s) => ({
          exams: s.exams.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: now } : e)),
          lastUpdated: now,
        }));
      },
      removeExam: (id) =>
        set((s) => ({
          exams: s.exams.filter((e) => e.id !== id),
          deletedIds: [...new Set([...s.deletedIds, id])].slice(-100),
          lastUpdated: new Date().toISOString(),
        })),
      toggleSession: (key) =>
        set((s) => {
          const next = { ...s.studyDone };
          if (next[key]) delete next[key];
          else next[key] = true;
          return { studyDone: next };
        }),
      setDailyMinutes: (minutes) => set({ dailyMinutes: Math.max(30, Math.min(600, minutes)) }),
      clearExams: () => set({ exams: [], deletedIds: [], lastUpdated: null, ownerUid: null, studyDone: {}, dailyMinutes: 180 }),
    }),
    {
      name: "uqu_exams_v1",
      partialize: (s) => ({
        exams: s.exams,
        deletedIds: s.deletedIds,
        lastUpdated: s.lastUpdated,
        ownerUid: s.ownerUid,
        studyDone: s.studyDone,
        dailyMinutes: s.dailyMinutes,
      }),
    },
  ),
);
