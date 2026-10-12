/**
 * Firestore ⇄ Zustand sync layer.
 * ────────────────────────────────────────────────────────────────
 *
 * Schema (all rooted at `users/{uid}`):
 *
 *   users/{uid}                              ← profile doc
 *     ├─ basic, goals, preferences, lastUpdated, email, updatedAt
 *
 *   users/{uid}/academic_record/main         ← transcript doc
 *     ├─ name, gpa, earnedHours, completedCourses, currentCourses, …
 *
 *   users/{uid}/academic_record/schedule     ← weekly timetable doc
 *     ├─ schedule[], lastUpdated
 *
 *   users/{uid}/academic_record/attendance   ← absence tracker doc
 *     ├─ courses{code: {entries[], totalOverride}}, lastUpdated
 *
 *   users/{uid}/plan/current                 ← active AI plan doc
 *     ├─ plan, model, generatedAt, completed[]
 *
 *   users/{uid}/chats/{threadId}             ← one doc per chat thread
 *     ├─ title, preview, createdAt, updatedAt, messages[], conversationId
 *
 * Why subscribe() and not action edits:
 *   Every Zustand action already mutates state through `set(...)`. A
 *   single `store.subscribe(listener)` on each store catches *all* of
 *   those mutations in one place — no per-action wiring, no risk of
 *   forgetting a new action later. The listener debounces and pushes
 *   to Firestore. Hydration runs first with sync paused so the initial
 *   write-back doesn't overwrite Firestore with stale localStorage.
 */

import {
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

import {
  deleteChatThreadFromBackend,
  saveChatThreadToBackend,
  savePlanToBackend,
  saveProfileToBackend,
  saveScheduleToBackend,
  saveTranscriptToBackend,
  suppressChatsLegacyFallback,
} from "@/lib/workspace";
import { useProfileStore } from "@/store/profileStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { useScheduleStore } from "@/store/scheduleStore";
import { usePlanStore } from "@/store/planStore";
import { useChatHistoryStore, type ChatThread } from "@/store/chatHistoryStore";
import { useAttendanceStore } from "@/store/attendanceStore";

// ─────────────────────────────────────────────────────────────────
// Sync gating — pause pushes while we're pulling, to prevent loops.
// ─────────────────────────────────────────────────────────────────
let syncEnabled = false;
let attached = false;

/** Gate outbound Firestore pushes during hydration (API or direct pull). */
export function setStoreSyncEnabled(enabled: boolean): void {
  syncEnabled = enabled;
}

function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

/** Runs the side-effect only when sync is enabled. Errors are logged,
 *  never thrown — a failed Firestore write must not crash the UI. */
function safeRun(label: string, fn: () => Promise<unknown>) {
  if (!syncEnabled) return;
  void fn().catch((err) => {
    console.error(`[firebase-sync] ${label} failed:`, err);
  });
}

// Per-key debouncer so bursts of state changes (e.g. typing in the
// preferences hub) coalesce into a single write.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function debouncedPush(key: string, fn: () => void, delayMs = 600) {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(key);
    fn();
  }, delayMs);
  timers.set(key, t);
}

// ─────────────────────────────────────────────────────────────────
// PUSH — one function per collection. Each takes the current store
// slice and writes it to Firestore. Exported so callers can also
// trigger a forced sync (e.g. logout flush).
// ─────────────────────────────────────────────────────────────────

export async function syncProfile(
  uid: string,
  data: {
    basic: ReturnType<typeof useProfileStore.getState>["basic"];
    goals: ReturnType<typeof useProfileStore.getState>["goals"];
    preferences: ReturnType<typeof useProfileStore.getState>["preferences"];
    lastUpdated: string | null;
  },
) {
  await setDoc(
    doc(db, "users", uid),
    {
      basic: data.basic,
      goals: data.goals,
      preferences: data.preferences,
      lastUpdated: data.lastUpdated,
      updatedAt: serverTimestamp(),
    },
    { merge: true }, // keep the email/createdAt fields the auth-provider seeded
  );
}

