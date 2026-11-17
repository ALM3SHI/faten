"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ds/button";
import { cn } from "@/lib/utils";

const SUGGESTIONS = ["متى اختباري الجاي؟", "كم أغيب قبل الحرمان؟", "كيف أرفع معدلي؟"];

/** Ask Faten straight from the dashboard; the chat opens and sends the question. */
export function AskFaten({ className }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const ask = (text: string) => {
    const question = text.trim();
    if (question) router.push(`/chat?query=${encodeURIComponent(question)}`);
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex items-center gap-2 rounded-card border border-line-strong bg-surface py-1.5 ps-4 pe-1.5 shadow-card motion-fast transition-colors focus-within:border-brand"
      >
        <Sparkles className="size-4 shrink-0 text-info-ink" aria-hidden />
        <label htmlFor="ask-faten" className="sr-only">
          اسأل فطن
        </label>
        <input
          id="ask-faten"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="اسأل فطن عن لوائحك، معدلك، أو جدولك…"
          className="min-w-0 flex-1 bg-transparent py-2 text-body text-ink outline-none placeholder:text-ink-muted"
          autoComplete="off"
          enterKeyHint="send"
        />
        <Button type="submit" variant="primary" size="sm" disabled={!q.trim()}>
          اسأل
          <ArrowLeft aria-hidden />
        </Button>
      </form>
      {/* Wraps instead of scrolling sideways, so no suggestion is ever cut off. */}
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <Button key={s} size="sm" onClick={() => ask(s)} className="rounded-full font-medium text-ink-muted hover:text-ink">
            {s}
          </Button>
        ))}
      </div>
    </div>
  );
}
