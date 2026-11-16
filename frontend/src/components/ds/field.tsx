"use client";

import * as React from "react";
import { ChevronDown, CircleAlert, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Form controls for design system v2. `Field` owns the label, the helper text
 * and the error, and wires them to the control it wraps, so no page has to
 * remember aria-describedby or aria-invalid.
 */
const CONTROL =
  "w-full min-w-0 rounded-control border border-line-strong bg-surface text-body text-ink placeholder:text-ink-muted motion-fast transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger-ink";

interface FieldContext {
  id: string;
  describedBy?: string;
  invalid: boolean;
}
const Ctx = React.createContext<FieldContext | null>(null);

function useControlProps(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: React.AriaAttributes["aria-invalid"] }) {
  const field = React.useContext(Ctx);
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid || undefined),
  };
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  /** Helper text shown under the control. */
  hint?: string;
  /** Error text; replaces the hint and marks the control invalid. */
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const messageId = `${id}-msg`;
  const message = error || hint;
  return (
    <Ctx.Provider value={{ id, describedBy: message ? messageId : undefined, invalid: !!error }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-small font-semibold text-ink">
          {label}
          {required && <span className="text-danger-ink" aria-hidden> *</span>}
        </label>
        {children}
        {message && (
          <p id={messageId} className={cn("flex items-start gap-1.5 text-small", error ? "text-danger-ink" : "text-ink-muted")}>
            {error && <CircleAlert className="mt-1 size-3.5 shrink-0" aria-hidden />}
            {message}
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input {...props} {...useControlProps(props)} className={cn(CONTROL, "h-11 px-3", className)} />;
}

export function Textarea({ className, rows = 4, ...props }: React.ComponentProps<"textarea">) {
  return <textarea rows={rows} {...props} {...useControlProps(props)} className={cn(CONTROL, "px-3 py-2.5", className)} />;
}

/** A native select: the platform picker is the most usable one on phones. */
export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className="relative block">
      <select {...props} {...useControlProps(props)} className={cn(CONTROL, "h-11 appearance-none ps-3 pe-9", className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
    </span>
  );
}

/**
 * File picker that also accepts a drop. It is a real <input type="file">
 * behind a label, so keyboard and screen-reader users get the native control.
 */
export function FileDrop({
  title,
  hint,
  accept,
  disabled,
  onFile,
  className,
}: {
  title: string;
  hint?: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  className?: string;
}) {
  const [over, setOver] = React.useState(false);
  const inputId = React.useId();
  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !disabled) onFile(file);
      }}
      data-over={over || undefined}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line-strong bg-surface px-6 py-8 text-center motion-fast transition-colors",
        "hover:border-brand data-over:border-brand data-over:bg-info-soft has-focus-visible:border-brand has-focus-visible:ring-2 has-focus-visible:ring-brand",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <UploadCloud className="size-7 text-brand" aria-hidden />
      <span className="text-subheading font-semibold text-ink">{title}</span>
      {hint && <span className="text-small text-ink-muted">{hint}</span>}
      <input
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}
