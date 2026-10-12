/**
 * Authentication Utilities — Cross-Account Data-Leak Guard
 * ───────────────────────────────────────────────────────────────
 * Single-source-of-truth helpers used to tear down a user session.
 *
 * Why this file exists
 *   The Zustand `persist` middleware writes every store the user
 *   interacts with into `localStorage` (uqu_profile_v3, uqu_transcript_v1,
 *   uqu_schedule_v1, uqu_ai_plan_v1, uqu_chat_history_v1). Calling
 *   Firebase `signOut()` closes the auth session but leaves all that
 *   academic data sitting on the device. The next person to log in on
 *   the same browser sees the previous user's transcript and dashboard
 *   — a textbook cross-account data leak.
 *
 *   `clearAllAppData()` purges every persisted slot AND resets the
 *   in-memory Zustand state. `logoutAndPurge()` is the public entry
 *   point: it signs out of Firebase, purges, and forces a hard browser
 *   redirect so React's component tree and Zustand's runtime state are
 *   thrown away alongside the persisted data.
 *
 * Always call `logoutAndPurge()` — never call `signOut(auth)` directly.
 */

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useChatHistoryStore } from "@/store/chatHistoryStore";
import { usePlanStore } from "@/store/planStore";
import { useProfileStore } from "@/store/profileStore";
import { useScheduleStore } from "@/store/scheduleStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useAttendanceStore } from "@/store/attendanceStore";
import { STORAGE_KEYS } from "@/lib/core";

/** Tab-scoped last Firebase UID — survives refresh, cleared on logout tracking reset. */
const AUTH_UID_SESSION_KEY = "uqu_last_auth_uid";

/**
 * Keys we want to keep across the purge. Theme is a per-device UI
 * preference, not user data — keeping it avoids a jarring flash of
 * the wrong palette on the login page.
 */
const PRESERVED_KEYS: ReadonlySet<string> = new Set([STORAGE_KEYS.THEME]);

/**
 * Persisted store handles — kept as a typed list so adding a new
 * persisted store in the future is a one-line addition here AND a
 * compile-time reminder to extend the purge.
 */
type PersistedStore = {
  /** Human-readable label for the warning log. */
  label: string;
  /** Zustand's persist middleware augments the store with `.persist`. */
  persist: { clearStorage: () => void };
  /** Optional in-memory reset (so the React tree updates instantly
   *  before the hard refresh — defense in depth). */
  reset?: () => void;
};

function getPersistedStores(): PersistedStore[] {
  return [
    {
      label: "profile",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persist: (useProfileStore as any).persist,
      reset: () => useProfileStore.getState().resetProfile(),
    },
    {
      label: "transcript",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persist: (useTranscriptStore as any).persist,
      reset: () => useTranscriptStore.getState().clearTranscript(),
    },
    {
      label: "schedule",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persist: (useScheduleStore as any).persist,
      reset: () => useScheduleStore.getState().clearSchedule(),
    },
    {
      label: "plan",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persist: (usePlanStore as any).persist,
      reset: () => usePlanStore.getState().clearPlan(),
    },
    {
      label: "attendance",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persist: (useAttendanceStore as any).persist,
      reset: () => useAttendanceStore.getState().clearAttendance(),
    },
    {
      label: "chat-history",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persist: (useChatHistoryStore as any).persist,
      reset: () => useChatHistoryStore.getState().clearAll(),
    },
  ];
}

/**
 * Purge every user-owned data slot. Safe to call any number of times.
 *
 * Order:
 *   1. Persist-middleware `clearStorage()` on every known store.
 *      This is the documented Zustand path — it not only deletes
 *      the localStorage key but also detaches the rehydration
 *      listeners so an in-flight read can't repopulate the slot.
 *   2. In-memory `reset()` on every store. The hard redirect after
 *      logout will throw the JS runtime away, but resetting first
 *      eliminates any flash of the previous user's data during
 *      the transition.
 *   3. Capture any preserved keys (theme), nuke ALL of localStorage,
 *      restore the preserved keys. This is the nuclear catch-all
 *      that also wipes the legacy `Storage` helper keys
 *      (uqu_exams, STORAGE_KEYS.PROFILE, etc.) which aren't owned
 *      by any Zustand store.
 *   4. `sessionStorage.clear()` — anything cached for the tab.
 *
 * Every step is wrapped in try/catch so a single failure can't
 * leave the rest of the purge half-done.
 */
function getTrackedAuthUid(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(AUTH_UID_SESSION_KEY);
  } catch {
    return null;
  }
}

/** True when any persisted user store holds data beyond empty defaults. */
function hasPersistedUserPayload(): boolean {
  const profile = useProfileStore.getState();
  if (profile.lastUpdated !== null) return true;
  if (
    profile.basic.name.trim() ||
    profile.basic.major.trim() ||
    profile.basic.studentId.trim()
  ) {
    return true;
  }

  const transcript = useTranscriptStore.getState();
  if (transcript.lastUpdated !== null || transcript.completedCourses.length > 0) {
    return true;
  }

  if (useScheduleStore.getState().schedule.length > 0) return true;
  if (usePlanStore.getState().plan !== null) return true;
  if (useChatHistoryStore.getState().threads.length > 0) return true;
  if (useAttendanceStore.getState().lastUpdated !== null) return true;

  return false;
}

