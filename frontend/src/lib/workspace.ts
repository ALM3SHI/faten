/**
 * Backend workspace loader — GET /api/workspace (Phase 1).
 * Applies server-normalized data into Zustand stores (same shapes as
 * hydrateUserWorkspace) while direct Firestore sync remains as fallback.
 */

import { api } from "@/lib/api";
import { setStoreSyncEnabled } from "@/lib/firebase/sync";
import { useProfileStore } from "@/store/profileStore";
import { useTranscriptStore } from "@/store/transcriptStore";
import { useScheduleStore } from "@/store/scheduleStore";
import { usePlanStore } from "@/store/planStore";
import { useChatHistoryStore, type ChatThread } from "@/store/chatHistoryStore";

export interface WorkspacePayload {
  success: boolean;
  profile: {
    basic: ReturnType<typeof useProfileStore.getState>["basic"];
    goals: ReturnType<typeof useProfileStore.getState>["goals"];
    preferences: ReturnType<typeof useProfileStore.getState>["preferences"];
    lastUpdated: string | null;
    email?: string | null;
    uid?: string | null;
  };
  transcript: Omit<
    ReturnType<typeof useTranscriptStore.getState>,
    "setTranscript" | "clearTranscript" | "hasTranscript"
  >;
  schedule: {
    schedule: ReturnType<typeof useScheduleStore.getState>["schedule"];
    lastUpdated: string | null;
  };
  plan: {
    plan: ReturnType<typeof usePlanStore.getState>["plan"];
    model: string | null;
    generatedAt: string | null;
    completed: string[];
  };
  chats: {
    threads: Array<{
      id: string;
      title: string;
      preview: string;
      createdAt: string;
      updatedAt: string;
      conversationId: string | null;
      messages: Array<{
        role: string;
        content: string;
        timestamp: string;
        actions?: unknown[];
      }>;
    }>;
  };
  achievements: Record<string, unknown>;
  notifications: Record<string, unknown>[];
}

function parseMessageTimestamp(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return new Date();
}

function hasTranscriptData(
  t: WorkspacePayload["transcript"],
): boolean {
  return (
    t.lastUpdated !== null ||
    (t.completedCourses?.length ?? 0) > 0 ||
    (t.currentCourses?.length ?? 0) > 0 ||
    t.gpa !== null
  );
}

/** Fetch workspace from backend. Throws on network / HTTP errors. */
export async function fetchWorkspace(): Promise<WorkspacePayload> {
  return (await api.get("/api/workspace")) as WorkspacePayload;
}

export type ProfileSaveSlice = {
  basic: ReturnType<typeof useProfileStore.getState>["basic"];
  goals: ReturnType<typeof useProfileStore.getState>["goals"];
  preferences: ReturnType<typeof useProfileStore.getState>["preferences"];
  lastUpdated: string | null;
};

export interface ProfileSaveResponse {
  success: boolean;
  profile: WorkspacePayload["profile"];
}

/** PATCH canonical profile to backend (Phase 2A). Throws on network / HTTP errors. */
export async function saveProfileToBackend(
  slice: ProfileSaveSlice,
): Promise<ProfileSaveResponse> {
  return (await api.patch("/api/workspace/profile", slice)) as ProfileSaveResponse;
}

export type TranscriptSaveSlice = Omit<
  ReturnType<typeof useTranscriptStore.getState>,
  "setTranscript" | "clearTranscript" | "hasTranscript"
>;

export interface TranscriptSaveResponse {
  success: boolean;
  transcript: WorkspacePayload["transcript"];
}

/** PATCH canonical transcript to backend (Phase 2B). Throws on network / HTTP errors. */
export async function saveTranscriptToBackend(
  slice: TranscriptSaveSlice,
): Promise<TranscriptSaveResponse> {
  return (await api.patch("/api/workspace/transcript", slice)) as TranscriptSaveResponse;
}

export type ScheduleSaveSlice = {
  schedule: ReturnType<typeof useScheduleStore.getState>["schedule"];
  lastUpdated: string | null;
};

