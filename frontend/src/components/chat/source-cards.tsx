"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, ExternalLink, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractCitations, type Citation } from "@/lib/citations";

/** Sources under an answer; tapping one shows the article (or the dates) right here. */
export function SourceCards({ content, actions }: { content: string; actions?: unknown }) {
  const sources = extractCitations(content, Array.isArray(actions) ? actions : undefined);
  const [open, setOpen] = useState<Citation | null>(null);
  if (sources.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2 w-full min-w-0" aria-label="المصادر">
        {sources.map((s) => {
          const Icon = isCalendar(s) ? CalendarDays : FileText;
          return (
            <button
              key={s.document + s.article}
              type="button"
              onClick={() => setOpen(s)}
              title={`${s.article} — ${s.document}`}
              aria-label={`عرض المصدر: ${s.article} — ${s.document}`}
              className="flex items-center gap-1.5 min-w-0 max-w-full sm:max-w-[22rem] px-3 py-1.5 rounded-xl border border-uqu-accent/20 bg-uqu-accent/5 text-[12px] hover:border-uqu-accent/40 transition-colors text-right"
            >
              <Icon className="w-3.5 h-3.5 shrink-0 text-uqu-accent" aria-hidden />
              <span className="font-bold shrink-0 max-w-[45%] truncate">{s.article}</span>
              <span className="text-muted-foreground truncate min-w-0">— {s.document}</span>
            </button>
          );
        })}
      </div>
      <SourceDialog source={open} onClose={() => setOpen(null)} />
    </>
  );
}

function isCalendar(s: Citation): boolean {
  return s.document.startsWith("التقويم الأكاديمي");
}

function SourceDialog({ source, onClose }: { source: Citation | null; onClose: () => void }) {
  return (
    <Dialog open={source !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-lg rounded-[24px] p-0 max-h-[85vh] flex flex-col">
        {source && (
          <>
            <DialogHeader className="px-6 pt-6 pb-4 border-b border-foreground/10 text-right shrink-0">
              <DialogTitle className="text-lg font-black leading-7 pl-8">
                {isCalendar(source) ? "التقويم الأكاديمي" : source.article}
              </DialogTitle>
              <DialogDescription className="text-xs leading-6">
                {source.document}
                {source.issued ? ` · ${source.issued}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 py-4 overflow-y-auto space-y-3">
              {source.heading && <div className="text-xs font-bold text-muted-foreground">{source.heading}</div>}
              {source.text ? (
                <p className="text-sm leading-8 whitespace-pre-line" dir="auto">
                  {source.text}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">النص غير متوفر هنا — افتح المصدر الرسمي.</p>
              )}
              {source.note && (
                <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-500/10 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                  {source.note}
                </p>
              )}
            </div>
            {source.url && (
              <div className="px-6 py-4 border-t border-foreground/10 shrink-0">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-uqu-accent hover:underline"
                >
                  <ExternalLink className="w-4 h-4" aria-hidden />
                  المصدر الرسمي في موقع الجامعة
                </a>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
