/**
 * UQU AI ENGINE - Consolidated Logic
 * Handles AI Chat interaction, Client-side Tools, and Markdown Rendering.
 */

import { ApiError, errorMessageFromBody, fetchRawWithAuth, fetchWithAuth } from './api';
import { STORAGE_KEYS } from './core'; // STORAGE_KEYS.THEME only (Phase 4C.5)
import {
  buildClientContext,
  dispatchClientActions,
  type ClientAction,
  type ClientContextSnapshot,
} from './chat-client-actions';
import { refreshWorkspaceAfterChat } from './workspace';
import { executeCalendarTool, formatCalendarResults } from './calendar-tool';
import { applyAgentResults } from './agent-results';
import { parseSse } from './sse';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIAction {
  tool: string;
  // Tool payloads are free-form JSON produced by the model/tools.
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
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
  | "agent_error"
  | "quota_exceeded";

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
/** Tools that run entirely on the server — nothing to do in the browser. */
const SERVER_ONLY_TOOLS = new Set([
  'search_regulations', 'get_university_news', 'get_attendance_status', 'record_absence',
  'get_day_schedule', 'get_graduation_progress', 'remember_fact', 'forget_fact',
  'get_course_info', 'get_course_reviews', 'get_student_data', 'analyze_transcript',
  'get_gpa_history', 'predict_gpa_pathway', 'get_upcoming_exams',
]);

export async function executeClientTool(
  name: string,
  args: Record<string, unknown>,
  backendData: Record<string, unknown> | null,
) {
  if (!backendData) return { success: false, error: 'No backend result provided' };
  if (SERVER_ONLY_TOOLS.has(name)) return backendData;

  switch (name) {
    case 'get_calendar_info': {
      // تنفيذ أداة التقويم الجامعي
      const result = executeCalendarTool(args as Parameters<typeof executeCalendarTool>[0]);
      const formattedResults = formatCalendarResults(result.data);
      return {
        ...backendData,
        calendar_data: result.data,
        formatted_text: formattedResults,
        success: result.success,
        message: result.message
      };
    }

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

    case 'add_upcoming_exam':
      // Saved in Firestore by the server; applyAgentResults() adds it to the exams store.
      return backendData;

    case 'add_course':
    case 'update_profile':
      // Server already writes canonical Firestore paths (Phase 4C.5).
      // Do not mirror into legacy uqu_profile_v2 localStorage.
      return backendData;

    case 'change_theme': {
      const theme = args.theme || 'auto';
      if (theme === 'dark') {
        document.documentElement.classList.add("dark");
        try { localStorage.setItem(STORAGE_KEYS.THEME, "dark"); } catch {}
      } else {
        document.documentElement.classList.remove("dark");
        try { localStorage.setItem(STORAGE_KEYS.THEME, "light"); } catch {}
      }
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
/** Side effects of a chat reply: client tools, store mutations, refreshes. */
async function postProcessChatResponse(data: ChatResponse): Promise<void> {
  // Legacy server-tool channel (navigate_to_page, change_theme, ...).
  if (data.actions) {
    for (const action of data.actions) {
      await executeClientTool(action.tool, action.args, action.result);
    }
  }

  // Results of server-side student tools (e.g. record_absence) → local stores.
  applyAgentResults(data.actions);

  // New structured client-action channel (Zustand mutations).
  if (data.client_actions && data.client_actions.length > 0) {
    dispatchClientActions(data.client_actions);
  }

  // Server tools (update_profile, add_course, plan mutations, …) write
  // Firestore but do not patch Zustand — re-hydrate from GET /api/workspace.
  if (data.success && !data.error_type) {
    await refreshWorkspaceAfterChat(data.actions);
  }
}

export interface ChatStreamHandlers {
  onToken?: (text: string) => void;
  onStatus?: (tool: string) => void;
}

export const AIService = {
  async chat(
    messages: Message[],
    opts?: { conversationId?: string | null; clientContext?: ClientContextSnapshot },
  ): Promise<ChatResponse> {
    // Context window limit. System prompts are built server-side and the
    // API rejects client-sent "system" turns, so never forward them.
    const trimmedMessages = messages.filter((m) => m.role !== 'system').slice(-10);

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

      await postProcessChatResponse(data);

      return data;
    } catch (error: unknown) {
      console.error('[AI] Chat error:', error);
      throw error;
    }
  },

  /**
   * Same as chat(), but streams the answer: `onToken` receives text as it
   * is generated and `onStatus` the tool being run ("__reset__" = discard
   * the text shown so far). Falls back to the regular endpoint when
   * streaming is unavailable, so callers never need two code paths.
   */
  async chatStream(
    messages: Message[],
    opts: { conversationId?: string | null; clientContext?: ClientContextSnapshot } & ChatStreamHandlers,
  ): Promise<ChatResponse> {
    const trimmedMessages = messages.filter((m) => m.role !== 'system').slice(-10);
    const clientContext = opts.clientContext ?? safeBuildContext();
    const fallback = () => AIService.chat(messages, { conversationId: opts.conversationId, clientContext });

    let res: Response;
    try {
      res = await fetchRawWithAuth('/api/chat/stream', {
        method: 'POST',
        body: JSON.stringify({
          messages: trimmedMessages,
          conversationId: opts.conversationId ?? null,
          client_context: clientContext,
        }),
      });
    } catch {
      return fallback();
    }
    if (res.status === 404 || res.status === 405 || !res.body) return fallback();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(errorMessageFromBody(err, res.status), res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: ChatResponse | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) buffer += decoder.decode() + '\n\n';
      const { events, rest } = parseSse(buffer);
      buffer = rest;
      for (const ev of events) {
        if (ev.type === 'token' && ev.text) opts.onToken?.(ev.text);
        else if (ev.type === 'status' && ev.tool) opts.onStatus?.(ev.tool);
        else if (ev.type === 'done') final = ev.response as ChatResponse;
        else if (ev.type === 'error') throw new Error(ev.message || 'حدث خطأ أثناء الرد');
      }
      if (done) break;
    }
    if (!final) throw new Error('انقطع الاتصال قبل اكتمال الرد. حاول مرة أخرى.');
    await postProcessChatResponse(final);
    return final;
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
    } catch (err: unknown) {
      // 503 = endpoint deliberately disabled (no GROQ_API_KEY). Signal
      // the caller to use the browser fallback instead of bubbling an
      // error to the user.
      const msg = err instanceof Error ? err.message : '';
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