export async function syncTranscript(
  uid: string,
  data: Omit<ReturnType<typeof useTranscriptStore.getState>,
    "setTranscript" | "clearTranscript" | "hasTranscript" | "ownerUid">,
) {
  await setDoc(
    doc(db, "users", uid, "academic_record", "main"),
    { ...data, updatedAt: serverTimestamp() },
  );
}

export async function syncSchedule(
  uid: string,
  data: {
    schedule: ReturnType<typeof useScheduleStore.getState>["schedule"];
    lastUpdated: string | null;
  },
) {
  await setDoc(
    doc(db, "users", uid, "academic_record", "schedule"),
    { ...data, updatedAt: serverTimestamp() },
  );
}

export async function syncAttendance(
  uid: string,
  data: {
    courses: ReturnType<typeof useAttendanceStore.getState>["courses"];
    lastUpdated: string | null;
  },
) {
  await setDoc(
    doc(db, "users", uid, "academic_record", "attendance"),
    { ...data, updatedAt: serverTimestamp() },
  );
}

export async function syncPlan(
  uid: string,
  data: {
    plan: ReturnType<typeof usePlanStore.getState>["plan"];
    model: string | null;
    generatedAt: string | null;
    completed: string[];
  },
) {
  await setDoc(
    doc(db, "users", uid, "plan", "current"),
    { ...data, updatedAt: serverTimestamp() },
  );
}

/** Serialize one chat thread: `Date`s → ISO strings (Firestore array
 *  members can't hold `Date` reliably across edge SDKs). */
function serializeThread(t: ChatThread) {
  return {
    id: t.id,
    title: t.title,
    preview: t.preview,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    conversationId: t.conversationId,
    messages: t.messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp:
        m.timestamp instanceof Date
          ? m.timestamp.toISOString()
          : (m.timestamp as unknown as string),
      ...(m.actions ? { actions: m.actions } : {}),
    })),
  };
}

export async function syncChat(uid: string, thread: ChatThread) {
  await setDoc(
    doc(db, "users", uid, "chats", thread.id),
    { ...serializeThread(thread), updatedAt: serverTimestamp() },
  );
}

export async function deleteChat(uid: string, threadId: string) {
  await deleteDoc(doc(db, "users", uid, "chats", threadId));
}