export interface ScheduleSaveResponse {
  success: boolean;
  schedule: WorkspacePayload["schedule"];
}

/** PATCH canonical schedule to backend (Phase 2C). Throws on network / HTTP errors. */
export async function saveScheduleToBackend(
  slice: ScheduleSaveSlice,
): Promise<ScheduleSaveResponse> {
  return (await api.patch("/api/workspace/schedule", slice)) as ScheduleSaveResponse;
}

export type PlanSaveSlice = {
  plan: ReturnType<typeof usePlanStore.getState>["plan"];
  model: string | null;
  generatedAt: string | null;
  completed: string[];
};

export interface PlanSaveResponse {
  success: boolean;
  plan: WorkspacePayload["plan"];
}

/** PATCH canonical plan to backend (Phase 2D). Throws on network / HTTP errors. */
export async function savePlanToBackend(slice: PlanSaveSlice): Promise<PlanSaveResponse> {
  return (await api.patch("/api/workspace/plan", slice)) as PlanSaveResponse;
}

/** Serialize thread for PATCH body (ISO timestamps; matches sync.ts serializeThread). */
function serializeChatThreadForApi(thread: ChatThread) {
  return {
    id: thread.id,
    title: thread.title,
    preview: thread.preview,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    conversationId: thread.conversationId,
    messages: thread.messages.map((m) => ({
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

export interface ChatThreadSaveResponse {
  success: boolean;
  thread: WorkspacePayload["chats"]["threads"][number];
}

/** PATCH canonical chat thread to backend (Phase 2E). Throws on network / HTTP errors. */
export async function saveChatThreadToBackend(
  thread: ChatThread,
): Promise<ChatThreadSaveResponse> {
  const path = `/api/workspace/chats/${encodeURIComponent(thread.id)}`;
  return (await api.patch(path, serializeChatThreadForApi(thread))) as ChatThreadSaveResponse;
}

export interface ChatThreadDeleteResponse {
  success: boolean;
  threadId: string;
}

/** DELETE canonical chat thread from backend (Phase 2E.1). Throws on network / HTTP errors. */
export async function deleteChatThreadFromBackend(
  threadId: string,
): Promise<ChatThreadDeleteResponse> {
  const path = `/api/workspace/chats/${encodeURIComponent(threadId)}`;
  return (await api.delete(path)) as ChatThreadDeleteResponse;
}

export interface SuppressLegacyFallbackResponse {
  success: boolean;
}

/** POST suppress flag so empty chats skips chat_history on GET (Phase 2E.2). */
export async function suppressChatsLegacyFallback(): Promise<SuppressLegacyFallbackResponse> {
  return (await api.post(
    "/api/workspace/chats/suppress-legacy-fallback",
    {},
  )) as SuppressLegacyFallbackResponse;
}

/** Agent tools that persist to canonical Firestore (not emit_client_action). */
export const CHAT_SERVER_MUTATING_TOOLS = new Set([
  "update_profile",
  "update_learning_preferences",
  "add_course",
  "create_study_plan",
  "complete_task",
  "modify_study_session",
  "generate_semester_master_plan",
  "update_course_grade",
  "add_semester_gpa",
]);

export type ChatToolLogEntry = {
  tool?: string;
  result?: { success?: boolean } | null;
};

/** True when the chat turn wrote profile / transcript / plan on the server. */
export function chatActionsNeedWorkspaceRefresh(
  actions: ChatToolLogEntry[] | undefined,
): boolean {
  if (!Array.isArray(actions) || actions.length === 0) return false;
  return actions.some((entry) => {
    const tool = entry?.tool;
    if (!tool || !CHAT_SERVER_MUTATING_TOOLS.has(tool)) return false;
    const result = entry?.result;
    return (
      result != null &&
      typeof result === "object" &&
      (result as { success?: boolean }).success === true
    );
  });
}

/**
 * Apply workspace payload into Zustand stores.
 * Caller should disable store sync before calling and re-enable after.
 */
export function applyWorkspaceToStores(
  data: WorkspacePayload,
  opts?: { skipChats?: boolean },
): void {
  const { profile, transcript, schedule, plan, chats } = data;

  useProfileStore.setState((prev) => ({
    basic: { ...prev.basic, ...profile.basic },
    goals: { ...prev.goals, ...profile.goals },
    preferences: { ...prev.preferences, ...profile.preferences },
    lastUpdated: profile.lastUpdated ?? prev.lastUpdated,
  }));

  if (hasTranscriptData(transcript)) {
    useTranscriptStore.setState({
      name: transcript.name ?? null,
      nameEn: transcript.nameEn ?? null,
      studentId: transcript.studentId ?? null,
      university: transcript.university ?? null,
      major: transcript.major ?? null,
      faculty: transcript.faculty ?? null,
      degree: transcript.degree ?? null,
      gpa: transcript.gpa ?? null,
      earnedHours: transcript.earnedHours ?? null,
      planHours: transcript.planHours ?? null,
      completedCourses: transcript.completedCourses ?? [],
      currentCourses: transcript.currentCourses ?? [],
      confidence: transcript.confidence ?? 0,
      lastUpdated: transcript.lastUpdated ?? null,
    });
  }

  if (schedule.schedule?.length || schedule.lastUpdated) {
    useScheduleStore.setState({
      schedule: schedule.schedule ?? [],
      lastUpdated: schedule.lastUpdated ?? null,
    });
  }

  if (plan.plan || plan.generatedAt || (plan.completed?.length ?? 0) > 0) {
    usePlanStore.setState({
      plan: plan.plan ?? null,
      model: plan.model ?? null,
      generatedAt: plan.generatedAt ?? null,
      completed: plan.completed ?? [],
    });
  }

  if (opts?.skipChats) return;

  const rawThreads = chats.threads;
  if (!Array.isArray(rawThreads)) return;

  if (rawThreads.length === 0) {
    useChatHistoryStore.setState({
      threads: [],
      activeId: null,
      hasHydrated: true,
    });
    return;
  }

  const threads: ChatThread[] = rawThreads.map((t) => ({
    id: t.id,
    title: t.title || "محادثة",
    preview: t.preview || "",
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    conversationId: t.conversationId ?? null,
    messages: t.messages.map((m) => ({
      role: m.role === "bot" || m.role === "assistant" ? "bot" : "user",
      content: m.content ?? "",
      timestamp: parseMessageTimestamp(m.timestamp),
      actions: m.actions,
    })),
  }));

  threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  useChatHistoryStore.setState({
    threads,
    activeId: null,
    hasHydrated: true,
  });
}

/**
 * Hydrate stores from GET /api/workspace with sync paused.
 * Returns true on success, false when the caller should fall back to Firestore.
 */
export async function hydrateWorkspaceFromApi(): Promise<boolean> {
  setStoreSyncEnabled(false);
  try {
    const data = await fetchWorkspace();
    applyWorkspaceToStores(data);
    return true;
  } catch (err) {
    console.warn("[workspace] API hydrate failed, will use Firestore fallback:", err);
    return false;
  } finally {
    setStoreSyncEnabled(true);
  }
}

/**
 * Re-pull canonical workspace after chat tools wrote on the server.
 * Skips chat threads so the active conversation / sidebar draft stay intact.
 * Sync is paused during apply to avoid echo writes back to Firestore.
 */
export async function refreshWorkspaceAfterChat(
  actions: ChatToolLogEntry[] | undefined,
): Promise<boolean> {
  if (!chatActionsNeedWorkspaceRefresh(actions)) return false;
  setStoreSyncEnabled(false);
  try {
    const data = await fetchWorkspace();
    applyWorkspaceToStores(data, { skipChats: true });
    return true;
  } catch (err) {
    console.warn("[workspace] post-chat refresh failed:", err);
    return false;
  } finally {
    setStoreSyncEnabled(true);
  }
}
