"use client";

/**
 * SmartLoadingIndicator
 * ────────────────────────────────────────────────────────────────
 * Shown while the agent is generating. Per product decision, no
 * textual status copy is displayed — only the animated three-dot
 * "still alive" signal inside the existing pill + shimmer styling.
 */

export function SmartLoadingIndicator() {
  return (
    <div
      className="
        relative inline-flex items-center gap-2.5 overflow-hidden rounded-full
        border border-line bg-surface px-4 py-2.5 shadow-card
      "
      role="status"
      aria-live="polite"
      aria-label="جارٍ الكتابة"
    >
      {/* Animated gradient sweep — purely decorative. Keyframes
          `chat-shimmer` are declared in app/globals.css. */}
      <span
        aria-hidden
        className="
          absolute inset-y-0 -inset-x-1 pointer-events-none
          bg-gradient-to-l from-transparent via-info-soft to-transparent motion-reduce:hidden
        "
        style={{
          backgroundSize: "200% 100%",
          animation: "chat-shimmer 2.2s linear infinite",
        }}
      />

      {/* Three bouncing dots — the only visible loading signal. */}
      <span className="relative inline-flex items-center gap-1 shrink-0">
        <span className="size-1.5 rounded-full bg-brand motion-safe:animate-bounce motion-safe:[animation-delay:-0.3s]" />
        <span className="size-1.5 rounded-full bg-brand motion-safe:animate-bounce motion-safe:[animation-delay:-0.15s]" />
        <span className="size-1.5 rounded-full bg-brand motion-safe:animate-bounce" />
      </span>
    </div>
  );
}
