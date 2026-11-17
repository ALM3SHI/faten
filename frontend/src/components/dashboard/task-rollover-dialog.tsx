"use client";

import { ListChecks, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type PlanTask } from "@/store/planStore";

// ── Smart Task Rollover ───────────────────────────────────────────
//
// TaskRolloverDialog — focused modal listing overdue tasks with two paths:
// accept-all (bulk-mark done) or jump to /plan to regenerate (the planStore
// auto-injects backlog into the prompt).

/** Page-scoped task rollover modal. */
export function TaskRolloverDialog({
  open,
  onOpenChange,
  overdue,
  onAckAll,
  onGoToPlan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overdue: PlanTask[];
  onAckAll: () => void;
  onGoToPlan: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!bg-surface border-line text-ink shadow-card backdrop-blur-xl rounded-card p-0 sm:max-w-[min(640px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
        dir="rtl"
      >
        <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-line shrink-0">
          <DialogTitle className="text-heading font-bold flex items-center gap-3">
            <ListChecks className="w-6 h-6 text-warning-ink" />
            ترحيل المهام المتأخرة
          </DialogTitle>
          <DialogDescription className="text-ink-muted text-small">
            هذه المهام جدولتها من قبل ولم تُعلَّم كمكتملة. اختر كيف نتعامل معها.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-surface-sunken [&::-webkit-scrollbar-thumb]:rounded-full">
          {overdue.length === 0 ? (
            <div className="text-center py-10 text-small text-ink-muted">
              لا توجد مهام متأخرة. أحسنت!
            </div>
          ) : (
            <>
              <div className="text-caption font-bold uppercase tracking-widest text-warning-ink">
                {overdue.length} مهمة متأخرة
              </div>
              <div className="space-y-1.5">
                {overdue.map((t, i) => (
                  <div
                    key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                    className="flex items-center gap-3 p-2.5 rounded-control bg-warning-soft border border-warning-line"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-warning-ink" />
                    <div className="flex-1 min-w-0">
                      <div className="text-small font-bold truncate">
                        {t.title}
                      </div>
                      <div className="text-caption text-ink-muted font-mono mt-0.5">
                        {t.suggestedDay} · {t.suggestedTime} · {t.durationMinutes}د
                        {t.courseCode ? ` · ${t.courseCode}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-line">
            <Button
              onClick={onAckAll}
              disabled={overdue.length === 0}
              className="gap-2 rounded-control bg-brand text-on-brand hover:bg-brand-hover"
            >
              <CheckCircle2 className="w-4 h-4" />
              اعتبر كل المهام مكتملة
            </Button>
            <Button
              onClick={onGoToPlan}
              variant="outline"
              className="rounded-control border border-line bg-surface shadow-card border-info-line text-info-ink gap-2"
            >
              <ArrowUpRight className="w-4 h-4" />
              ولّد خطة جديدة (مع ترحيل البقايا)
            </Button>
          </div>
          <p className="text-caption text-ink-muted leading-relaxed">
            عند توليد خطة جديدة، يحقن النظام تلقائياً قائمة المتأخرات في
            طلب الذكاء الاصطناعي ليُضيفها للأسبوع القادم مع ملاحظة استراتيجية.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