export async function clearAllChats(uid: string) {
  const snap = await getDocs(collection(db, "users", uid, "chats"));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ─────────────────────────────────────────────────────────────────
// PULL — hydrate every store from Firestore on login.
// ─────────────────────────────────────────────────────────────────

export async function hydrateUserWorkspace(uid: string): Promise<void> {
  // Sync is OFF during hydration; otherwise the subscribers below would
  // see setState() and immediately try to push the same data back.
  setStoreSyncEnabled(false);
  try {
    const [profileSnap, transcriptSnap, scheduleSnap, planSnap, chatsSnap, attendanceSnap] =
      await Promise.all([
        getDoc(doc(db, "users", uid)),
        getDoc(doc(db, "users", uid, "academic_record", "main")),
        getDoc(doc(db, "users", uid, "academic_record", "schedule")),
        getDoc(doc(db, "users", uid, "plan", "current")),
        getDocs(collection(db, "users", uid, "chats")),
        // Optional doc — a failure here must not break the rest of hydration.
        getDoc(doc(db, "users", uid, "academic_record", "attendance")).catch(() => null),
      ]);

    // ── Attendance ──
    if (attendanceSnap?.exists()) {
      const d = attendanceSnap.data() as Record<string, unknown>;
      useAttendanceStore.setState({
        courses:
          (d.courses as ReturnType<typeof useAttendanceStore.getState>["courses"]) ?? {},
        lastUpdated: (d.lastUpdated as string | null) ?? null,
      });
    }

    // ── Profile ──
    if (profileSnap.exists()) {
      const d = profileSnap.data() as Record<string, unknown>;
      // Only apply fields we recognize; auth-provider seeds extras
      // (email, createdAt) that the Zustand store doesn't track.
      useProfileStore.setState((prev) => ({
        basic: (d.basic as typeof prev.basic) ?? prev.basic,
        goals: (d.goals as typeof prev.goals) ?? prev.goals,
        preferences:
          (d.preferences as typeof prev.preferences) ?? prev.preferences,
        lastUpdated: (d.lastUpdated as string) ?? prev.lastUpdated,
      }));
    }

    // ── Transcript ──
    if (transcriptSnap.exists()) {
      const d = transcriptSnap.data() as Record<string, unknown>;
      useTranscriptStore.setState({
        name: (d.name as string | null) ?? null,
        nameEn: (d.nameEn as string | null) ?? null,
        studentId: (d.studentId as string | null) ?? null,
        university: (d.university as string | null) ?? null,
        major: (d.major as string | null) ?? null,
        faculty: (d.faculty as string | null) ?? null,
        degree: (d.degree as string | null) ?? null,
        gpa: (d.gpa as number | null) ?? null,
        earnedHours: (d.earnedHours as number | null) ?? null,
        planHours: (d.planHours as number | null) ?? null,
        completedCourses:
          (d.completedCourses as ReturnType<typeof useTranscriptStore.getState>["completedCourses"]) ?? [],
        currentCourses:
          (d.currentCourses as ReturnType<typeof useTranscriptStore.getState>["currentCourses"]) ?? [],
        confidence: (d.confidence as number) ?? 0,
        lastUpdated: (d.lastUpdated as string | null) ?? null,
      });
    }

    // ── Schedule ──
    if (scheduleSnap.exists()) {
      const d = scheduleSnap.data() as Record<string, unknown>;
      useScheduleStore.setState({
        schedule:
          (d.schedule as ReturnType<typeof useScheduleStore.getState>["schedule"]) ?? [],
        lastUpdated: (d.lastUpdated as string | null) ?? null,
      });
    }

    // ── Plan ──
    if (planSnap.exists()) {
      const d = planSnap.data() as Record<string, unknown>;
      usePlanStore.setState({
        plan: (d.plan as ReturnType<typeof usePlanStore.getState>["plan"]) ?? null,
        model: (d.model as string | null) ?? null,
        generatedAt: (d.generatedAt as string | null) ?? null,
        completed: (d.completed as string[]) ?? [],
      });
    }

    // ── Chats ── (one doc per thread)
    if (!chatsSnap.empty) {
      // Firestore may return updatedAt/createdAt as a Timestamp object
      // (we write them with serverTimestamp()), a plain ISO string, or
      // even a Date — coerce all three into the ISO string the local
      // store expects.
      const toIso = (v: unknown): string => {
        if (!v) return new Date(0).toISOString();
        if (typeof v === "string") return v;
        if (v instanceof Date) return v.toISOString();
        // Firestore Timestamp duck-typing — has toDate()
        if (typeof (v as { toDate?: unknown }).toDate === "function") {
          return (v as { toDate: () => Date }).toDate().toISOString();
        }
        return new Date(0).toISOString();
      };

      const threads: ChatThread[] = chatsSnap.docs
        .map((s) => {
          const d = s.data() as Record<string, unknown>;
          const rawMessages = (d.messages as Array<Record<string, unknown>>) ?? [];
          return {
            id: (d.id as string) ?? s.id,
            title: (d.title as string) ?? "محادثة",
            preview: (d.preview as string) ?? "",
            createdAt: toIso(d.createdAt),
            updatedAt: toIso(d.updatedAt),
            conversationId: (d.conversationId as string | null) ?? null,
            messages: rawMessages.map((m) => ({
              role: m.role as "user" | "bot",
              content: (m.content as string) ?? "",
              timestamp: (() => {
                const t = m.timestamp;
                if (t instanceof Date) return t;
                if (typeof t === "string") return new Date(t);
                if (t && typeof (t as { toDate?: unknown }).toDate === "function") {
                  return (t as { toDate: () => Date }).toDate();
                }
                return new Date();
              })(),
              actions: (m.actions as unknown[] | undefined) ?? undefined,
            })),
          } as ChatThread;
        })
        // Newest first — matches the local store's invariant.
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      useChatHistoryStore.setState({
        threads,
        // Don't auto-resume a thread; the chat page decides via its own
        // load/start logic. We just expose the history.
        activeId: null,
        hasHydrated: true,
      });
    }
  } finally {
    // Kill any debounced writes that were scheduled by subscribers
    // during hydration — hydration is a read, so these carry identical
    // data and would produce spurious updatedAt writes.
    clearPendingPushTimers();
    // Hand sync back on regardless of partial failure — better to
    // resume pushing than to leave the user in a write-paused state.
    setStoreSyncEnabled(true);
  }
}

// ─────────────────────────────────────────────────────────────────
// SUBSCRIBE — wire every store's `subscribe(...)` to its push fn.
// Idempotent: safe to call multiple times (only the first call wires).
// ─────────────────────────────────────────────────────────────────

export function attachStoreSync(): void {
  if (attached) return;
  attached = true;

  // ── Profile — backend-first (Phase 2A), Firestore as safety net ──
  useProfileStore.subscribe((state) => {
    const uid = currentUid();
    if (!uid) return;
    // Phase 4B.2 — defer persist until user/setup has written profile (lastUpdated set).
    if (state.lastUpdated == null) return;
    const slice = {
      basic: state.basic,
      goals: state.goals,
      preferences: state.preferences,
      lastUpdated: state.lastUpdated,
    };
    debouncedPush(`profile:${uid}`, () =>
      safeRun("pushProfile", async () => {
        try {
          await saveProfileToBackend(slice);
        } catch (err) {
          console.error("[firebase-sync] saveProfileToBackend failed:", err);
          await syncProfile(uid, slice);
        }
      }),
    );
  });

  // ── Transcript — backend-first (Phase 2B), Firestore as safety net ──
  useTranscriptStore.subscribe((state) => {
    const uid = currentUid();
    if (!uid) return;
    // Phase 4B.3 — defer persist until transcript import/setup (lastUpdated set).
    if (state.lastUpdated == null) return;
    const slice = {
      name: state.name,
      nameEn: state.nameEn,
      studentId: state.studentId,
      university: state.university,
      major: state.major,
      faculty: state.faculty,
      degree: state.degree,
      gpa: state.gpa,
      earnedHours: state.earnedHours,
      planHours: state.planHours,
      completedCourses: state.completedCourses,
      currentCourses: state.currentCourses,
      confidence: state.confidence,
      lastUpdated: state.lastUpdated,
    };
    debouncedPush(`transcript:${uid}`, () =>
      safeRun("pushTranscript", async () => {
        try {
          await saveTranscriptToBackend(slice);
        } catch (err) {
          console.error("[firebase-sync] saveTranscriptToBackend failed:", err);
          await syncTranscript(uid, slice);
        }
      }),
    );
  });

  // ── Schedule — backend-first (Phase 2C), Firestore as safety net ──
  useScheduleStore.subscribe((state) => {
    const uid = currentUid();
    if (!uid) return;
    // Phase 4B.3 — defer persist until schedule creation (lastUpdated set).
    if (state.lastUpdated == null) return;
    const slice = {
      schedule: state.schedule,
      lastUpdated: state.lastUpdated,
    };
    debouncedPush(`schedule:${uid}`, () =>
      safeRun("pushSchedule", async () => {
        try {
          await saveScheduleToBackend(slice);
        } catch (err) {
          console.error("[firebase-sync] saveScheduleToBackend failed:", err);
          await syncSchedule(uid, slice);
        }
      }),
    );
  });

  // ── Attendance — direct Firestore (owner-only rules cover the path) ──
  useAttendanceStore.subscribe((state) => {
    const uid = currentUid();
    if (!uid) return;
    if (state.lastUpdated == null) return;
    const slice = { courses: state.courses, lastUpdated: state.lastUpdated };
    debouncedPush(`attendance:${uid}`, () =>
      safeRun("pushAttendance", () => syncAttendance(uid, slice)),
    );
  });

  // ── Plan — backend-first (Phase 2D), Firestore as safety net ──
  usePlanStore.subscribe((state) => {
    const uid = currentUid();
    if (!uid) return;
    // Phase 4B.3 — defer persist until a real plan exists (generate/add task).
    if (!state.plan) return;
    const slice = {
      plan: state.plan,
      model: state.model,
      generatedAt: state.generatedAt,
      completed: state.completed,
    };
    debouncedPush(`plan:${uid}`, () =>
      safeRun("pushPlan", async () => {
        try {
          await savePlanToBackend(slice);
        } catch (err) {
          console.error("[firebase-sync] savePlanToBackend failed:", err);
          await syncPlan(uid, slice);
        }
      }),
    );
  });

  // ── Chats ── diff old vs new so we only push what changed and
  // delete what was removed. Skip individual writes during a bulk
  // `clearAll` and use one batch delete instead.
  useChatHistoryStore.subscribe((state, prevState) => {
    const uid = currentUid();
    if (!uid) return;

    const prevThreads = prevState.threads ?? [];
    const newThreads = state.threads ?? [];

    // Bulk clear: backend-first per thread (Phase 2E.1), suppress fallback (2E.2), safety net.
    if (prevThreads.length > 0 && newThreads.length === 0) {
      safeRun("clearAllChats", async () => {
        await Promise.allSettled(
          prevThreads.map((t) =>
            deleteChatThreadFromBackend(t.id).catch((err) => {
              console.error(
                "[firebase-sync] deleteChatThreadFromBackend failed:",
                t.id,
                err,
              );
            }),
          ),
        );
        await clearAllChats(uid);
        try {
          await suppressChatsLegacyFallback();
        } catch (err) {
          console.error("[firebase-sync] suppressChatsLegacyFallback failed:", err);
        }
      });
      return;
    }

    const prevById = new Map(prevThreads.map((t) => [t.id, t]));
    const newById = new Map(newThreads.map((t) => [t.id, t]));

    // Deleted threads — backend-first (Phase 2E.1), Firestore as safety net.
    for (const id of prevById.keys()) {
      if (!newById.has(id)) {
        safeRun("deleteChat", async () => {
          try {
            await deleteChatThreadFromBackend(id);
          } catch (err) {
            console.error("[firebase-sync] deleteChatThreadFromBackend failed:", err);
          }
          await deleteChat(uid, id);
        });
      }
    }

    // New / changed threads — backend-first (Phase 2E), Firestore as safety net.
    for (const thread of newThreads) {
      const prev = prevById.get(thread.id);
      if (!prev || prev.updatedAt !== thread.updatedAt) {
        debouncedPush(`chat:${thread.id}`, () =>
          safeRun("pushChat", async () => {
            const hasUserMessage =
              Array.isArray(thread.messages) &&
              thread.messages.some((m) => m.role === "user");
            if (!hasUserMessage) return;
            try {
              await saveChatThreadToBackend(thread);
            } catch (err) {
              console.error("[firebase-sync] saveChatThreadToBackend failed:", err);
              await syncChat(uid, thread);
            }
          }),
        );
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// Timer cleanup — cancel pending debounced pushes so they can't
// fire after sync is re-enabled (e.g. after hydration or logout).
// ─────────────────────────────────────────────────────────────────

/** Cancel all pending debounced Firestore pushes. Safe to call at
 *  any time — a no-op when no timers are pending. */
export function clearPendingPushTimers(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

export function pauseSyncForLogout(): void {
  setStoreSyncEnabled(false);
  clearPendingPushTimers();
}
