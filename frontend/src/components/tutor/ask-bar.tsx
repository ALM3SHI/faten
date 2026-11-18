"use client";

import { useEffect, useState, type RefObject } from "react";
import { Quote, Send, TextQuote, X } from "lucide-react";
import { Button } from "@/components/ds/button";

const MAX_QUOTES = 4;
const MAX_QUOTE_CHARS = 600;

/** "first words…" for a chip. */
function short(s: string, n = 48): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

/**
 * Ask the tutor about the lesson. Select a sentence in the lesson and add it
 * to the question (up to four passages, sent together); the answer comes
 * from the lecture with its pages. While a question is waiting for the
 * student's answer, the tutor guides instead of giving the answer away.
 */
export function AskBar({
  scope,
  disabled,
  busy,
  onAsk,
}: {
  /** the lesson column: only text selected inside it can be added */
  scope: RefObject<HTMLElement | null>;
  disabled?: boolean;
  busy?: boolean;
  onAsk: (text: string, quotes: string[]) => void;
}) {
  const [question, setQuestion] = useState("");
  const [quotes, setQuotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection();
      const box = scope.current;
      if (!sel || sel.isCollapsed || !box || !sel.anchorNode || !box.contains(sel.anchorNode)) return setSelected(null);
      const text = sel.toString().replace(/\s+/g, " ").trim();
      setSelected(text.length >= 3 ? text.slice(0, MAX_QUOTE_CHARS) : null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [scope]);

  const addSelected = () => {
    if (!selected) return;
    setQuotes((q) => (q.includes(selected) || q.length >= MAX_QUOTES ? q : [...q, selected]));
    window.getSelection()?.removeAllRanges();
    setSelected(null);
  };

  const full = quotes.length >= MAX_QUOTES;
  const canSend = !busy && !disabled && (question.trim().length > 0 || quotes.length > 0);

  return (
    <div className="space-y-2">
      {selected && !disabled && (
        <Button
          variant="secondary"
          size="sm"
          // keep the selection: a press would clear it before the click lands
          onMouseDown={(e) => e.preventDefault()}
          onClick={addSelected}
          disabled={full}
          className="max-w-full"
        >
          <TextQuote aria-hidden />
          <span className="truncate">{full ? "أضفت 4 مقاطع — احذف واحداً لتضيف غيره" : `أضف «${short(selected, 36)}» لسؤالك`}</span>
        </Button>
      )}
      {quotes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="المقاطع التي تسأل عنها">
          {quotes.map((q) => (
            <li key={q} className="inline-flex max-w-full items-center gap-1 rounded-full border border-info-line bg-info-soft py-0.5 ps-2.5 pe-1 text-small text-info-ink">
              <Quote className="size-3 shrink-0" aria-hidden />
              <span className="truncate" dir="auto" title={q}>
                {short(q)}
              </span>
              <Button
                variant="bare"
                type="button"
                onClick={() => setQuotes((all) => all.filter((x) => x !== q))}
                aria-label={`احذف «${short(q, 24)}» من السؤال`}
                className="size-6 shrink-0 rounded-full hover:bg-surface"
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend) return;
          const text = question.trim() || "اشرح لي هذا بطريقة أبسط";
          onAsk(text, quotes);
          setQuestion("");
          setQuotes([]);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={1500}
          disabled={disabled}
          placeholder={
            disabled
              ? "الأسئلة معطّلة أثناء الاختبار الشامل"
              : quotes.length
                ? "وش تبي تعرف عن هذا؟ (أو أرسل مباشرة)"
                : "اسأل عن الدرس — أو حدّد جملة منه لتسأل عنها"
          }
          aria-label="اسأل المعلم"
          className="flex-1 h-11 px-4 rounded-control border border-line-strong bg-surface text-body focus:outline-none focus:border-info-line disabled:opacity-60"
        />
        <Button
          variant="bare"
          type="submit"
          disabled={!canSend}
          className="h-11 w-11 rounded-control bg-brand text-on-brand flex items-center justify-center disabled:opacity-50"
          aria-label="إرسال السؤال"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
