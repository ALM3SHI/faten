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
        relative inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full
        bg-card border border-foreground/10
        shadow-[0_0_24px_-8px_hsla(245,78%,62%,0.35)]
        overflow-hidden
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
          bg-[linear-gradient(110deg,transparent_30%,hsla(245,78%,62%,0.18)_50%,transparent_70%)]
        "
        style={{
          backgroundSize: "200% 100%",
          animation: "chat-shimmer 2.2s linear infinite",
        }}
      />

      {/* Three bouncing dots — the only visible loading signal. */}
      <span className="relative inline-flex items-center gap-1 shrink-0">
        <span className="w-1.5 h-1.5 bg-uqu-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 bg-uqu-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 bg-uqu-accent rounded-full animate-bounce" />
      </span>
    </div>
  );
}
