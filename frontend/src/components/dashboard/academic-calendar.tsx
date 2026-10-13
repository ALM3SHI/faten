"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CalendarClock, CalendarPlus } from "lucide-react";
import { buildAcademicCalendarIcs, downloadIcs } from "@/lib/ics";
import { PanelRoot } from "@/components/dashboard/panel-root";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ACADEMIC_YEAR_LABEL,
  UQU_CALENDAR,
  eventStart,
  formatEventDateAr,
  getUpcomingEvents,
  isOngoing,
  type CalendarEvent,
} from "@/lib/uqu-calendar-data";

// دالة مساعدة لتلوين نوع الحدث
function getEventTone(type: string) {
  switch (type) {
    case "holiday": return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
    case "exam": return "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30";
    case "system": return "bg-uqu-accent/15 text-uqu-accent border-uqu-accent/30";
    default: return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  }
}


// ──────────────────────────────────────────────────────────────────
// مكونات كارد التقويم الأكاديمي
// ──────────────────────────────────────────────────────────────────

function eventTypeLabel(type: CalendarEvent["type"]): string {
  return type === "holiday" ? "إجازة" : type === "exam" ? "اختبارات" : type === "system" ? "إجراء" : "أكاديمي";
}


/** "اليوم" / "غدًا" / "بعد 5 أيام" relative to today. */
function daysUntilLabel(ev: CalendarEvent, today: Date): string {
  const ms = eventStart(ev).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round(ms / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "غدًا";
  if (days === 2) return "بعد يومين";
  if (days <= 10) return `بعد ${days} أيام`;
  return `بعد ${days} يومًا`;
}


export function AcademicCalendarCard({ bare, limit = 3 }: { bare?: boolean; limit?: number } = {}) {
  // Computed on the client only — the page is statically exported, so
  // "today" must come from the visitor's clock, not the build machine.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
  }, []);

  const upcoming = now ? getUpcomingEvents(now).slice(0, limit) : [];
  const todayStr = now
    ? new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)
    : "";

  return (
    <PanelRoot bare={bare} className="glass p-8 rounded-[32px] border-foreground/10 relative overflow-hidden h-full flex flex-col">
      <div className={cn("flex items-center justify-between flex-wrap gap-3", bare ? "mb-3" : "mb-5")}>
        <div>
          <h3 className={cn("text-xl font-bold mb-1 flex items-center gap-2", bare && "sr-only")}>
            <CalendarDays className="w-5 h-5 text-uqu-cyan" />
            التقويم الجامعي {ACADEMIC_YEAR_LABEL}
          </h3>
          <p className="text-xs text-muted-foreground font-medium mt-1">{todayStr || "\u00a0"}</p>
        </div>
      </div>

      <div className="space-y-3 flex-1">
        {now && upcoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[120px] text-muted-foreground text-sm border-2 border-dashed border-foreground/10 rounded-2xl text-center px-4">
            انتهت أحداث التقويم الحالي. سيُحدَّث فور صدور تقويم العام القادم.
          </div>
        ) : (
          upcoming.map((ev) => {
            const live = now ? isOngoing(ev, now) : false;
            return (
              <div
                key={ev.title + ev.start}
                className={cn(
                  "p-4 rounded-2xl border flex flex-col gap-2",
                  live ? "bg-uqu-accent/10 border-uqu-accent/30" : "bg-foreground/5 border-foreground/10",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[13.5px] font-black text-foreground leading-tight">{ev.title}</span>
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0", getEventTone(ev.type))}>
                    {eventTypeLabel(ev.type)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground/90">{formatEventDateAr(ev)}</span>
                  <span>{ev.hijri} هـ</span>
                  <span className={cn("font-bold", live ? "text-uqu-accent" : "text-uqu-cyan")}>
                    {live ? "جارٍ الآن" : daysUntilLabel(ev, now!)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className={cn("text-[11px] font-bold text-center", bare ? "mt-3 text-uqu-accent" : "mt-5 pt-4 border-t border-foreground/10 text-muted-foreground font-medium")}>
        {bare ? "عرض التقويم الكامل للفصلين ←" : "اضغط لعرض التقويم الكامل للفصلين"}
      </div>
    </PanelRoot>
  );
}

export function AcademicCalendarDialogContent() {
  return (
    <DialogContent
      className="!bg-card border-border text-foreground shadow-2xl backdrop-blur-xl dark:!bg-card/95 dark:border-foreground/10 rounded-[28px] p-0 sm:max-w-[min(700px,calc(100%-2rem))] max-h-[88vh] flex flex-col"
      dir="rtl"
    >
      <DialogHeader className="px-6 md:px-8 pt-6 pb-4 border-b border-border dark:border-foreground/10 shrink-0">
        <DialogTitle className="text-xl font-black flex items-center gap-3">
          <CalendarClock className="w-6 h-6 text-sky-400" />
          التقويم الجامعي للعام {ACADEMIC_YEAR_LABEL}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-sm">
          جميع الأحداث الأكاديمية والأنظمة بناءً على التقويم المعتمد لجامعة أم القرى.
        </DialogDescription>
        <button
          type="button"
          onClick={() => downloadIcs(buildAcademicCalendarIcs(), "uqu-academic-calendar-1448.ics")}
          className="mt-3 self-start inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-uqu-accent text-white hover:bg-uqu-accent/90"
        >
          <CalendarPlus className="w-4 h-4" />
          أضف التقويم لجوالي (مع تذكير قبل المواعيد المهمة)
        </button>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 space-y-8 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
        {UQU_CALENDAR.map((termData, termIdx) => (
          <div key={termIdx} className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-foreground/10" />
              <h4 className="text-sm font-black text-uqu-cyan">
                {termData.term}
              </h4>
              <span className="h-px flex-1 bg-foreground/10" />
            </div>

            <div className="space-y-2">
              {termData.events.map((ev, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 p-3 rounded-xl bg-background border border-border hover:border-sky-500/30 transition-colors dark:bg-foreground/5 dark:border-foreground/10"
                >
                  <div className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[13px] truncate">{ev.title}</div>
                    <div className="flex flex-wrap items-center gap-x-3 mt-1 text-[11px] text-muted">
                      <span>{formatEventDateAr(ev)}</span>
                      <span>{ev.hijri} هـ</span>
                    </div>
                  </div>
                  <span className={cn("text-[10px] font-black px-2 py-1 rounded-md border shrink-0", getEventTone(ev.type))}>
                     {eventTypeLabel(ev.type)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DialogContent>
  );
}
