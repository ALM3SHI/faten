/**
 * Profile Store — persists the student's academic identity, goals, and
 * Smart Preferences Hub selections.
 *
 * Consumers:
 *   • Profile page (`/profile`) — owns the editing UI.
 *   • Upcoming AI Study Plan & Pomodoro Generator — reads `preferences`
 *     to tune session length, ordering strategy, and rest days.
 *
 * Persistence: Zustand `persist` middleware → localStorage under
 * `uqu_profile_v3`. On first rehydrate, legacy data at
 * `uqu_profile_v2` (the old localStorage-only shape) is migrated once,
 * so returning users keep their name/major/studentId/goals/study style.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Storage, STORAGE_KEYS } from "@/lib/core";

export type LearningStyle = "visual" | "auditory" | "kinesthetic" | "reading";
export type EnergyPeak = "morning" | "afternoon" | "night";
export type TaskStrategy = "eat_frog" | "snowball";
export type DayOff =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "none";

export interface ProfileBasic {
  name: string;
  major: string;
  studentId: string;
  // Total credit hours of the academic plan (e.g., 132). Stored as `""`
  // while the input is empty so the number field shows a true placeholder
  // instead of "0". Consumed by the upcoming GPA calculator.
  totalPlanHours: number | "";
}

export interface ProfileGoals {
  currentGpa: number;
  targetGpa: number;
}

export interface ProfilePreferences {
  learningStyle: LearningStyle;
  energyPeak: EnergyPeak;
  taskStrategy: TaskStrategy;
  pomodoroFocus: number;       // 25 | 30 | 45 | 50
  pomodoroShortBreak: number;  // 5  | 10 | 15
  pomodoroLongBreak: number;   // 15 | 20 | 30
  dayOff: DayOff;
}

export interface ProfileState {
  /** Firebase UID that owns this persisted snapshot; null = untrusted legacy cache. */
  ownerUid: string | null;
  basic: ProfileBasic;
  goals: ProfileGoals;
  preferences: ProfilePreferences;
  lastUpdated: string | null;

  setBasic: (patch: Partial<ProfileBasic>) => void;
  setGoals: (patch: Partial<ProfileGoals>) => void;
  setPreferences: (patch: Partial<ProfilePreferences>) => void;
  resetProfile: () => void;
}

const DEFAULT_BASIC: ProfileBasic = { name: "", major: "", studentId: "", totalPlanHours: "" };
const DEFAULT_GOALS: ProfileGoals = { currentGpa: 0, targetGpa: 0 };
const DEFAULT_PREFS: ProfilePreferences = {
  learningStyle: "visual",
  energyPeak: "morning",
  taskStrategy: "eat_frog",
  pomodoroFocus: 25,
  pomodoroShortBreak: 5,
  pomodoroLongBreak: 15,
  dayOff: "friday",
};

const VALID_LEARNING: LearningStyle[] = ["visual", "auditory", "kinesthetic", "reading"];

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      ownerUid: null,
      basic: DEFAULT_BASIC,
      goals: DEFAULT_GOALS,
      preferences: DEFAULT_PREFS,
      lastUpdated: null,

      setBasic: (patch) =>
        set((s) => ({
          basic: { ...s.basic, ...patch },
          lastUpdated: new Date().toISOString(),
        })),

      setGoals: (patch) =>
        set((s) => ({
          goals: { ...s.goals, ...patch },
          lastUpdated: new Date().toISOString(),
        })),

      setPreferences: (patch) =>
        set((s) => ({
          preferences: { ...s.preferences, ...patch },
          lastUpdated: new Date().toISOString(),
        })),

      resetProfile: () =>
        set({
          ownerUid: null,
          basic: DEFAULT_BASIC,
          goals: DEFAULT_GOALS,
          preferences: DEFAULT_PREFS,
          lastUpdated: null,
        }),
    }),
    {
      name: "uqu_profile_v3",
      partialize: (s) => ({
        ownerUid: s.ownerUid,
        basic: s.basic,
        goals: s.goals,
        preferences: s.preferences,
        lastUpdated: s.lastUpdated,
      }),
      // Persist's default merge is shallow, so older snapshots missing
      // newer fields (e.g. studentId, totalPlanHours) come back with
      // `undefined` values — that flips Base UI Inputs from controlled
      // ("") to uncontrolled (undefined) on rehydration. Deep-merge
      // each sub-object with its defaults to backfill missing keys.
      merge: (persisted, current) => {
        const p = (persisted as Partial<ProfileState>) ?? {};
        return {
          ...current,
          ownerUid: p.ownerUid ?? null,
          basic: { ...DEFAULT_BASIC, ...(p.basic ?? {}) },
          goals: { ...DEFAULT_GOALS, ...(p.goals ?? {}) },
          preferences: { ...DEFAULT_PREFS, ...(p.preferences ?? {}) },
          lastUpdated: p.lastUpdated ?? null,
        };
      },
      // One-time migration from legacy uqu_profile_v2 shape:
      //   { basic, goals, preferences: { studyStyle, focusDuration }, courses, completedCourses }
      // Only runs when the new v3 key has never been written (lastUpdated === null).
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        if (state.lastUpdated !== null) return;

        const legacy = Storage.get<any>(STORAGE_KEYS.PROFILE, null);
        if (!legacy) return;

        const legacyStyle = legacy?.preferences?.studyStyle;
        const legacyFocus = legacy?.preferences?.focusDuration;

        useProfileStore.setState({
          basic: { ...DEFAULT_BASIC, ...(legacy.basic ?? {}) },
          goals: { ...DEFAULT_GOALS, ...(legacy.goals ?? {}) },
          preferences: {
            ...DEFAULT_PREFS,
            ...(VALID_LEARNING.includes(legacyStyle) ? { learningStyle: legacyStyle } : {}),
            ...(typeof legacyFocus === "number" && legacyFocus > 0
              ? { pomodoroFocus: legacyFocus }
              : {}),
          },
          lastUpdated: new Date().toISOString(),
        });
      },
    },
  ),
);
