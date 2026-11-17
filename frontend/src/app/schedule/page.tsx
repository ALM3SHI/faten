"use client";

import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  CalendarDays,
  ArrowRight,
  Eye,
  Trash2,
  Clock,
  MapPin,
  CalendarPlus,
  Moon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useScheduleStore, WEEK_DAYS, type ScheduleSlot } from "@/store/scheduleStore";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getCurrentTerm, weekdayIndex } from "@/lib/academic-term";
import { buildScheduleIcs, downloadIcs } from "@/lib/ics";
import { dateOfWeekday, prayerDuringLecture, prayerTimesFor, toMinutes, type PrayerTime } from "@/lib/prayer-times";
import { toast } from "@/lib/toast";
import { count, formatDayTime } from "@/lib/format-date";

const PRAYER_PREF_KEY = "uqu_show_prayers";

type ParseState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "success"; schedule: ScheduleSlot[] }
  | { kind: "error"; message: string };

export default function SchedulePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [parseState, setParseState] = useState<ParseState>({ kind: "idle" });

  const [showPrayers, setShowPrayers] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowPrayers(localStorage.getItem(PRAYER_PREF_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PRAYER_PREF_KEY, showPrayers ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [showPrayers]);

  const existingSchedule = useScheduleStore((s) => s.schedule);
  const lastUpdated = useScheduleStore((s) => s.lastUpdated);
  const setSchedule = useScheduleStore((s) => s.setSchedule);
  const clearSchedule = useScheduleStore((s) => s.clearSchedule);

  // The grid below renders either the freshly-parsed result, or whatever is
  // already persisted in the store. The fresh result takes precedence.
  const slotsToRender: ScheduleSlot[] =
    parseState.kind === "success" ? parseState.schedule : existingSchedule;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) setFile(picked);
  };

  const uploadAndAnalyze = async () => {
    if (!file) return;
    setParseState({ kind: "uploading" });

    // Local geometric / regex parsing was abandoned after 12 failed
    // attempts — UQU's Arabic PDF encoding is too broken. We POST the
    // raw PDF to a Vision-capable Gemini endpoint and let it "see"
    // the table the way a human would.
    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await fetchWithAuth("/api/schedule/analyze-vision", {
        method: "POST",
        body: formData,
      });
      const slots: ScheduleSlot[] = Array.isArray(data?.schedule) ? data.schedule : [];

      // Persist into the existing scheduleStore so the Pomodoro widget
      // and plan generator pick it up unchanged.
      setSchedule(slots);
      setParseState({ kind: "success", schedule: slots });
    } catch (error: unknown) {
      console.error("Schedule vision error:", error);
      setParseState({
        kind: "error",
        message:
          (error instanceof Error && error.message) ||
          "تعذّر تحليل الجدول. تأكد من أن الملف PDF صالح وحاول مرة أخرى.",
      });
    }
  };

  const handleReset = () => {
    setFile(null);
    setParseState({ kind: "idle" });
  };

  return (
    <div className="ds-page min-h-screen bg-canvas text-ink pb-20" dir="rtl">
      <Navbar />

      <main className="container mx-auto pt-24 px-4 max-w-6xl">

        <SectionTabs className="mb-6" />
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="رجوع" className="rounded-control border border-line bg-surface shadow-card">
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-title font-bold flex items-center gap-3">
              <CalendarDays className="w-7 h-7 text-info-ink" />
              محلّل الجدول الدراسي
            </h1>
            <p className="text-ink-muted text-small">
              ارفع جدول المحاضرات بصيغة PDF — يُحلَّل بصرياً بدقة عالية ويُحفظ تلقائياً.
            </p>
          </div>
        </div>

        {/* Upload card OR loading state OR result */}
        {parseState.kind === "idle" && !slotsToRender.length ? (
          <UploadCard file={file} onFileChange={handleFileChange} onAnalyze={uploadAndAnalyze} />
        ) : parseState.kind === "uploading" ? (
          <LoadingCard />
        ) : parseState.kind === "error" ? (
          <ErrorCard message={parseState.message} onRetry={handleReset} />
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            {/* Re-upload affordance + meta */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="bg-success-soft text-success-ink border-success-line">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {count(slotsToRender.length, "محاضرة محفوظة", "محاضرات محفوظة")}
                </Badge>
                {lastUpdated && (
                  <span className="text-caption text-ink-muted">
                    آخر تحديث: {formatDayTime(lastUpdated)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPrayers((v) => !v)}
                  aria-pressed={showPrayers}
                  className={cn(
                    "rounded-control border border-line bg-surface shadow-card gap-2",
                    showPrayers && "border-success-line text-success-ink ",
                  )}
                >
                  <Moon className="w-4 h-4" />
                  {showPrayers ? "إخفاء أوقات الصلاة" : "أوقات الصلاة"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => exportToCalendar(slotsToRender)}
                  className="rounded-control gap-2 bg-brand hover:bg-brand-hover text-on-brand"
                >
                  <CalendarPlus className="w-4 h-4" />
                  أضف لتقويم جوالي
                </Button>
                <input
                  type="file"
                  id="schedule-upload"
                  className="hidden"
                  accept=".pdf"
                  onChange={(e) => {
                    handleFileChange(e);
                    setParseState({ kind: "idle" });
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById("schedule-upload")?.click()}
                  className="rounded-control border border-line bg-surface shadow-card gap-2"
                >
                  <Upload className="w-4 h-4" />
                  رفع جدول جديد
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clearSchedule();
                    setParseState({ kind: "idle" });
                  }}
                  className="rounded-control border border-line bg-surface shadow-card border-danger-line text-danger-ink gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  حذف
                </Button>
              </div>
            </div>

            {file && parseState.kind !== "success" && (
              <Card className="border border-line bg-surface shadow-card rounded-card p-4 flex items-center gap-3">
                <FileText className="w-4 h-4 text-info-ink" />
                <span className="text-small">{file.name}</span>
                <Button onClick={uploadAndAnalyze} size="sm" className="mr-auto rounded-control bg-brand hover:bg-brand-hover">
                  تحليل الآن
                </Button>
              </Card>
            )}

            <ScheduleGrid slots={slotsToRender} showPrayers={showPrayers} />
          </div>
        )}
      </main>
    </div>
  );
}

// ── Upload / loading / error sub-cards ───────────────────────────────
function UploadCard({
  file,
  onFileChange,
  onAnalyze,
}: {
  file: File | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAnalyze: () => void;
}) {
  return (
    <Card
      className="border border-line bg-surface shadow-card border-dashed rounded-card p-12 text-center flex flex-col items-center gap-6 group hover:border-info-line transition-all cursor-pointer relative overflow-hidden"
      onClick={() => document.getElementById("schedule-upload")?.click()}
    >
      <div className="w-24 h-24 rounded-card bg-info-soft flex items-center justify-center group-hover:scale-110 transition-transform">
        <Upload className="w-10 h-10 text-info-ink" />
      </div>
      <div>
        <h2 className="text-heading font-bold mb-2">ارفع جدول المحاضرات (PDF)</h2>
        <p className="text-ink-muted max-w-sm mx-auto">
          الذكاء البصري سيقرأ شبكة الأيام والأوقات تلقائياً ويستخرج كل محاضرة بدقة.
        </p>
      </div>
      <input type="file" id="schedule-upload" className="hidden" accept=".pdf" onChange={onFileChange} />
      {file && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-control bg-surface-sunken border border-line animate-in zoom-in-95">
          <FileText className="w-4 h-4 text-info-ink" />
          <span className="text-small font-medium">{file.name}</span>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onAnalyze();
            }}
            className="mr-4 rounded-control bg-brand hover:bg-brand-hover"
          >
            تحليل الآن
          </Button>
        </div>
      )}
    </Card>
  );
}

