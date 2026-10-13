"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
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
    <div className={cn("space-y-2", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex items-center gap-2 rounded-2xl border border-uqu-accent/25 bg-uqu-accent/[0.06] ps-4 pe-1.5 py-1.5 focus-within:border-uqu-accent/50 transition-colors"
      >
        <Sparkles className="w-4 h-4 text-uqu-accent shrink-0" aria-hidden />
        <label htmlFor="ask-faten" className="sr-only">
          اسأل فطن
        </label>
        <input
          id="ask-faten"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="اسأل فطن عن لوائحك، معدلك، أو جدولك…"
          className="flex-1 min-w-0 bg-transparent text-sm py-2 outline-none placeholder:text-muted-foreground"
          autoComplete="off"
          enterKeyHint="send"
        />
        <button
          type="submit"
          disabled={!q.trim()}
          className="inline-flex items-center gap-1 h-9 px-4 rounded-xl bg-uqu-accent text-white text-sm font-bold disabled:opacity-50 transition-opacity"
        >
          اسأل
          <ArrowLeft className="w-4 h-4" aria-hidden />
        </button>
      </form>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            className="shrink-0 text-xs font-bold rounded-full border border-foreground/10 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-uqu-accent/30 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
