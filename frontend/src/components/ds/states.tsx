import * as React from "react";
import { CloudOff, RotateCw, ServerCrash } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ds/button";

/**
 * The four states every data screen has — loading, empty, error, success —
 * so no page invents its own. (Success is the page content itself, plus an
 * inline confirmation or a toast.)
 */

/** A placeholder with the shape of what is coming. Hidden from screen readers. */
export function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn("ds-skeleton block rounded-control bg-surface-sunken [animation:ds-skeleton_1.6s_ease-in-out_infinite]", className)}
      {...props}
    />
  );
}

/** Wrap a group of skeletons: announces "loading" once instead of per bar. */
export function Loading({ label = "جارٍ التحميل", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

/** Nothing here yet: say why in one sentence and offer the one action that fills it. */
export function EmptyState({
  title,
  text,
  art,
  action,
  className,
}: {
  title: string;
  text?: string;
  /** A small illustration or icon. Decorative. */
  art?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong px-6 py-10 text-center", className)}>
      {art && <div className="text-ink-muted [&_svg:not(.illustration)]:size-10" aria-hidden>{art}</div>}
      <p className="text-subheading font-semibold text-ink">{title}</p>
      {text && <p className="max-w-sm text-small text-ink-muted">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const ERRORS = {
  /** The device has no connection. */
  offline: { Icon: CloudOff, title: "لا يوجد اتصال بالإنترنت", text: "تحقق من الشبكة ثم حاول مرة ثانية." },
  /** The free server sleeps when idle and takes a moment to start. */
  waking: { Icon: ServerCrash, title: "الخادم يستيقظ", text: "أول طلب بعد فترة خمول يأخذ نحو دقيقة. حاول بعد قليل." },
  /** Anything else. */
  failed: { Icon: ServerCrash, title: "تعذّر تحميل البيانات", text: "صار خطأ من جهتنا، وبياناتك المحفوظة ما تأثرت." },
} as const;

/** Something failed: say what, in the student's words, and offer a retry. */
export function ErrorState({
  kind = "failed",
  title,
  text,
  onRetry,
  retrying,
  className,
}: {
  kind?: keyof typeof ERRORS;
  title?: string;
  text?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const preset = ERRORS[kind];
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 rounded-card border border-danger-line bg-danger-soft px-6 py-8 text-center", className)}>
      <preset.Icon className="size-8 text-danger-ink" aria-hidden />
      <p className="text-subheading font-semibold text-danger-ink">{title ?? preset.title}</p>
      <p className="max-w-sm text-small text-ink">{text ?? preset.text}</p>
      {onRetry && (
        <Button onClick={onRetry} loading={retrying} className="mt-2">
          {!retrying && <RotateCw aria-hidden />}
          حاول مرة ثانية
        </Button>
      )}
    </div>
  );
}
