import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Display building blocks for design system v2: one framed surface (never a
 * card inside a card — divide inside it with lines or space), stats, status
 * pills and list rows.
 */
export function Card({
  as: Tag = "div",
  padded = true,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li"; padded?: boolean }) {
  return (
    <Tag
      className={cn("rounded-card border border-line bg-surface text-ink shadow-card", padded && "p-4 sm:p-5", className)}
      {...props}
    />
  );
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "border-line bg-surface-sunken text-ink-muted",
  success: "border-success-line bg-success-soft text-success-ink",
  warning: "border-warning-line bg-warning-soft text-warning-ink",
  danger: "border-danger-line bg-danger-soft text-danger-ink",
  info: "border-info-line bg-info-soft text-info-ink",
};

/** A short status label. The tone must mean something (آمن / انتبه / خطر). */
export function Pill({ tone = "neutral", className, ...props }: React.ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 text-caption font-semibold whitespace-nowrap [&_svg]:size-3", TONE[tone], className)}
      {...props}
    />
  );
}

/** A tinted block for a message that belongs to the page (not a toast). */
export function Notice({ tone = "info", title, children, className }: { tone?: Exclude<Tone, "neutral">; title?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-card border p-4 text-small", TONE[tone], className)}>
      {title && <p className="text-body font-semibold">{title}</p>}
      {children}
    </div>
  );
}

/** One number the student reads before anything else: value first, label under it. */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  tone?: Exclude<Tone, "neutral">;
  className?: string;
}) {
  const ink = tone ? { success: "text-success-ink", warning: "text-warning-ink", danger: "text-danger-ink", info: "text-info-ink" }[tone] : "text-ink";
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      {/* dt comes first for assistive tech; visually the number leads. */}
      <dt className="order-2 text-small font-medium text-ink-muted">
        {label}
        {hint && <span className="block text-caption font-normal">{hint}</span>}
      </dt>
      <dd className={cn("nums order-1 text-display font-extrabold tracking-tight", ink)} dir="ltr">
        {value}
        {unit && <span className="ms-1 text-subheading font-semibold text-ink-muted">{unit}</span>}
      </dd>
    </div>
  );
}

/** Groups Stat items in a description list, divided by lines. */
export function StatGroup({ className, ...props }: React.ComponentProps<"dl">) {
  return <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3", className)} {...props} />;
}

/**
 * A row in a list: title, optional detail, optional trailing content. With
 * `href` the whole row is one link.
 */
export function ListRow({
  title,
  detail,
  leading,
  trailing,
  href,
  className,
}: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      {leading && <span className="shrink-0 text-ink-muted">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-ink">{title}</span>
        {detail && <span className="block truncate text-small text-ink-muted">{detail}</span>}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
      {href && <ChevronLeft className="size-4 shrink-0 text-ink-muted" aria-hidden />}
    </>
  );
  const row = "flex min-h-14 items-center gap-3 px-4 py-2.5";
  return (
    <li className={cn("border-b border-line last:border-b-0", className)}>
      {href ? (
        <Link href={href} className={cn(row, "motion-fast transition-colors hover:bg-surface-sunken focus-ring rounded-control")}>
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}

/** A framed list of ListRow items. */
export function List({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("overflow-hidden rounded-card border border-line bg-surface shadow-card", className)} {...props} />;
}
