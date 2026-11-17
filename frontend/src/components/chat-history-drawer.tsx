"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, Search, Plus, Trash2 } from "lucide-react";
import { useChatHistoryStore, type ChatThread } from "@/store/chatHistoryStore";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/lib/toast";
import { Button, IconButton } from "@/components/ds/button";
import { cn } from "@/lib/utils";
import { formatTime, formatDayShort } from "@/lib/format-date";

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
    return `اليوم، ${formatTime(t)}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    t.getDate() === yesterday.getDate() &&
    t.getMonth() === yesterday.getMonth() &&
    t.getFullYear() === yesterday.getFullYear()
  ) {
    return `أمس، ${formatTime(t)}`;
  }
  return formatDayShort(t);
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
            className="fixed inset-0 z-40 bg-black/40 dark:bg-black/60"
          />

          <motion.aside
            key="history-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
            className="ds-page fixed top-0 right-0 z-50 flex h-dvh w-full max-w-md flex-col border-s border-line bg-surface-raised text-ink shadow-dialog"
            dir="rtl"
            role="dialog"
            aria-label="سجل الدردشات"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-line py-3 ps-5 pe-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-info-line bg-info-soft text-info-ink" aria-hidden>
                  <MessageSquare className="size-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-subheading font-bold">سجل الدردشات</h2>
                  <p className="text-caption font-medium text-ink-muted">
                    {threads.length === 0
                      ? "لا توجد محادثات محفوظة بعد"
                      : `${threads.length} محادثة محفوظة`}
                  </p>
                </div>
              </div>
              <IconButton label="إغلاق" onClick={onClose} className="shrink-0 rounded-full text-ink-muted hover:text-ink">
                <X aria-hidden />
              </IconButton>
            </div>

            {/* Search + new */}
            <div className="flex shrink-0 flex-col gap-2.5 px-5 pt-4 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute end-auto start-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="ابحث في المحادثات"
                  placeholder="ابحث في المحادثات..."
                  className="h-11 w-full rounded-control border border-line-strong bg-surface ps-10 pe-3 text-body text-ink placeholder:text-ink-muted focus-ring"
                />
              </div>
              <Button variant="primary" onClick={onNewThread} className="w-full">
                <Plus aria-hidden />
                محادثة جديدة
              </Button>
            </div>

            {/* Sessions */}
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-3">
              {filtered.length === 0 ? (
                <div className="px-4 py-12 text-center text-small text-ink-muted">
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
                      className={cn(
                        "group relative flex items-stretch gap-1 rounded-card border motion-fast transition-colors",
                        isActive ? "border-info-line bg-info-soft" : "border-line bg-surface hover:bg-surface-sunken",
                      )}
                    >
                      <Button
                        variant="quiet"
                        onClick={() => onSelectThread(s.id)}
                        aria-current={isActive || undefined}
                        className="h-auto min-w-0 flex-1 flex-col items-stretch gap-1 whitespace-normal p-3 text-start font-normal hover:bg-transparent"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-small font-semibold text-ink">{s.title}</span>
                          <span className="nums shrink-0 whitespace-nowrap text-caption text-ink-muted">{formatRelative(s.updatedAt)}</span>
                        </span>
                        <span className="truncate text-caption text-ink-muted">{s.preview}</span>
                      </Button>
                      {/* Always visible on touch screens; on hover or focus with a mouse. */}
                      <IconButton
                        label="حذف المحادثة"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(s.id);
                        }}
                        className="h-auto self-stretch text-ink-muted hover:bg-transparent hover:text-danger-ink focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                      >
                        <Trash2 aria-hidden />
                      </IconButton>
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
