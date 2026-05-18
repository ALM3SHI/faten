/**
 * Transcript Store — persists the parsed academic transcript.
 *
 * Source of truth for everything the local pdfjs parser
 * (`lib/transcript-parser.ts`) extracts. Consumers:
 *   • SetupWizard reads `currentCourses` for Step 2 (manual DnD or
 *     vision verification).
 *   • Profile page checks `hasTranscript()` for the unified setup card.
 *   • GPA page reads `completedCourses` to compute the grade history.
 *
 * Persistence: Zustand `persist` middleware → localStorage. Survives
 * reloads without a Firestore round-trip.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EnrichedCourse, ParsedTranscript } from "@/lib/transcript-parser";

export type { EnrichedCourse, ParsedTranscript };

interface TranscriptState {
  // Identity
  name: string | null;
  nameEn: string | null;
  studentId: string | null;
  university: string | null;
  major: string | null;
  faculty: string | null;
  degree: string | null;
  // Academic stats
  gpa: number | null;
  earnedHours: number | null;
  planHours: number | null;
  // Courses
  completedCourses: EnrichedCourse[];
  currentCourses: EnrichedCourse[]; // alias for registeredCourses
  // Meta
  confidence: number;
  lastUpdated: string | null;

  setTranscript: (t: ParsedTranscript) => void;
  clearTranscript: () => void;
  hasTranscript: () => boolean;
}

export const useTranscriptStore = create<TranscriptState>()(
  persist(
    (set, get) => ({
      name: null,
      nameEn: null,
      studentId: null,
      university: null,
      major: null,
      faculty: null,
      degree: null,
      gpa: null,
      earnedHours: null,
      planHours: null,
      completedCourses: [],
      currentCourses: [],
      confidence: 0,
      lastUpdated: null,

      setTranscript: (t) =>
        set({
          name: t.name,
          nameEn: t.nameEn,
          studentId: t.studentId,
          university: t.university,
          major: t.major,
          faculty: t.faculty,
          degree: t.degree,
          gpa: t.gpa,
          earnedHours: t.earnedHours,
          planHours: t.planHours,
          completedCourses: t.completedCourses,
          currentCourses: t.registeredCourses,
          confidence: t.confidence,
          lastUpdated: new Date().toISOString(),
        }),

      clearTranscript: () =>
        set({
          name: null,
          nameEn: null,
          studentId: null,
          university: null,
          major: null,
          faculty: null,
          degree: null,
          gpa: null,
          earnedHours: null,
          planHours: null,
          completedCourses: [],
          currentCourses: [],
          confidence: 0,
          lastUpdated: null,
        }),

      hasTranscript: () => {
        const s = get();
        return s.lastUpdated !== null && s.completedCourses.length > 0;
      },
    }),
    {
      name: "uqu_transcript_v1",
      // Don't persist the function — only the data fields.
      partialize: (s) => {
        const { setTranscript, clearTranscript, hasTranscript, ...data } = s;
        void setTranscript; void clearTranscript; void hasTranscript;
        return data;
      },
    },
  ),
);
