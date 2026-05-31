"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";
import { useToastStore, type ToastVariant } from "@/lib/toast";
import { cn } from "@/lib/utils";

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success:
    "text-emerald-800 bg-emerald-500/10 border-emerald-500/30 dark:text-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-400/20",
  error:
    "text-rose-800 bg-rose-500/10 border-rose-500/30 dark:text-rose-300 dark:bg-rose-500/10 dark:border-rose-400/20",
  warning:
    "text-amber-800 bg-amber-500/10 border-amber-500/30 dark:text-amber-300 dark:bg-amber-500/10 dark:border-amber-400/20",
  info:
    "text-cyan-800 bg-cyan-500/10 border-cyan-500/30 dark:text-foreground dark:bg-uqu-accent/10 dark:border-uqu-accent/30",
};

const VARIANT_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  return (
    <>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex w-full max-w-md -translate-x-1/2 flex-col items-stretch gap-2 px-4"
        aria-live="polite"
        aria-atomic="false"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = VARIANT_ICONS[t.variant];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18 }}
                className={cn(
                  "pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-bold shadow-lg",
                  VARIANT_STYLES[t.variant],
                )}
                role="status"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1 text-right">{t.message}</span>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="shrink-0 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100 text-current"
                  aria-label="إغلاق"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </>
  );
}
