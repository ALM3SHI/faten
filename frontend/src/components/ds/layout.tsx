"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ds/button";

/**
 * Page structure for design system v2: the page header (the one <h1>),
 * section headers, and the bottom sheet used on phones.
 */

/** The top of every page: one title, one line of context, one primary action. */
export function PageHeader({
  title,
  text,
  action,
  className,
}: {
  title: string;
  text?: string;
  /** The page's single primary action. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-title font-bold text-ink text-balance">{title}</h1>
        {text && <p className="mt-1 max-w-2xl text-body text-ink-muted">{text}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  text,
  action,
  className,
}: {
  title: string;
  text?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-heading font-bold text-ink">{title}</h2>
        {text && <p className="mt-0.5 text-small text-ink-muted">{text}</p>}
      </div>
      {action && <div className="shrink-0 text-small">{action}</div>}
    </div>
  );
}

/**
 * A panel that rises from the bottom edge — the phone-friendly way to show
 * details over a page (a room on the map, a filter). Built on the same
 * dialog primitive as the app's dialogs: focus is trapped, Escape closes it.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60" />
        <DialogPrimitive.Popup
          className={cn(
            "ds-sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-dialog border border-b-0 border-line bg-surface-raised text-ink shadow-dialog outline-none",
            "pb-[env(safe-area-inset-bottom)] [animation:ds-sheet-up_var(--ds-slow)_var(--ds-ease)]",
            className,
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line py-2 ps-5 pe-2">
            <DialogPrimitive.Title className="text-subheading font-bold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close render={<IconButton label="إغلاق" />}>
              <X aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
