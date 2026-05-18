"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * SmartLoadingIndicator
 * ────────────────────────────────────────────────────────────────
 * Shown while the agent is generating. We don't have a real status
 * stream (the backend isn't SSE), so we rotate through plausible
 * "what the agent is probably doing" messages — calibrated to the
 * timing budget of a tool-using LLM call (≈ 2–10s typical, up to
 * ~30s for plan generation).
 *
 * The order isn't random: it walks through the actual stages the
 * agent runs through (read context → reason → maybe call tools →
 * format reply), so the message you see at second 4 is a better
 * lie than the message at second 1.
 */

const STAGES: ReadonlyArray<{ icon: string; text: string }> = [
  { icon: "🧠", text: "جاري قراءة سياقك الأكاديمي..." },
  { icon: "📊", text: "أحلّل سجلك والمواد الحالية..." },
  { icon: "🎯", text: "أبحث عن أنماط الأداء وفرص التحسين..." },
  { icon: "⚙️",  text: "أبني الاستراتيجية المناسبة..." },
  { icon: "📅", text: "أرتّب الجلسات والأوقات حسب طاقتك..." },
  { icon: "✍️",  text: "أصيغ التوصية النهائية..." },
];

// Switch stage every 2.6s — fast enough to feel alive, slow enough
// that the user reads each message before it disappears.
const STAGE_MS = 2600;

export function SmartLoadingIndicator() {
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      // Clamp at the last stage — better than wrapping back to
      // "reading context" 20 seconds in, which would read as a stall.
      setStageIdx((i) => Math.min(i + 1, STAGES.length - 1));
    }, STAGE_MS);
    return () => clearInterval(t);
  }, []);

  const stage = STAGES[stageIdx];

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
    >
      {/* Animated gradient sweep — purely decorative. Sits behind the
          text and runs left-to-right (visually right-to-left in RTL).
          Keyframes `chat-shimmer` are declared in app/globals.css so
          this component doesn't depend on styled-jsx being wired up
          under Turbopack. */}
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

      {/* Three bouncing dots — the "still alive" signal. */}
      <span className="relative inline-flex items-center gap-1 shrink-0">
        <span className="w-1.5 h-1.5 bg-uqu-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 bg-uqu-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 bg-uqu-accent rounded-full animate-bounce" />
      </span>

      {/* Rotating stage label — fade-and-slide between stages. */}
      <span className="relative text-[12.5px] font-bold text-foreground inline-flex items-center gap-1.5 min-w-0">
        <AnimatePresence mode="wait">
          <motion.span
            key={stageIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <span aria-hidden>{stage.icon}</span>
            <span>{stage.text}</span>
          </motion.span>
        </AnimatePresence>
      </span>

    </div>
  );
}