/**
 * Returns true when local persisted caches may be shown for `currentUid`.
 * Missing `ownerUid` with existing payload is treated as untrusted legacy data.
 */
export function validateStoredOwnerUid(currentUid: string): boolean {
  const ownerUid = useProfileStore.getState().ownerUid;
  if (ownerUid === currentUid) return true;
  if (ownerUid !== null && ownerUid !== currentUid) return false;
  // ownerUid is null — only trust empty caches.
  return !hasPersistedUserPayload();
}

/** Stamp every persisted user store with the active Firebase UID. */
export function setStoresOwnerUid(uid: string): void {
  useProfileStore.setState({ ownerUid: uid });
  useTranscriptStore.setState({ ownerUid: uid });
  useScheduleStore.setState({ ownerUid: uid });
  usePlanStore.setState({ ownerUid: uid });
  useChatHistoryStore.setState({ ownerUid: uid });
  useAttendanceStore.setState({ ownerUid: uid });
}

/** Wipe user-owned persisted slots; theme and other preserved keys stay. */
export function clearUserStores(): void {
  clearAllAppData();
}

function setTrackedAuthUid(uid: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (uid === null) {
      sessionStorage.removeItem(AUTH_UID_SESSION_KEY);
    } else {
      sessionStorage.setItem(AUTH_UID_SESSION_KEY, uid);
    }
  } catch (err) {
    console.warn("[auth] setTrackedAuthUid failed:", err);
  }
}

/**
 * When a different user signs in on the same tab, purge persisted slots
 * before workspace hydrate. Same UID (including normal refresh) is a no-op.
 * Returns true if a purge ran.
 */
export function purgePersistedDataIfAccountSwitched(nextUid: string): boolean {
  const prevUid = getTrackedAuthUid();
  if (prevUid !== null && prevUid !== nextUid) {
    clearUserStores();
    const pomodoro = usePomodoroStore.getState();
    pomodoro.setCompletedSessions(0);
    pomodoro.setCurrentStreak(0);
    setTrackedAuthUid(nextUid);
    return true;
  }
  if (!validateStoredOwnerUid(nextUid)) {
    clearUserStores();
    setTrackedAuthUid(nextUid);
    return true;
  }
  setTrackedAuthUid(nextUid);
  return false;
}

/** Call when auth session ends (logout). Does not purge — use logoutAndPurge for that. */
export function clearAuthenticatedUidTracking(): void {
  setTrackedAuthUid(null);
}

export function clearAllAppData(): void {
  if (typeof window === "undefined") return;

  // 1 + 2. Per-store wipe.
  for (const s of getPersistedStores()) {
    try {
      s.persist?.clearStorage?.();
    } catch (err) {
      console.warn(`[auth] clearStorage failed for ${s.label}:`, err);
    }
    try {
      s.reset?.();
    } catch (err) {
      console.warn(`[auth] reset failed for ${s.label}:`, err);
    }
  }

  // 3. Nuclear localStorage purge with theme preservation.
  try {
    const preserved: Record<string, string> = {};
    for (const key of PRESERVED_KEYS) {
      const v = window.localStorage.getItem(key);
      if (v !== null) preserved[key] = v;
    }
    window.localStorage.clear();
    for (const [key, value] of Object.entries(preserved)) {
      window.localStorage.setItem(key, value);
    }
  } catch (err) {
    console.warn("[auth] localStorage purge failed:", err);
  }

  // 4. Tab-scoped storage too.
  try {
    window.sessionStorage.clear();
  } catch (err) {
    console.warn("[auth] sessionStorage purge failed:", err);
  }
}

/**
 * Full logout pipeline. Always use this — never call `signOut()` directly.
 *
 *   1. Firebase signOut (closes the session + clears its IndexedDB).
 *   2. `clearAllAppData()` (wipes every persisted Zustand slot).
 *   3. Hard navigation to `/login` — `window.location.href` (not
 *      `router.push`) so React's component tree and Zustand's
 *      runtime memory are destroyed alongside the persisted data.
 *      A soft navigation would keep the previous user's hydrated
 *      stores live until the next reload, which is exactly the
 *      bug we're fixing.
 *
 * Step 1 is wrapped in try/catch: if Firebase fails (network down,
 * already-signed-out, etc.) we STILL purge and redirect. The local
 * data leak is the bigger risk and must always be plugged.
 */
export async function logoutAndPurge(
  redirectTo: string = "/login",
): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[auth] Firebase signOut failed — continuing purge anyway:", err);
  }

  clearAllAppData();

  if (typeof window !== "undefined") {
    // Hard navigation. assign() is preferred over href= for testability
    // and because it explicitly creates a new history entry.
    window.location.assign(redirectTo);
  }
}
