import { create } from 'zustand';

// Strict per-zone cap. The workspace UI is `overflow-hidden` on each column —
// no scrollbars — so we cannot exceed this without clipping. Two widgets per
// zone is the maximum that fits comfortably in the layout's vertical budget.
export const MAX_WIDGETS_PER_ZONE = 2;

/** Deferred-navigation hint the chat UI renders as a clickable CTA
 *  below a bot bubble. The agent emits these via NAVIGATE / legacy
 *  navigate_to_page, but the chat NEVER auto-redirects — the button is
 *  the user's choice. Built in app/chat/page.tsx :: extractSuggestedActions. */
export interface SuggestedNavigation {
  /** In-app path, e.g. "/plan" or "/locations?target=ROOM_1". */
  path: string;
  /** Arabic label for the CTA button. */
  label: string;
  /** Optional emoji glyph rendered alongside the label. */
  icon?: string;
}

/** Failure category — set by the backend on a bad request, or by the
 *  chat page when fetch itself fails (network unreachable, etc).
 *  Drives the warning-styled bubble in the chat. */
export type ChatErrorType =
  | "api_limit"
  | "api_auth"
  | "api_unavailable"
  | "api_timeout"
  | "agent_error"
  | "quota_exceeded"
  | "network";

export type ChatMessage = {
  role: "user" | "bot";
  content: string;
  timestamp: Date;
  actions?: { tool?: string; args?: Record<string, unknown>; result?: unknown }[];
  /** Manual navigation suggestions attached to a bot reply. */
  suggestedActions?: SuggestedNavigation[];
  /** Non-null when this bubble represents an error/system warning
   *  rather than a normal model reply. */
  errorType?: ChatErrorType | null;
  /** The student's 👍/👎 on this reply (local UI state). */
  feedback?: "up" | "down" | null;
};

interface WorkspaceState {
  chatInputDraft: string;
  setChatInputDraft: (draft: string) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  leftTools: string[];
  setLeftTools: (tools: string[] | ((prev: string[]) => string[])) => void;
  rightTools: string[];
  setRightTools: (tools: string[] | ((prev: string[]) => string[])) => void;
  addTool: (tool: string, preferredZone?: 'left' | 'right') => void;
  removeTool: (tool: string, zone: 'left' | 'right') => void;
  moveTool: (tool: string, sourceZone: 'left' | 'right', targetZone: 'left' | 'right') => void;
  isDragging: boolean;
  setIsDragging: (isDragging: boolean) => void;
  isWorkspaceEnabled: boolean;
  setIsWorkspaceEnabled: (enabled: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  chatInputDraft: "",
  setChatInputDraft: (draft) => set({ chatInputDraft: draft }),
  chatMessages: [
    {
      role: "bot",
      content: "أهلاً بك! أنا المساعد الأكاديمي الذكي لجامعة أم القرى. كيف يمكنني مساعدةك اليوم؟",
      timestamp: new Date(),
    }
  ],
  setChatMessages: (messages) => set((state) => ({ 
    chatMessages: typeof messages === 'function' ? messages(state.chatMessages) : messages 
  })),
  leftTools: [],
  setLeftTools: (tools) => set((state) => ({
    leftTools: (typeof tools === 'function' ? tools(state.leftTools) : tools).slice(0, MAX_WIDGETS_PER_ZONE)
  })),
  rightTools: [],
  setRightTools: (tools) => set((state) => ({
    rightTools: (typeof tools === 'function' ? tools(state.rightTools) : tools).slice(0, MAX_WIDGETS_PER_ZONE)
  })),
  // ─── Smart Auto-Spill ──────────────────────────────────────────────────────
  // Core UX guarantee for opening tools via quick actions / chat suggestions.
  //
  //   1. If the tool is already mounted in either zone → no-op (don't duplicate).
  //   2. If the preferred zone has room (< 2 tools)    → mount it there.
  //   3. If the preferred zone is full but the OTHER   → auto-spill into the
  //      zone has room                                    other zone (this is
  //                                                       what avoids ever
  //                                                       needing a scrollbar).
  //   4. If BOTH zones are full (4 tools total)        → replace the OLDEST
  //                                                       tool in the preferred
  //                                                       zone (newest tools
  //                                                       are prepended, so
  //                                                       "oldest" = last).
  //
  // Drag-and-drop (moveTool) deliberately does NOT auto-spill — it respects
  // the user's explicit drop target and refuses if that target is full.
  addTool: (tool, preferredZone = 'left') => set((state) => {
    if (state.leftTools.includes(tool) || state.rightTools.includes(tool)) return state;

    const primaryKey = preferredZone === 'left' ? 'leftTools' : 'rightTools';
    const fallbackKey = preferredZone === 'left' ? 'rightTools' : 'leftTools';
    const primary = state[primaryKey];
    const fallback = state[fallbackKey];

    if (primary.length < MAX_WIDGETS_PER_ZONE) {
      return { [primaryKey]: [tool, ...primary] } as Partial<WorkspaceState>;
    }
    if (fallback.length < MAX_WIDGETS_PER_ZONE) {
      // Auto-spill into the opposite zone.
      return { [fallbackKey]: [tool, ...fallback] } as Partial<WorkspaceState>;
    }
    // Both zones at capacity: replace the oldest tool in the preferred zone.
    return { [primaryKey]: [tool, ...primary.slice(0, MAX_WIDGETS_PER_ZONE - 1)] } as Partial<WorkspaceState>;
  }),
  removeTool: (tool, zone) => set((state) => {
    if (zone === 'left') {
      return { leftTools: state.leftTools.filter(t => t !== tool) };
    } else {
      return { rightTools: state.rightTools.filter(t => t !== tool) };
    }
  }),
  moveTool: (tool, sourceZone, targetZone) => set((state) => {
    if (sourceZone === targetZone) return state;

    const targetTools = targetZone === 'left' ? state.leftTools : state.rightTools;
    if (targetTools.length >= MAX_WIDGETS_PER_ZONE) return state;

    const newLeftTools = sourceZone === 'left' ? state.leftTools.filter(t => t !== tool) : state.leftTools;
    const newRightTools = sourceZone === 'right' ? state.rightTools.filter(t => t !== tool) : state.rightTools;

    if (targetZone === 'left') {
      return { leftTools: [...newLeftTools, tool], rightTools: newRightTools };
    } else {
      return { leftTools: newLeftTools, rightTools: [...newRightTools, tool] };
    }
  }),
  isDragging: false,
  setIsDragging: (isDragging) => set({ isDragging }),
  isWorkspaceEnabled: true,
  setIsWorkspaceEnabled: (enabled) => set({ isWorkspaceEnabled: enabled })
}));
