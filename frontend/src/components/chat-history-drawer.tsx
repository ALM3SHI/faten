"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, Search, Plus, Trash2 } from "lucide-react";
import { useChatHistoryStore, type ChatThread } from "@/store/chatHistoryStore";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/lib/toast";

interface ChatHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when the user picks a saved thread. */
  onSelectThread: (id: string) => void;
  /** Called when the user clicks "محادثة جديدة". */
  onNewThread: () => void;
  /** Called when the user confirms deleting a thread from the drawer. */
  onDeleteThread: (id: string) => void;
}

function formatRelative(iso: string): string {
  const t = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - t.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `قبل ${diffMin} دقيقة`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24 && now.getDate() === t.getDate()) {
    return `اليوم، ${t.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    t.getDate() === yesterday.getDate() &&
    t.getMonth() === yesterday.getMonth() &&
    t.getFullYear() === yesterday.getFullYear()
  ) {
    return `أمس، ${t.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return t.toLocaleDateString("ar-SA", { day: "2-digit", month: "short" });
}

export function ChatHistoryDrawer({
  isOpen,
  onClose,
  onSelectThread,
  onNewThread,
  onDeleteThread,
}: ChatHistoryDrawerProps) {
  const threads = useChatHistoryStore((s) => s.threads);
  const activeId = useChatHistoryStore((s) => s.activeId);
  const [query, setQuery] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Close on Escape — small ergonomics win, matches macOS sheet conventions.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const filtered = useMemo<ChatThread[]>(() => {
    if (!query.trim()) return threads;
    const q = query.trim().toLowerCase();
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.preview.toLowerCase().includes(q),
    );
  }, [threads, query]);

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="history-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />

          <motion.aside
            key="history-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
            className="fixed top-0 right-0 h-screen w-full max-w-md z-50 bg-card/95 backdrop-blur-2xl border-l border-foreground/10 shadow-2xl flex flex-col"
            dir="rtl"
            role="dialog"
            aria-label="سجل الدردشات"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-foreground/10 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#0066cc]/15 border border-[#0066cc]/20 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-4 h-4 text-[#0066cc]" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-foreground font-bold text-[15px] tracking-tight truncate">
                    سجل الدردشات
                  </h2>
                  <p className="text-muted text-[11px] font-medium mt-0.5">
                    {threads.length === 0
                      ? "لا توجد محادثات محفوظة بعد"
                      : `${threads.length} محادثة محفوظة`}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="إغلاق"
                className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-foreground hover:bg-foreground/5 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search + new */}
            <div className="px-5 pt-4 pb-2 shrink-0 flex flex-col gap-2.5">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث في المحادثات..."
                  className="w-full bg-foreground/5 border border-foreground/10 rounded-xl pr-10 pl-4 py-2.5 text-sm text-foreground placeholder:text-muted outline-none focus:border-[#0066cc]/40 focus:ring-1 focus:ring-[#0066cc]/20 transition-all"
                />
              </div>
              <button
                onClick={onNewThread}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#0066cc]/10 border border-[#0066cc]/25 text-[#0066cc] hover:bg-[#0066cc]/15 transition-colors text-[13px] font-bold"
              >
                <Plus className="w-4 h-4" />
                <span>محادثة جديدة</span>
              </button>
            </div>

            {/* Sessions */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
              {filtered.length === 0 ? (
                <div className="text-center text-muted text-xs py-12 px-4 leading-relaxed">
                  {threads.length === 0
                    ? "ابدأ محادثة جديدة وستظهر هنا تلقائياً."
                    : "لا توجد محادثات تطابق بحثك."}
                </div>
              ) : (
                filtered.map((s, index) => {
                  const isActive = s.id === activeId;
                  const rowKey = s.id ? `${s.id}-${index}` : `thread-${index}`;
                  return (
                    <div
                      key={rowKey}
                      className={
                        "group relative flex items-stretch gap-1 rounded-2xl transition-all " +
                        (isActive
                          ? "border border-[#0066cc]/35 bg-[#0066cc]/[0.06]"
                          : "border border-foreground/10 bg-foreground/5 hover:bg-foreground/5 hover:border-foreground/10")
                      }
                    >
                      <button
                        onClick={() => onSelectThread(s.id)}
                        className="flex-1 flex flex-col gap-1 p-3 text-right active:scale-[0.99] transition-transform min-w-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground text-[13px] font-bold tracking-tight truncate">
                            {s.title}
                          </span>
                          <span className="text-muted text-[10px] font-mono whitespace-nowrap shrink-0">
                            {formatRelative(s.updatedAt)}
                          </span>
                        </div>
                        <span className="text-muted text-[11px] truncate text-right">
                          {s.preview}
                        </span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(s.id);
                        }}
                        aria-label="حذف المحادثة"
                        title="حذف"
                        className="w-9 self-stretch flex items-center justify-center text-muted hover:text-rose-400 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>

    <ConfirmDialog
      open={pendingDeleteId !== null}
      onOpenChange={(open) => {
        if (!open) setPendingDeleteId(null);
      }}
      title="حذف المحادثة"
      description="هل تود حذف هذه المحادثة؟ لا يمكن التراجع بعد الحذف."
      confirmLabel="حذف"
      destructive
      onConfirm={() => {
        if (pendingDeleteId) {
          onDeleteThread(pendingDeleteId);
          toast.success("تم حذف المحادثة");
        }
      }}
    />
    </>
  );
}