function LoadingCard() {
  return (
    <div className="border border-line bg-surface shadow-card rounded-card p-20 text-center flex flex-col items-center gap-8">
      <div className="relative">
        <div className="w-24 h-24 rounded-full border-4 border-info-line border-t-brand animate-spin" />
        <Eye className="w-8 h-8 text-info-ink absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
      </div>
      <div className="space-y-2">
        <h2 className="text-heading font-bold">⏳ جاري قراءة أوقات المحاضرات بالذكاء البصري...</h2>
        <p className="text-ink-muted">نمرّر الجدول على نموذج بصري متعدد الوسائط لقراءة الشبكة كاملةً كما يراها الإنسان.</p>
      </div>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-6 border-danger-line bg-danger-soft text-danger-ink rounded-card flex items-center gap-4">
      <AlertCircle className="w-8 h-8 shrink-0" />
      <div>
        <h4 className="font-bold">فشل التحليل</h4>
        <p className="text-small opacity-90">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline" className="mr-auto rounded-control border-danger-line text-danger-ink">
        إعادة المحاولة
      </Button>
    </Card>
  );
}

// ── Calendar export ─────────────────────────────────────────────────
function exportToCalendar(slots: ScheduleSlot[]) {
  const term = getCurrentTerm(new Date());
  if (!term || slots.length === 0) {
    toast.error("ما فيه جدول نصدّره.");
    return;
  }
  downloadIcs(buildScheduleIcs(slots, term), "faten-schedule.ics");
  toast.success("تم تنزيل الملف — افتحه وأضفه لتقويمك (آيفون: يضاف مباشرة · جوجل: من الإعدادات ← استيراد).");
}

