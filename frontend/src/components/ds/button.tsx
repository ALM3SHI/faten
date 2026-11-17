import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Design system v2 button. One primary action per screen; everything else is
 * secondary or quiet. The default size is a 44px touch target.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "bare";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control border font-semibold whitespace-nowrap select-none motion-fast transition-colors focus-ring disabled:pointer-events-none disabled:opacity-50 aria-busy:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-brand text-on-brand hover:bg-brand-hover",
  secondary: "border-line-strong bg-surface text-ink hover:bg-surface-sunken",
  quiet: "border-transparent bg-transparent text-ink hover:bg-surface-sunken",
  danger: "border-danger-line bg-danger-soft text-danger-ink hover:border-danger-ink",
  bare: "",
};

/**
 * `bare`: no look of its own — only the shared focus ring and disabled
 * behaviour. For controls whose shape is the content itself (a day in the
 * week strip, an inline text action, a checkbox circle), styled by the caller.
 */
const BARE = "focus-ring disabled:pointer-events-none disabled:opacity-50 aria-busy:pointer-events-none";

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-small",
  md: "h-11 px-4 text-body",
  lg: "h-12 px-6 text-subheading",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  if (variant === "bare") return cn(BARE, className);
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, announces "busy" and blocks further clicks. */
  loading?: boolean;
}

export function Button({ variant, size, loading = false, className, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...props}
    >
      {loading && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
}

/** An icon with no visible text. `label` is required: it is the button's name. */
export function IconButton({
  label,
  variant = "quiet",
  className,
  children,
  type = "button",
  ...props
}: Omit<React.ComponentProps<"button">, "aria-label"> & { label: string; variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(BASE, VARIANT[variant], "size-11 [&_svg]:size-5", className)}
      {...props}
    >
      {children}
    </button>
  );
}
