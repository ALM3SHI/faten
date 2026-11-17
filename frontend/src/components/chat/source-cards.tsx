"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, ExternalLink, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractCitations, type Citation } from "@/lib/citations";
import { Button } from "@/components/ds/button";

/** Sources under an answer; tapping one shows the article (or the dates) right here. */
export function SourceCards({ content, actions }: { content: string; actions?: unknown }) {
  const sources = extractCitations(content, Array.isArray(actions) ? actions : undefined);
  const [open, setOpen] = useState<Citation | null>(null);
  if (sources.length === 0) return null;

  return (
    <>
      <div className="flex w-full min-w-0 flex-wrap gap-2" role="group" aria-label="المصادر">
        {sources.map((s) => {
          const Icon = isCalendar(s) ? CalendarDays : FileText;
          return (
            <Button
              key={s.document + s.article}
              size="sm"
              onClick={() => setOpen(s)}
              title={`${s.article} — ${s.document}`}
              className="max-w-full min-w-0 justify-start border-info-line bg-info-soft text-small font-normal text-info-ink hover:border-info-ink hover:bg-info-soft sm:max-w-96"
            >
              <Icon className="text-info-ink" aria-hidden />
              {/* The name reads «عرض المصدر: المادة 14 — …»; the first words are visual-only context. */}
              <span className="sr-only">عرض المصدر: </span>
              <span className="max-w-[45%] shrink-0 truncate font-semibold">{s.article}</span>
              <span className="min-w-0 truncate text-ink"> — {s.document}</span>
            </Button>
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
      <DialogContent dir="rtl" className="ds-page flex max-h-[85vh] flex-col rounded-dialog border-line bg-surface-raised p-0 text-ink shadow-dialog sm:max-w-lg">
        {source && (
          <>
            <DialogHeader className="shrink-0 border-b border-line px-6 pt-6 pb-4 text-start">
              <DialogTitle className="ps-0 pe-8 text-heading font-bold">
                {isCalendar(source) ? "التقويم الأكاديمي" : source.article}
              </DialogTitle>
              <DialogDescription className="text-small text-ink-muted">
                {source.document}
                {source.issued ? ` · ${source.issued}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 overflow-y-auto px-6 py-4">
              {source.heading && <div className="text-small font-semibold text-ink-muted">{source.heading}</div>}
              {source.text ? (
                <p className="whitespace-pre-line text-body leading-loose" dir="auto">
                  {source.text}
                </p>
              ) : (
                <p className="text-body text-ink-muted">النص غير متوفر هنا — افتح المصدر الرسمي.</p>
              )}
              {source.note && (
                <p className="flex items-start gap-2 rounded-card border border-warning-line bg-warning-soft p-3 text-small text-warning-ink">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {source.note}
                </p>
              )}
            </div>
            {source.url && (
              <div className="shrink-0 border-t border-line px-6 py-4">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-control text-body font-semibold text-info-ink hover:underline focus-ring"
                >
                  <ExternalLink className="size-4" aria-hidden />
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
