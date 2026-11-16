"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CalendarClock, CalendarPlus } from "lucide-react";
import { buildAcademicCalendarIcs, downloadIcs } from "@/lib/ics";
import { PanelRoot } from "@/components/dashboard/panel-root";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ds/button";
import { Pill, type Tone } from "@/components/ds/surface";
import {
  ACADEMIC_YEAR_LABEL,
  UQU_CALENDAR,
  eventStart,
  formatEventDateAr,
  getUpcomingEvents,
  isOngoing,
  type CalendarEvent,
} from "@/lib/uqu-calendar-data";

/** The status tone of an event type: exams warn, procedures inform, the rest is neutral. */
function eventTone(type: string): Tone {
  switch (type) {
    case "holiday": return "success";
    case "exam": return "warning";
    case "system": return "info";
    default: return "neutral";
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
    ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)
    : "";

  return (
    <PanelRoot bare={bare} className="relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface p-5 shadow-card">
      {/* Inside a page (bare) the page already shows today's date and a heading. */}
      <div className={cn("mb-4 flex flex-wrap items-center justify-between gap-3", bare && "sr-only")}>
        <div>
          <h3 className="flex items-center gap-2 text-heading font-bold">
            <CalendarDays className="size-5 text-info-ink" aria-hidden />
            التقويم الجامعي {ACADEMIC_YEAR_LABEL}
          </h3>
          <p className="mt-1 text-caption font-medium text-ink-muted">{todayStr || "\u00a0"}</p>
        </div>
      </div>

      <div className="flex-1 space-y-3">
        {now && upcoming.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center rounded-card border border-dashed border-line-strong px-4 text-center text-small text-ink-muted">
            انتهت أحداث التقويم الحالي. سيُحدَّث فور صدور تقويم العام القادم.
          </div>
        ) : (
          upcoming.map((ev) => {
            const live = now ? isOngoing(ev, now) : false;
            return (
              <div
                key={ev.title + ev.start}
                className={cn(
                  "flex flex-col gap-2 rounded-card border p-4 shadow-card",
                  live ? "border-info-line bg-info-soft" : "border-line bg-surface",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-body font-semibold text-ink">{ev.title}</span>
                  <Pill tone={eventTone(ev.type)}>{eventTypeLabel(ev.type)}</Pill>
                </div>
                <div className="nums flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
                  <span className="font-medium text-ink">{formatEventDateAr(ev)}</span>
                  <span>{ev.hijri} هـ</span>
                  <span className="font-semibold text-info-ink">{live ? "جارٍ الآن" : daysUntilLabel(ev, now!)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!bare && (
        <div className="mt-5 border-t border-line pt-4 text-center text-caption font-medium text-ink-muted">اضغط لعرض التقويم الكامل للفصلين</div>
      )}
    </PanelRoot>
  );
}

export function AcademicCalendarDialogContent() {
  return (
    <DialogContent
      className="ds-page flex max-h-[88vh] flex-col rounded-dialog border-line !bg-surface-raised p-0 text-ink shadow-dialog sm:max-w-[min(700px,calc(100%-2rem))]"
      dir="rtl"
    >
      <DialogHeader className="shrink-0 border-b border-line px-6 pt-6 pb-4 md:px-8">
        <DialogTitle className="flex items-center gap-3 text-heading font-bold">
          <CalendarClock className="size-6 text-info-ink" aria-hidden />
          التقويم الجامعي للعام {ACADEMIC_YEAR_LABEL}
        </DialogTitle>
        <DialogDescription className="text-small text-ink-muted">
          جميع الأحداث الأكاديمية والأنظمة بناءً على التقويم المعتمد لجامعة أم القرى.
        </DialogDescription>
        <Button
          variant="primary"
          size="sm"
          onClick={() => downloadIcs(buildAcademicCalendarIcs(), "uqu-academic-calendar-1448.ics")}
          className="mt-3 self-start"
        >
          <CalendarPlus aria-hidden />
          أضف التقويم لجوالي (مع تذكير قبل المواعيد المهمة)
        </Button>
      </DialogHeader>

      <div className="flex-1 space-y-8 overflow-y-auto px-6 py-5 md:px-8">
        {UQU_CALENDAR.map((termData, termIdx) => (
          <div key={termIdx} className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <h4 className="text-small font-bold text-info-ink">{termData.term}</h4>
              <span className="h-px flex-1 bg-line" />
            </div>

            <div className="space-y-2">
              {termData.events.map((ev, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 rounded-control border border-line bg-surface p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-small font-semibold text-ink">{ev.title}</div>
                    <div className="nums mt-1 flex flex-wrap items-center gap-x-3 text-caption text-ink-muted">
                      <span>{formatEventDateAr(ev)}</span>
                      <span>{ev.hijri} هـ</span>
                    </div>
                  </div>
                  <Pill tone={eventTone(ev.type)}>{eventTypeLabel(ev.type)}</Pill>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DialogContent>
  );
}