// ── Weekly grid ─────────────────────────────────────────────────────
type DayItem =
  | { kind: "slot"; slot: ScheduleSlot; prayer: PrayerTime | null; at: number }
  | { kind: "prayer"; prayer: PrayerTime; at: number };

function ScheduleGrid({ slots, showPrayers }: { slots: ScheduleSlot[]; showPrayers: boolean }) {
  // Prayer times for each weekday of the current week (client clock).
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(new Date());
  }, []);
  const prayersByDay = useMemo(() => {
    const map = new Map<string, PrayerTime[]>();
    if (!today) return map;
    for (const day of WEEK_DAYS) {
      map.set(day, prayerTimesFor(dateOfWeekday(today, weekdayIndex(day)), ["dhuhr", "asr", "maghrib"]));
    }
    return map;
  }, [today]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {WEEK_DAYS.map((day) => {
        const daySlots = slots
          .filter((s) => s.day === day)
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        const prayers = showPrayers ? prayersByDay.get(day) ?? [] : [];
        const items: DayItem[] = [
          ...daySlots.map((slot) => ({
            kind: "slot" as const,
            slot,
            prayer: prayers.find((p) => prayerDuringLecture(p.time, slot.start_time, slot.end_time)) ?? null,
            at: toMinutes(slot.start_time),
          })),
          ...prayers.map((prayer) => ({ kind: "prayer" as const, prayer, at: toMinutes(prayer.time) })),
        ].sort((a, b) => a.at - b.at);
        const empty = daySlots.length === 0 && prayers.length === 0;
        return (
          <Card key={day} className="border border-line bg-surface shadow-card rounded-card overflow-hidden flex flex-col">
            <div className={cn("p-4 bg-surface-sunken flex items-center justify-between", !empty && "border-b border-line")}>
              <h3 className="font-bold text-small">{day}</h3>
              <span className="text-caption text-ink-muted font-bold">
                {daySlots.length === 0 ? "لا محاضرات" : count(daySlots.length, "محاضرة", "محاضرات")}
              </span>
            </div>
            {/* an empty day is just its header on phones; full height beside the others on wide screens */}
            <div className={cn("p-3 flex-col gap-2 min-h-[120px]", empty ? "hidden md:flex" : "flex")}>
              {daySlots.length === 0 && prayers.length === 0 ? (
                <p className="text-center text-caption text-ink-muted my-auto">لا محاضرات</p>
              ) : (
                items.map((it, i) =>
                  it.kind === "slot" ? (
                    <SlotCard key={`${day}-s${i}`} slot={it.slot} prayer={it.prayer} />
                  ) : (
                    <PrayerRow key={`${day}-p${i}`} prayer={it.prayer} />
                  ),
                )
              )}
            </div>
          </Card>
        );
      })}
      {showPrayers && (
        <p className="col-span-full text-caption text-ink-muted text-center">
          أوقات الصلاة لهذا الأسبوع بتوقيت مكة المكرمة (تقويم أم القرى).
        </p>
      )}
    </div>
  );
}

function PrayerRow({ prayer }: { prayer: PrayerTime }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-control bg-success-soft border border-success-line text-caption text-success-ink font-bold">
      <Moon className="w-3 h-3" />
      صلاة {prayer.name}
      <span className="mr-auto font-mono">{prayer.time}</span>
    </div>
  );
}

function SlotCard({ slot, prayer }: { slot: ScheduleSlot; prayer?: PrayerTime | null }) {
  const isLab = slot.type === "عملي";
  return (
    <div
      className={cn(
        "rounded-card border p-3 flex flex-col gap-1.5",
        isLab
          ? "bg-warning-soft border-warning-line"
          : "bg-info-soft border-info-line",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-mono font-bold text-ink-muted">
          {slot.course_code || "—"}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "text-caption px-1.5 py-0",
            isLab ? "bg-warning-soft text-warning-ink border-warning-line" : "bg-info-soft text-info-ink border-info-line",
          )}
        >
          {slot.type || "نظري"}
        </Badge>
      </div>
      <div className="text-caption font-bold leading-snug">{slot.course_name || "—"}</div>
      <div className="flex items-center gap-3 text-caption text-ink-muted font-mono">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {slot.start_time}–{slot.end_time}
        </span>
        {(slot.room || slot.building) && (
          <span className="flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3" />
            {[slot.building, slot.room].filter(Boolean).join(" / ")}
          </span>
        )}
      </div>
      {prayer && (
        <div className="text-caption font-bold text-success-ink flex items-center gap-1">
          <Moon className="w-3 h-3" />
          صلاة {prayer.name} {prayer.time} أثناء المحاضرة
        </div>
      )}
    </div>
  );
}
