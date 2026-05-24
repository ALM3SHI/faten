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
    "bg-emerald-500/10 border-emerald-500/30 text-emerald-100 dark:text-emerald-100",
  error: "bg-rose-500/10 border-rose-500/30 text-rose-200",
  warning: "bg-amber-500/10 border-amber-500/30 text-amber-100",
  info: "bg-uqu-accent/10 border-uqu-accent/30 text-foreground",
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
                  "pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-bold shadow-lg backdrop-blur-sm",
                  VARIANT_STYLES[t.variant],
                )}
                role="status"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1 text-right">{t.message}</span>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="shrink-0 rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100"
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
