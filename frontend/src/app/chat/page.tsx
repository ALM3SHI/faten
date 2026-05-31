"use client";

import { Navbar } from "@/components/navbar";
import { Sparkles, User as UserIcon, History, Settings, Trash2, ArrowLeft } from "lucide-react";
import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ChatResponse } from "@/lib/ai";
import type { SuggestedNavigation } from "@/store/workspaceStore";
import { BotMarkdown } from "@/components/bot-markdown";
import { SmartLoadingIndicator } from "@/components/smart-loading-indicator";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIService, Message as AIMessage } from "@/lib/ai";
import { motion, AnimatePresence } from "framer-motion";
import { ChatInput } from "@/components/chat-input";
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
  "/plan":       { label: "عرض الخطة الدراسية",       icon: "📅" },
  "/gpa":        { label: "فتح حاسبة المعدل",          icon: "📊" },
  "/dashboard":  { label: "فتح لوحة البيانات",          icon: "🏠" },
  "/locations":  { label: "فتح خريطة القاعات",          icon: "🗺️" },
  "/pomodoro":   { label: "فتح مؤقت البومودورو",        icon: "⏱️" },
  "/profile":    { label: "فتح الملف الشخصي",              icon: "👤" },
  "/transcript": { label: "فتح السجل الأكاديمي",        icon: "🎓" },
  "/schedule":   { label: "فتح الجدول الأسبوعي",        icon: "🗓️" },
};

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
  const push = (rawPath: unknown) => {
    if (typeof rawPath !== "string") return;
    if (!rawPath.startsWith("/") || rawPath.startsWith("//")) return;
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
          className="group inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-uqu-accent/10 hover:bg-uqu-accent/20 border border-uqu-accent/30 hover:border-uqu-accent/60 text-uqu-accent text-xs font-bold transition-all active:scale-95 shadow-sm"
        >
          <span aria-hidden>{a.icon}</span>
          <span>{a.label}</span>
          <ArrowLeft className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 group-hover:-translate-x-0.5 transition-all" />
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
  const [mounted, setMounted] = useState(false);
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
    setMounted(true);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  useEffect(() => {
    if (initialQuery && !hasInitialized) {
      setHasInitialized(true);
      setTimeout(() => {
        handleSend(initialQuery);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, hasInitialized]);

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

      const response = await AIService.chat(history, {
        conversationId,
      });
      if (response.conversationId) setConversationId(response.conversationId);

      const botMessage: Message = {
        role: "bot",
        content: response.message,
        timestamp: new Date(),
        actions: response.actions,
        // Surface any NAVIGATE / navigate_to_page / open_page hints as
        // clickable CTA buttons — never as an auto-redirect.
        suggestedActions: extractSuggestedActions(response),
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
      console.error("Chat error:", error);
      // Surface the real server-side message when we can — the previous
      // generic "خطأ في الاتصال" hid the actual cause (missing API key,
      // 401 token, etc.) and made debugging painful.
      const detail =
        error instanceof Error && error.message
          ? error.message
          : "فشل غير معروف.";
      const isNetwork = /failed to fetch|networkerror|typeerror/i.test(detail);
      const friendly = isNetwork
        ? "تعذّر الوصول إلى السيرفر. تأكد من أن الـbackend شغّال على المنفذ 8000."
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

  return (
    <div className="h-screen flex flex-col bg-background text-foreground font-sans overflow-hidden" dir="rtl">
      <Navbar />

      <main className="flex-1 flex overflow-hidden w-full p-4 pt-20 gap-4">

        {/* CHAT CENTER */}
        <motion.div
          layout
          initial={false}
          className="h-full flex flex-col relative transition-all duration-500 w-full max-w-5xl mx-auto"
        >
          {/* Header — bot-identity block removed (Task 1). Minimal control bar
              keeps History + Settings accessible without burning vertical space. */}
          <div className="flex items-center justify-between pb-2 mb-2 shrink-0 px-1">
            {/* Right: History */}
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center gap-2 text-muted hover:text-foreground hover:bg-foreground/5 rounded-xl px-3 py-2 transition-all text-[13px] font-medium"
            >
              <History className="w-4 h-4" />
              <span>سجل الدردشات</span>
            </button>

            {/* Left: Settings dropdown (Task 2) */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex items-center gap-2 text-muted hover:text-foreground hover:bg-foreground/5 rounded-xl px-3 py-2 transition-all text-[13px] font-medium outline-none"
              >
                <span>الإعدادات</span>
                <Settings className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-[220px] bg-card/95 backdrop-blur-xl border border-foreground/10 text-foreground"
              >
                <DropdownMenuItem
                  onClick={() => setClearHistoryOpen(true)}
                  className="gap-2 text-[13px] text-red-500 focus:bg-red-500/10 focus:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>مسح سجل المحادثة</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Messages Container */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto pb-32 px-6 flex flex-col gap-5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full"
            dir="rtl"
          >
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
                        <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0066cc] to-cyan-500 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(0,102,204,0.3)] mt-0.5">
                          <Sparkles className="w-4 h-4 text-foreground" />
                        </div>
                      )
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#0066cc]/20 border border-[#0066cc]/40 flex items-center justify-center shrink-0 mt-0.5">
                        <UserIcon className="w-4 h-4 text-[#0066cc]" />
                      </div>
                    )}

                    {/* Bubble */}
                    <div className={cn(
                      "max-w-[70%] flex flex-col gap-1",
                      isBot ? "items-start" : "items-end"
                    )}>
                      <div className={cn(
                        "px-4 py-3 text-[15px] leading-relaxed rounded-2xl",
                        !isBot && "bg-[#0066cc] text-foreground rounded-tr-sm shadow-lg shadow-[#0066cc]/15 text-left",
                        isBot && !isError && "bg-card border border-foreground/10 text-foreground rounded-tl-sm text-right",
                        // Warning style — orange tint + dashed border so
                        // it visually reads as "system notice" rather
                        // than a normal answer the user should act on.
                        isBot && isError && "bg-amber-500/10 border border-amber-500/40 text-foreground rounded-tl-sm text-right shadow-[inset_0_0_0_1px_hsla(38,92%,55%,0.10)]"
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
                      {/* Manual navigation CTAs — only rendered if the
                          agent suggested a destination. Click is the
                          ONLY way the page changes. */}
                      {isBot && msg.suggestedActions && msg.suggestedActions.length > 0 && (
                        <NavigationCTA actions={msg.suggestedActions} />
                      )}
                      <span
                        className="text-[10px] text-muted px-1"
                        suppressHydrationWarning
                      >
                        {mounted
                          ? msg.timestamp.toLocaleTimeString("ar-SA", {
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
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0066cc] to-cyan-500 flex items-center justify-center shrink-0 animate-pulse mt-0.5">
                    <Sparkles className="w-4 h-4 text-foreground" />
                  </div>
                  {/* Loading pill — three-dot typing indicator only, no
                      textual status copy. */}
                  <SmartLoadingIndicator />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Floating Input Pill */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-1rem)] z-20">
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

