"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ds/button";
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
    "text-success-ink bg-success-soft border-success-line",
  error:
    "text-danger-ink bg-danger-soft border-danger-line",
  warning:
    "text-warning-ink bg-warning-soft border-warning-line",
  info:
    "text-info-ink bg-info-soft border-info-line",
};

const VARIANT_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

/** Animated toast stack (framer-motion), loaded on the first toast. */
export function ToastList() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  return (
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
              "pointer-events-auto flex items-center gap-2 rounded-control border px-4 py-3 text-small font-bold",
              VARIANT_STYLES[t.variant],
            )}
            role="status"
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 text-right">{t.message}</span>
            <Button variant="bare"
              type="button"
              onClick={() => remove(t.id)}
              className="shrink-0 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100 text-current"
              aria-label="إغلاق"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}
