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
        className="!bg-card border-border text-foreground shadow-2xl backdrop-blur-xl dark:!bg-card/95 dark:border-foreground/10 rounded-[28px] p-0 sm:max-w-[min(640px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
        dir="rtl"
      >
        <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-foreground/10 shrink-0">
          <DialogTitle className="text-xl font-black flex items-center gap-3">
            <ListChecks className="w-6 h-6 text-amber-800 dark:text-amber-300" />
            ترحيل المهام المتأخرة
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            هذه المهام جدولتها من قبل ولم تُعلَّم كمكتملة. اختر كيف نتعامل معها.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
          {overdue.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              لا توجد مهام متأخرة. أحسنت!
            </div>
          ) : (
            <>
              <div className="text-[11px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">
                {overdue.length} مهمة متأخرة
              </div>
              <div className="space-y-1.5">
                {overdue.map((t, i) => (
                  <div
                    key={`${t.suggestedDay}-${t.suggestedTime}-${i}`}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/20"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_hsl(40,90%,60%)]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-bold truncate">
                        {t.title}
                      </div>
                      <div className="text-[10px] text-muted font-mono mt-0.5">
                        {t.suggestedDay} · {t.suggestedTime} · {t.durationMinutes}د
                        {t.courseCode ? ` · ${t.courseCode}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-foreground/10">
            <Button
              onClick={onAckAll}
              disabled={overdue.length === 0}
              className="rounded-xl bg-emerald-500/90 hover:bg-emerald-500 text-foreground gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              اعتبر كل المهام مكتملة
            </Button>
            <Button
              onClick={onGoToPlan}
              variant="outline"
              className="rounded-xl glass border-uqu-accent/40 text-uqu-accent gap-2"
            >
              <ArrowUpRight className="w-4 h-4" />
              ولّد خطة جديدة (مع ترحيل البقايا)
            </Button>
          </div>
          <p className="text-[10px] text-muted leading-relaxed">
            عند توليد خطة جديدة، يحقن النظام تلقائياً قائمة المتأخرات في
            طلب الذكاء الاصطناعي ليُضيفها للأسبوع القادم مع ملاحظة استراتيجية.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
