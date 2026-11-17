"use client";

import { Navbar } from "@/components/navbar";
import { useHydrated } from "@/lib/use-hydrated";
import { Sparkles, User as UserIcon, History, Settings, Trash2, ArrowLeft, ThumbsUp, ThumbsDown } from "lucide-react";
import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ChatResponse } from "@/lib/ai";
import type { SuggestedNavigation } from "@/store/workspaceStore";
import { BotMarkdown } from "@/components/bot-markdown";
import { SourceCards } from "@/components/chat/source-cards";
import { toolStatusLabel } from "@/lib/sse";
import { useBackendStatus } from "@/lib/backend-status";
import { api, ApiError, NETWORK_ERROR_MESSAGE } from "@/lib/api";
import { SmartLoadingIndicator } from "@/components/smart-loading-indicator";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton, buttonClass } from "@/components/ds/button";
import { AIService, Message as AIMessage } from "@/lib/ai";
import { motion, AnimatePresence } from "framer-motion";
import { ChatInput } from "@/components/chat-input";
import { ChatModeSwitch } from "@/components/tutor/mode-switch";
import { ChatHistoryDrawer } from "@/components/chat-history-drawer";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceStore, ChatMessage as Message } from "@/store/workspaceStore";
import { useChatHistoryStore } from "@/store/chatHistoryStore";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/lib/toast";
import { handoffFor } from "@/lib/faten-handoff";

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ChatPageContent />
    </Suspense>
  );
}

const NEW_CHAT_WELCOME =
  "أهلاً بك من جديد! بدأنا محادثة جديدة. كيف يمكنني مساعدتك؟";

// ── Manual navigation CTA helpers ─────────────────────────────────────
// The agent used to hard-redirect via `window.location.assign(path)` /
// `router.push(path)` when generate_semester_master_plan succeeded.
// That hijacks the user's reading flow — explicitly banned UX. We now
// extract the agent's NAVIGATE / navigate_to_page hints and render
// them as clickable CTA buttons under the bot bubble. The user
// navigates only when *they* click.
const NAV_PATH_META: Record<string, { label: string; icon: string }> = {
  "/dashboard":  { label: "فتح «اليوم»",                icon: "🏠" },
  "/time":       { label: "فتح «وقتي»",                 icon: "🗓️" },
  "/record":     { label: "فتح «معدّلي»",               icon: "🎓" },
  "/study":      { label: "ذاكر محاضرة",                icon: "📚" },
  "/exams":      { label: "فتح جدول الاختبارات",        icon: "📝" },
  "/attendance": { label: "فتح الغياب",                 icon: "🛡️" },
  "/advisor":    { label: "فتح المرشد الأكاديمي",       icon: "🧭" },
  "/plan":       { label: "عرض الخطة الدراسية",       icon: "📅" },
  "/gpa":        { label: "فتح حاسبة المعدل",          icon: "📊" },
  "/locations":  { label: "فتح خريطة القاعات",          icon: "🗺️" },
  "/pomodoro":   { label: "فتح مؤقت البومودورو",        icon: "⏱️" },
  "/profile":    { label: "فتح الملف الشخصي",              icon: "👤" },
  "/transcript": { label: "فتح السجل الأكاديمي",        icon: "🎓" },
  "/schedule":   { label: "فتح الجدول الأسبوعي",        icon: "🗓️" },
  "/community":  { label: "فتح تقييمات المواد",          icon: "💬" },
};

/** Older agent replies (and saved threads) may still point at retired paths. */
const LEGACY_PATHS: Record<string, string> = { "/map": "/locations" };

/** Starter questions shown on an empty conversation — one per thing the
 *  assistant is genuinely good at, phrased the way students ask. */
const STARTER_PROMPTS = [
  "وش عندي محاضرات بكرة؟",
  "كم باقي لي غياب قبل الحرمان؟",
  "كم نسبة الغياب اللي تحرمني من الاختبار؟",
  "حلّل سجلي الأكاديمي ووش أركّز عليه",
  "متى الاختبارات النهائية هذا الفصل؟",
  "سوّ لي خطة مذاكرة لهذا الأسبوع",
];

