/**
 * UQU AI ENGINE - Consolidated Logic
 * Handles AI Chat interaction, Client-side Tools, and Markdown Rendering.
 */

import { fetchWithAuth } from './api';
import { Storage, STORAGE_KEYS } from './core'; // STORAGE_KEYS.THEME only (Phase 4C.5)
import {
  buildClientContext,
  dispatchClientActions,
  type ClientAction,
  type ClientContextSnapshot,
} from './chat-client-actions';
import { refreshWorkspaceAfterChat } from './workspace';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIAction {
  tool: string;
  args: any;
  result: any;
}

/** Classified failure category from the backend chat router. `null` /
 *  undefined on a normal answer; one of these strings when the agent
 *  couldn't produce a real reply. The chat UI uses this to render the
 *  bubble in a warning style instead of the normal bot style. */
export type ChatErrorType =
  | "api_limit"
  | "api_auth"
  | "api_unavailable"
  | "api_timeout"
  | "agent_error";

export interface ChatResponse {
  success: boolean;
  message: string;
  /** Legacy server-side tool execution log — kept for the existing
   *  `executeClientTool` path (navigate_to_page, change_theme, etc). */
  actions?: AIAction[];
  /** New structured directives the agent emitted via emit_client_action;
   *  dispatched into the Zustand stores by `dispatchClientActions`. */
  client_actions?: ClientAction[];
  conversationId?: string;
  error_type?: ChatErrorType | null;
}

/**
 * Execute client-side tool effects (The "Hands" of the AI)
 */
export async function executeClientTool(name: string, args: any, backendData: any) {
  if (!backendData) return { success: false, error: 'No backend result provided' };

  switch (name) {
    case 'navigate_to_page': {
      // ⚠️ Auto-redirect removed — was hijacking the user mid-read.
      // The args still flow through `response.actions` so the chat
      // page can render a manual CTA button (see NavigationCTA).
      return backendData;
    }

    case 'open_page': {
      // ⚠️ Auto-redirect removed for the same reason as above.
      return backendData;
    }

    case 'add_upcoming_exam': {
      const exams = Storage.get('uqu_exams', []) as any[];
      const exam = { ...args, id: backendData.id || Date.now(), done: false, createdAt: new Date().toISOString() };
      exams.push(exam);
      Storage.set('uqu_exams', exams);
      return backendData;
    }

    case 'add_course':
    case 'update_profile':
      // Server already writes canonical Firestore paths (Phase 4C.5).
      // Do not mirror into legacy uqu_profile_v2 localStorage.
      return backendData;

    case 'change_theme': {
      const theme = args.theme || 'auto';
      document.body.setAttribute('data-theme', theme);
      Storage.set(STORAGE_KEYS.THEME, theme);
      return backendData;
    }

    case 'emit_client_action':
      // Handled by the dispatcher in AIService.chat (data.client_actions).
      // No-op here — we just acknowledge the legacy actions[] entry so
      // it doesn't trigger the "tool not handled" warning.
      return backendData;

    default:
      console.warn(`[AI] Tool not handled: ${name}`);
      return backendData;
  }
}

/**
 * Defensive context builder — never lets a snapshot failure block a
 * chat send. If the stores aren't hydrated yet (e.g., very first paint),
 * fall back to an empty object so the request still goes through.
 */
function safeBuildContext(): ClientContextSnapshot | undefined {
  try {
    return buildClientContext();
  } catch (err) {
    console.warn('[AI] context build failed:', err);
    return undefined;
  }
}

/**
 * Core AI Chat service.
 *
 * Every send pushes a live snapshot of the user's stores so the agent's
 * answer is based on what the user actually sees, not stale Firestore
 * data. Structured `client_actions` returned by the agent are dispatched
 * into the Zustand stores before the response is handed back to the page.
 */
export const AIService = {
  async chat(
    messages: Message[],
    opts?: { conversationId?: string | null; clientContext?: ClientContextSnapshot },
  ): Promise<ChatResponse> {
    const trimmedMessages = messages.slice(-10); // Context window limit

    // Build the snapshot on every call so the agent sees the freshest
    // state — including edits the user just made in another tab.
    const clientContext = opts?.clientContext ?? safeBuildContext();

    try {
      const data: ChatResponse = await fetchWithAuth('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: trimmedMessages,
          conversationId: opts?.conversationId ?? null,
          client_context: clientContext,
        }),
      });

      // Legacy server-tool channel (navigate_to_page, change_theme, ...).
      if (data.actions) {
        for (const action of data.actions) {
          await executeClientTool(action.tool, action.args, action.result);
        }
      }

      // New structured client-action channel (Zustand mutations).
      if (data.client_actions && data.client_actions.length > 0) {
        dispatchClientActions(data.client_actions);
      }

      // Server tools (update_profile, add_course, plan mutations, …) write
      // Firestore but do not patch Zustand — re-hydrate from GET /api/workspace.
      if (data.success && !data.error_type) {
        await refreshWorkspaceAfterChat(data.actions);
      }

      return data;
    } catch (error: any) {
      console.error('[AI] Chat error:', error);
      throw error;
    }
  },

  /**
   * Transcribe an audio blob to text via the backend STT endpoint
   * (Groq Whisper). Returns the recognized text, or null when the
   * server isn't configured for STT (the caller can then fall back
   * to the browser's built-in Web Speech API).
   */
  async transcribe(audio: Blob, languageHint: string = 'ar'): Promise<string | null> {
    const form = new FormData();
    // Most browsers record `audio/webm;codecs=opus` from MediaRecorder.
    const filename = `speech.${audio.type.includes('mp4') ? 'm4a' : 'webm'}`;
    form.append('audio', audio, filename);
    form.append('language', languageHint);

    try {
      const data = await fetchWithAuth('/api/stt/transcribe', {
        method: 'POST',
        body: form,
      });
      return (data?.text as string) ?? '';
    } catch (err: any) {
      // 503 = endpoint deliberately disabled (no GROQ_API_KEY). Signal
      // the caller to use the browser fallback instead of bubbling an
      // error to the user.
      const msg = String(err?.message ?? '');
      if (msg.includes('503') || msg.includes('غير مفعّلة')) return null;
      throw err;
    }
  },

  /**
   * Simple markdown-lite renderer for AI responses
   */
  renderMarkdown(text: string): string {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
};
