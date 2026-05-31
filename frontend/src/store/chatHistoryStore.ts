/**
 * Chat History Store
 * ────────────────────────────────────────────────────────────────
 * Local, persisted store for past chat threads. Lives in the
 * browser only — the backend also persists messages to Firestore
 * for audit, but this store powers the sidebar UX (instant load,
 * works offline, no extra round-trip).
 *
 *   threads      → list of past conversations, newest first
 *   activeId     → which thread the chat page is currently editing
 *                   (null = unsaved draft, will materialize on first
 *                   message exchange)
 *
 * Persistence: Zustand `persist` middleware → localStorage key
 * `uqu_chat_history_v1`. Messages with Date timestamps are
 * serialized as ISO strings and rehydrated back to Date.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage } from "./workspaceStore";

export interface ChatThread {
  id: string;
  title: string;             // derived from first user message; user-editable
  preview: string;           // last message snippet for the sidebar
  createdAt: string;         // ISO
  updatedAt: string;         // ISO
  messages: ChatMessage[];
  /** Backend conversation id so the server can keep its own log in sync. */
  conversationId: string | null;
}

interface ChatHistoryState {
  /** Firebase UID that owns this persisted snapshot; null = untrusted legacy cache. */
  ownerUid: string | null;
  threads: ChatThread[];
  activeId: string | null;
  hasHydrated: boolean;

  /** Persist the current message list under the active thread (creating one if needed). */
  saveActiveThread: (
    messages: ChatMessage[],
    conversationId: string | null,
  ) => string;

  /** Switch to a saved thread and return its message list (or null if missing). */
  loadThread: (id: string) => ChatThread | null;

  startNewThread: () => void;
  deleteThread: (id: string) => void;
  clearAll: () => void;
}

const TITLE_MAX = 60;
const PREVIEW_MAX = 120;

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "محادثة جديدة";
  const t = firstUser.content.trim().replace(/\s+/g, " ");
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX - 1) + "…" : t || "محادثة جديدة";
}

function derivePreview(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  const t = last.content.trim().replace(/\s+/g, " ");
  return t.length > PREVIEW_MAX ? t.slice(0, PREVIEW_MAX - 1) + "…" : t;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export const useChatHistoryStore = create<ChatHistoryState>()(
  persist(
    (set, get) => ({
      ownerUid: null,
      threads: [],
      activeId: null,
      hasHydrated: false,

      saveActiveThread: (messages, conversationId) => {
        // Don't persist a thread that has no actual exchange yet.
        const exchange = messages.some((m) => m.role === "user");
        if (!exchange) return get().activeId ?? "";

        const id = get().activeId ?? newId();
        const now = nowIso();
        const existing = get().threads.find((t) => t.id === id);
        const title = existing?.title || deriveTitle(messages);
        const preview = derivePreview(messages);
        const createdAt = existing?.createdAt ?? now;

        const updated: ChatThread = {
          id,
          title,
          preview,
          createdAt,
          updatedAt: now,
          messages,
          conversationId,
        };

        set((s) => {
          const others = s.threads.filter((t) => t.id !== id);
          return {
            threads: [updated, ...others], // newest first
            activeId: id,
          };
        });
        return id;
      },

      loadThread: (id) => {
        const found = get().threads.find((t) => t.id === id) ?? null;
        if (found) {
          set({ activeId: id });
        }
        return found;
      },

      startNewThread: () => {
        set({ activeId: null });
      },

      deleteThread: (id) => {
        set((s) => ({
          threads: s.threads.filter((t) => t.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        }));
      },

      clearAll: () => set({ ownerUid: null, threads: [], activeId: null }),
    }),
    {
      name: "uqu_chat_history_v1",
      partialize: (s) => ({
        ownerUid: s.ownerUid,
        threads: s.threads,
        activeId: s.activeId,
      }),
      // Date objects don't survive JSON round-trips — restore them.
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        useChatHistoryStore.setState({
          threads: state.threads.map((t) => ({
            ...t,
            messages: t.messages.map((m) => ({
              ...m,
              timestamp:
                m.timestamp instanceof Date
                  ? m.timestamp
                  : new Date(m.timestamp as unknown as string),
            })),
          })),
          hasHydrated: true,
        });
      },
    },
  ),
);