/** Translate an in-app path into an Arabic CTA label + glyph. Falls
 *  back to the raw path so unknown destinations still render a usable
 *  button (and we don't crash on an off-spec NAVIGATE payload). */
function labelForPath(path: string): { label: string; icon: string } {
  // Match the bare path (ignore query/hash) against the meta table.
  const bare = path.split(/[?#]/)[0];
  if (NAV_PATH_META[bare]) return NAV_PATH_META[bare];
  if (bare.startsWith("/locations")) return NAV_PATH_META["/locations"];
  return { label: `الانتقال إلى ${bare}`, icon: "↗️" };
}

/** Pull NAVIGATE (new schema) + navigate_to_page/open_page (legacy
 *  schema) out of a chat response and produce a deduped list of
 *  CTA hints to attach to the bot message. */
function extractSuggestedActions(response: ChatResponse): SuggestedNavigation[] {
  const out: SuggestedNavigation[] = [];
  const seen = new Set<string>();
  const push = (candidate: unknown) => {
    if (typeof candidate !== "string") return;
    if (!candidate.startsWith("/") || candidate.startsWith("//")) return;
    const [bare, rest = ""] = candidate.split(/(?=[?#])/);
    const rawPath: string = (LEGACY_PATHS[bare] ?? bare) + rest;
    if (seen.has(rawPath)) return;
    seen.add(rawPath);
    const meta = labelForPath(rawPath);
    out.push({ path: rawPath, label: meta.label, icon: meta.icon });
  };

  // New schema: emit_client_action(type=NAVIGATE).
  for (const a of response.client_actions ?? []) {
    if (a?.type === "NAVIGATE") {
      push((a.payload as { path?: unknown } | undefined)?.path);
    }
  }
  // Legacy schema: tool calls in actions[].
  for (const a of response.actions ?? []) {
    if (a?.tool === "open_page" && a.args?.page) {
      const p = String(a.args.page).startsWith("/")
        ? a.args.page
        : `/${a.args.page}`;
      push(p);
    } else if (a?.tool === "navigate_to_page" && a.args?.roomId) {
      push(`/locations?target=${encodeURIComponent(String(a.args.roomId))}`);
    }
  }
  return out;
}

/**
 * Add the button to the mode built for this question («المرشد» or «ذاكر»)
 * when the agent did not already suggest it (lib/faten-handoff.ts).
 */
function withHandoff(actions: SuggestedNavigation[], question: string): SuggestedNavigation[] {
  const path = handoffFor(question);
  if (!path || actions.some((a) => a.path.split(/[?#]/)[0] === path)) return actions;
  const meta = labelForPath(path);
  return [...actions, { path, label: meta.label, icon: meta.icon }];
}

/** Sleek inline CTA row. Uses Next.js <Link> for client-side SPA
 *  transition — no full page reload, the user just lands on the page
 *  with the chat history intact in localStorage / Firestore. */
function NavigationCTA({ actions }: { actions: SuggestedNavigation[] }) {
  if (!actions.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2" dir="rtl">
      {actions.map((a) => (
        <Link
          key={a.path}
          href={a.path}
          className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-info-line bg-info-soft px-4 text-small font-semibold text-info-ink motion-fast transition-colors hover:border-info-ink focus-ring"
        >
          <span aria-hidden>{a.icon}</span>
          <span>{a.label}</span>
          <ArrowLeft className="size-4 opacity-70 motion-fast transition-transform group-hover:-translate-x-0.5" aria-hidden />
        </Link>
      ))}
    </div>
  );
}

function ChatPageContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("query");
  const [hasInitialized, setHasInitialized] = useState(false);

  const {
    chatInputDraft: input,
    setChatInputDraft: setInput,
    chatMessages: messages,
    setChatMessages: setMessages,
  } = useWorkspaceStore();

  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const mounted = useHydrated();
  const scrollRef = useRef<HTMLDivElement>(null);
  const clearAllThreads = useChatHistoryStore((s) => s.clearAll);
  const activeId = useChatHistoryStore((s) => s.activeId);
  const deleteThread = useChatHistoryStore((s) => s.deleteThread);

  // Chat-history persistence (localStorage). The store materialises a
  // thread on the first user↔assistant exchange and updates it on every
  // subsequent message — no manual "save" button needed.
  const saveActiveThread = useChatHistoryStore((s) => s.saveActiveThread);
  const loadThreadFromStore = useChatHistoryStore((s) => s.loadThread);
  const startNewThread = useChatHistoryStore((s) => s.startNewThread);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const resetToNewConversation = useCallback(
    (options?: { clearInput?: boolean }) => {
      startNewThread();
      setMessages([
        {
          role: "bot",
          content: NEW_CHAT_WELCOME,
          timestamp: new Date(),
        },
      ]);
      setConversationId(null);
      if (options?.clearInput) setInput("");
    },
    [setMessages, setInput, startNewThread],
  );

  const handleDeleteThread = useCallback(
    (threadId: string) => {
      const wasActive = activeId === threadId;
      deleteThread(threadId);
      if (wasActive) resetToNewConversation({ clearInput: true });
    },
    [activeId, deleteThread, resetToNewConversation],
  );


  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  // ── Server wake-up (free hosting sleeps when idle) ──
  const backendStatus = useBackendStatus((st) => st.status);
  const [slowReply, setSlowReply] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlowReply(false);
      return;
    }
    const t = setTimeout(() => setSlowReply(true), 8000);
    return () => clearTimeout(t);
  }, [isLoading]);

  // ── Live streaming state (text arrives token by token) ──
  const [streamText, setStreamText] = useState("");
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const streamBufRef = useRef("");
  const flushRef = useRef<number | null>(null);
  const scheduleStreamFlush = () => {
    if (flushRef.current !== null) return;
    flushRef.current = requestAnimationFrame(() => {
      flushRef.current = null;
      setStreamText(streamBufRef.current);
      if (streamBufRef.current) setStreamStatus(null);
    });
  };
  const resetStream = () => {
    if (flushRef.current !== null) cancelAnimationFrame(flushRef.current);
    flushRef.current = null;
    streamBufRef.current = "";
    setStreamText("");
    setStreamStatus(null);
  };

  useEffect(() => {
    if (streamText && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamText]);

  const handleSend = async (overrideInput?: string) => {
    const textToSend = typeof overrideInput === "string" ? overrideInput : input;
    if (!textToSend.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: textToSend,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    if (typeof overrideInput !== "string") {
      setInput("");
    }
    setIsLoading(true);

    try {
      const history: AIMessage[] = messages.map(m => ({
        role: m.role === "bot" ? "assistant" : "user",
        content: m.content
      }));
      history.push({ role: "user", content: textToSend });

      const response = await AIService.chatStream(history, {
        conversationId,
        onToken: (t) => {
          streamBufRef.current += t;
          scheduleStreamFlush();
        },
        onStatus: (tool) => {
          // Text streamed before a tool call (or before a retry) is a
          // preamble — clear it and show what the agent is doing instead.
          streamBufRef.current = "";
          setStreamText("");
          setStreamStatus(tool === "__reset__" ? null : toolStatusLabel(tool));
        },
      });
      resetStream();
      if (response.conversationId) setConversationId(response.conversationId);

      const botMessage: Message = {
        role: "bot",
        content: response.message,
        timestamp: new Date(),
        actions: response.actions,
        // Surface any NAVIGATE / navigate_to_page / open_page hints as
        // clickable CTA buttons — never as an auto-redirect.
        suggestedActions: withHandoff(extractSuggestedActions(response), userMessage.content),
        // When the backend classified the reply as an error
        // (api_limit / api_auth / …), tag the message so the render
        // layer styles it as a warning bubble.
        errorType: response.error_type ?? null,
      };
      const finalMessages = [...messages, userMessage, botMessage];
      setMessages(finalMessages);
      // Persist this exchange to the history sidebar.
      saveActiveThread(finalMessages, response.conversationId ?? null);
      setIsLoading(false);
    } catch (error) {
      resetStream();
      console.error("Chat error:", error);
      // Surface the real server-side message when we can — the previous
      // generic "خطأ في الاتصال" hid the actual cause (missing API key,
      // 401 token, etc.) and made debugging painful.
      const detail =
        error instanceof Error && error.message
          ? error.message
          : "فشل غير معروف.";
      const isNetwork =
        (error instanceof ApiError && error.status === 0) ||
        /failed to fetch|networkerror|typeerror/i.test(detail);
      const friendly = isNetwork
        ? NETWORK_ERROR_MESSAGE
        : `حدث خطأ أثناء الاتصال بالمساعد:\n${detail}`;
      setMessages((prev) => [...prev, {
        role: "bot",
        content: friendly,
        timestamp: new Date(),
        // Tag the bubble as an error so render renders it in warning
        // style (orange border, alert icon) instead of normal bot style.
        errorType: isNetwork ? "network" : "agent_error",
      }]);
      setIsLoading(false);
    }
  };
  // Auto-send a query passed in the URL (?q=...) once, after handleSend exists.
  useEffect(() => {
    if (initialQuery && !hasInitialized) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot guard for the URL query
      setHasInitialized(true);
      setTimeout(() => {
        handleSend(initialQuery);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, hasInitialized]);

  return (
    <div className="ds-page flex h-[calc(100dvh-var(--bottom-nav-h))] flex-col overflow-hidden bg-canvas text-ink" dir="rtl">
      <Navbar />

      <main className="flex-1 flex overflow-hidden w-full p-4 pt-20 gap-4">

        {/* CHAT CENTER */}
        <motion.div
          layout
          initial={false}
          className="h-full flex flex-col relative transition-all duration-500 w-full max-w-5xl mx-auto"
        >
          <h1 className="sr-only">اسأل فطن</h1>
          {/* Control bar: history, the three modes of فطن, settings. */}
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1 pb-2">
            {/* Right: History */}
            <Button variant="quiet" size="sm" onClick={() => setIsHistoryOpen(true)} className="text-ink-muted hover:text-ink">
              <History aria-hidden />
              {/* Visible on wider screens; always the button's name. */}
              <span className="sr-only sm:not-sr-only">سجل الدردشات</span>
            </Button>

            {/* Middle: general chat ↔ guided study mode (/tutor) */}
            <ChatModeSwitch active="chat" />

            {/* Left: Settings dropdown (Task 2) */}
            <DropdownMenu>
              <DropdownMenuTrigger className={buttonClass({ variant: "quiet", size: "sm", className: "text-ink-muted hover:text-ink" })}>
                <span className="sr-only sm:not-sr-only">الإعدادات</span>
                <Settings aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56 border border-line bg-surface-raised text-ink shadow-menu">
                <DropdownMenuItem
                  onClick={() => setClearHistoryOpen(true)}
                  className="gap-2 text-small text-danger-ink focus:bg-danger-soft focus:text-danger-ink"
                >
                  <Trash2 className="size-4" aria-hidden />
                  <span>مسح سجل المحادثة</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Messages Container */}
          <div
            ref={scrollRef}
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-32 sm:px-6"
            dir="rtl"
          >
            {(backendStatus === "waking" || backendStatus === "down") && (
                <div className="mx-auto max-w-md rounded-card border border-warning-line bg-warning-soft px-4 py-2 text-center text-small text-warning-ink" role="status">
                  {backendStatus === "waking"
                    ? "جارٍ تجهيز المساعد… أول استخدام بعد فترة هدوء قد يأخذ حتى دقيقة."
                    : "تعذّر الوصول للمساعد حالياً. تحقق من اتصالك وحاول بعد قليل."}
                </div>
              )}
            <AnimatePresence initial={false}>
              {messages.map((msg, idx) => {
                const isBot = msg.role === "bot";
                const isError = Boolean(isBot && msg.errorType);
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "flex gap-3 items-start w-full",
                      isBot ? "flex-row" : "flex-row-reverse"
                    )}
                  >
                    {/* Avatar — switches to a warning-tinted disk for
                        error bubbles so the eye lands on it first. */}
                    {isBot ? (
                      isError ? (
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-warning-line bg-warning-soft text-warning-ink" aria-hidden>
                          <AlertTriangle className="size-4" />
                        </div>
                      ) : (
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand" aria-hidden>
                          <Sparkles className="size-4" />
                        </div>
                      )
                    ) : (
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-info-line bg-info-soft text-info-ink" aria-hidden>
                        <UserIcon className="size-4" />
                      </div>
                    )}

                    {/* Bubble */}
                    <div className={cn(
                      "flex max-w-[85%] flex-col gap-1.5 sm:max-w-[75%]",
                      isBot ? "items-start" : "items-end"
                    )}>
                      <div className={cn(
                        "rounded-card px-4 py-3 text-body",
                        !isBot && "rounded-tr-sm bg-brand text-start text-on-brand",
                        isBot && !isError && "rounded-tl-sm border border-line bg-surface text-start text-ink shadow-card",
                        // A system notice, not an answer to act on.
                        isBot && isError && "rounded-tl-sm border border-warning-line bg-warning-soft text-start text-ink"
                      )}>
                        {isBot ? (
                          isError ? (
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          ) : (
                            <BotMarkdown content={msg.content} />
                          )
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        )}
                      </div>
                      {isBot && !isError && <SourceCards content={msg.content} actions={msg.actions} />}
                      {isBot && !isError && idx > 0 && messages[idx - 1]?.role === "user" && (
                        <ReplyFeedback
                          msg={msg}
                          question={messages[idx - 1].content}
                          conversationId={conversationId}
                          onRated={(rating) =>
                            setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, feedback: rating } : m)))
                          }
                        />
                      )}
                      {/* Manual navigation CTAs — only rendered if the
                          agent suggested a destination. Click is the
                          ONLY way the page changes. */}
                      {isBot && msg.suggestedActions && msg.suggestedActions.length > 0 && (
                        <NavigationCTA actions={msg.suggestedActions} />
                      )}
                      <span className="nums px-1 text-caption text-ink-muted" suppressHydrationWarning>
                        {mounted
                          ? msg.timestamp.toLocaleTimeString("ar-SA-u-nu-latn", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </div>
                  </motion.div>
                );
              })}

              {isLoading && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3 items-start w-full flex-row"
                >
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand motion-safe:animate-pulse" aria-hidden>
                    <Sparkles className="size-4" />
                  </div>
                  {streamText ? (
                    <div className="max-w-[85%] rounded-card rounded-tl-sm border border-line bg-surface px-4 py-3 text-start text-body text-ink shadow-card sm:max-w-[75%]">
                      <BotMarkdown content={streamText} />
                      <span aria-hidden className="inline-block h-4 w-1.5 rounded-sm bg-brand align-middle motion-safe:animate-pulse" />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 items-start">
                      <SmartLoadingIndicator />
                      {(streamStatus || slowReply) && (
                        <span className="px-2 text-small text-ink-muted" aria-live="polite">
                          {streamStatus ?? "الخادم يصحى بعد فترة هدوء — أول رد قد يأخذ حتى دقيقة."}
                        </span>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          {/* Starter prompts — only on a fresh conversation */}
            {!isLoading && !messages.some((m) => m.role === "user") && (
              <div className="mt-auto pt-6">
                <p className="mb-3 text-center text-small font-semibold text-ink-muted">جرّب تسأل:</p>
                <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2">
                  {STARTER_PROMPTS.map((q) => (
                    <Button key={q} size="sm" onClick={() => handleSend(q)} className="h-auto min-h-11 whitespace-normal rounded-full py-2 text-start font-medium">
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Floating Input Pill */}
          <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-canvas from-60% to-transparent px-2 pt-6 pb-4 sm:px-4">
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={() => handleSend()}
              isLoading={isLoading}
            />
          </div>
        </motion.div>

      </main>

      {/* Drawers / Modals — overlay layer above the workspace */}
      <ConfirmDialog
        open={clearHistoryOpen}
        onOpenChange={setClearHistoryOpen}
        title="مسح سجل المحادثة"
        description="هل تريد مسح سجل المحادثة بالكامل؟ لا يمكن التراجع."
        confirmLabel="مسح الكل"
        destructive
        onConfirm={() => {
          clearAllThreads();
          resetToNewConversation({ clearInput: true });
          toast.success("تم مسح سجل المحادثة");
        }}
      />

      <ChatHistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onSelectThread={(id) => {
          const thread = loadThreadFromStore(id);
          if (!thread) return;
          setMessages(thread.messages);
          setConversationId(thread.conversationId);
          setIsHistoryOpen(false);
        }}
        onDeleteThread={handleDeleteThread}
        onNewThread={() => {
          resetToNewConversation();
          setIsHistoryOpen(false);
        }}
      />
    </div>
  );
}

// ── 👍/👎 on a reply ────────────────────────────────────────────────
function ReplyFeedback({
  msg,
  question,
  conversationId,
  onRated,
}: {
  msg: Message;
  question: string;
  conversationId: string | null;
  onRated: (rating: "up" | "down" | null) => void;
}) {
  const [askWhy, setAskWhy] = useState(false);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const tools = Array.isArray(msg.actions)
    ? msg.actions.map((a: { tool?: string }) => a?.tool).filter((t): t is string => typeof t === "string")
    : [];

  const send = async (rating: "up" | "down" | null, note = "") => {
    onRated(rating);
    try {
      await api.post("/api/feedback", {
        rating,
        question: question.slice(0, 2000),
        answer: msg.content.slice(0, 20000),
        comment: note,
        conversationId,
        tools,
      });
    } catch {
      /* rating is best-effort */
    }
  };

  const click = (rating: "up" | "down") => {
    const next = msg.feedback === rating ? null : rating;
    setSent(false);
    setAskWhy(next === "down");
    void send(next);
  };

  return (
    <div className="flex flex-col gap-1.5 items-start">
      <div className="flex items-center gap-1" role="group" aria-label="قيّم الرد">
        {(["up", "down"] as const).map((r) => (
          <IconButton
            key={r}
            label={r === "up" ? "رد مفيد" : "رد غير مفيد"}
            onClick={() => click(r)}
            aria-pressed={msg.feedback === r}
            className={cn(
              "size-9 text-ink-muted [&_svg]:size-4",
              msg.feedback === r && (r === "up" ? "bg-success-soft text-success-ink hover:bg-success-soft" : "bg-danger-soft text-danger-ink hover:bg-danger-soft"),
            )}
          >
            {r === "up" ? <ThumbsUp aria-hidden /> : <ThumbsDown aria-hidden />}
          </IconButton>
        ))}
        {sent && <span className="ms-1 text-caption text-ink-muted" role="status">شكراً، وصلت ملاحظتك.</span>}
      </div>
      {askWhy && !sent && (
        <form
          className="flex items-center gap-2 w-full max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void send("down", comment.trim());
            setSent(true);
            setAskWhy(false);
          }}
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            aria-label="وش كان الخطأ؟ (اختياري)"
            placeholder="وش كان الخطأ؟ (اختياري)"
            className="h-9 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-3 text-small text-ink placeholder:text-ink-muted focus-ring"
          />
          <Button type="submit" variant="primary" size="sm">إرسال</Button>
        </form>
      )}
    </div>
  );
}
