"use client";

import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  User,
  Target,
  Save,
  Sparkles,
  LogOut,
  CalendarDays,
  CheckCircle2,
  Rocket,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { logoutAndPurge } from "@/lib/auth-utils";
import { toast } from "@/lib/toast";
import { useTranscriptStore } from "@/store/transcriptStore";
import { useScheduleStore } from "@/store/scheduleStore";
import {
  useProfileStore,
  type ProfileBasic,
  type ProfileGoals,
  type ProfilePreferences,
} from "@/store/profileStore";
import { SetupWizard } from "@/components/setup-wizard/SetupWizard";
import { SmartPreferencesModal } from "@/components/profile/SmartPreferencesModal";
import { summarizePreferences } from "@/components/profile/preferenceOptions";
import { cn } from "@/lib/utils";

type ProfileDraft = {
  basic: ProfileBasic;
  goals: ProfileGoals;
  preferences: ProfilePreferences;
};

function draftFromStore(): ProfileDraft {
  const s = useProfileStore.getState();
  return {
    basic: { ...s.basic },
    goals: { ...s.goals },
    preferences: { ...s.preferences },
  };
}

export default function ProfilePage() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isPrefsOpen, setIsPrefsOpen] = useState(false);

  // Phase 4B.4 — edit in local draft; commit to store only on "حفظ التغييرات".
  const [draft, setDraft] = useState<ProfileDraft>(draftFromStore);
  const [dirty, setDirty] = useState(false);

  const storeBasic = useProfileStore((s) => s.basic);
  const storeGoals = useProfileStore((s) => s.goals);
  const storePreferences = useProfileStore((s) => s.preferences);
  const setBasic = useProfileStore((s) => s.setBasic);
  const setGoals = useProfileStore((s) => s.setGoals);
  const setPreferences = useProfileStore((s) => s.setPreferences);

  useEffect(() => {
    if (!dirty) {
      setDraft({
        basic: storeBasic,
        goals: storeGoals,
        preferences: storePreferences,
      });
    }
  }, [storeBasic, storeGoals, storePreferences, dirty]);

  const summaryChips = summarizePreferences(draft.preferences);

  // Zustand-backed state for the unified setup card. We read the data
  // fields (not the function) so the component re-renders when either
  // store changes (e.g., when the wizard finishes).
  const hasTranscript = useTranscriptStore((s) => s.completedCourses.length > 0);
  const transcriptName = useTranscriptStore((s) => s.name || s.nameEn);
  const transcriptCourses = useTranscriptStore((s) => s.completedCourses.length);
  const transcriptCurrent = useTranscriptStore((s) => s.currentCourses.length);
  const transcriptUpdated = useTranscriptStore((s) => s.lastUpdated);
  const scheduleSlots = useScheduleStore((s) => s.schedule.length);
  const scheduleUpdated = useScheduleStore((s) => s.lastUpdated);
  const hasSchedule = scheduleSlots > 0;

  const handleSave = () => {
    setBasic({ ...draft.basic });
    setGoals({ ...draft.goals });
    setPreferences({ ...draft.preferences });
    setDirty(false);
    toast.success("تم حفظ الملف الشخصي بنجاح");
  };

  const handlePreferencesChange = (patch: Partial<ProfilePreferences>) => {
    setDraft((d) => ({
      ...d,
      preferences: { ...d.preferences, ...patch },
    }));
    setDirty(true);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-32 px-4 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black mb-2">الملف الشخصي</h1>
            <p className="text-muted-foreground">قم بإعداد بياناتك للحصول على أفضل تجربة ذكاء اصطناعي.</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleSave} className="rounded-2xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2">
              <Save className="w-4 h-4" />
              حفظ التغييرات
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                // logoutAndPurge wipes every persisted Zustand slot
                // (profile, transcript, schedule, plan, chat history)
                // AND localStorage/sessionStorage before forcing a hard
                // navigation to /login — guarantees the next user on
                // this browser starts clean. See lib/auth-utils.ts.
                await logoutAndPurge("/login");
              }}
              className="rounded-2xl gap-2"
            >
              <LogOut className="w-4 h-4" />
              خروج
            </Button>
          </div>
        </div>

        {/* Unified Academic Setup card — replaces the old separate
            "محلل السجل" and "محلل الجدول" buttons. */}
        <Card
          className={cn(
            "rounded-[32px] p-6 md:p-8 mb-8 relative overflow-hidden",
            hasTranscript && hasSchedule
              ? "glass border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent"
              : "glass border border-[#0066cc]/30 bg-gradient-to-br from-[#0066cc]/8 via-transparent to-cyan-500/5 shadow-[0_0_40px_rgba(0,102,204,0.12)]",
          )}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0",
                  hasTranscript && hasSchedule
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : "bg-[#0066cc] text-foreground shadow-[0_0_18px_rgba(0,102,204,0.5)]",
                )}
              >
                {hasTranscript && hasSchedule ? (
                  <CheckCircle2 className="w-7 h-7" />
                ) : (
                  <Rocket className="w-7 h-7" />
                )}
              </div>
              <div>
                <h2 className="text-xl md:text-2xl font-black tracking-tight mb-1">
                  تهيئة بياناتي الأكاديمية
                </h2>
                <p className="text-sm text-muted-foreground max-w-lg">
                  {hasTranscript && hasSchedule
                    ? "ملفك الأكاديمي مكتمل. يمكنك إعادة المعالج لتحديث البيانات في أي وقت."
                    : "ارفع سجلك الأكاديمي وجدولك الأسبوعي مرة واحدة، وسيشتغل المساعد بكامل قدراته."}
                </p>
              </div>
            </div>
            <Button
              onClick={() => setIsWizardOpen(true)}
              className={cn(
                "rounded-2xl gap-2 px-5 py-5 font-bold",
                hasTranscript && hasSchedule
                  ? "bg-foreground/5 border border-foreground/10 hover:bg-foreground/5 text-foreground"
                  : "bg-[#0066cc] hover:bg-[#005bb5] text-foreground shadow-[0_0_24px_rgba(0,102,204,0.4)]",
              )}
            >
              {hasTranscript && hasSchedule ? (
                <>عرض / تعديل</>
              ) : (
                <>
                  <Rocket className="w-4 h-4" />
                  🚀 ابدأ تهيئة بياناتك الآن
                </>
              )}
            </Button>
          </div>

          {(hasTranscript || hasSchedule) && (
            <div className="grid sm:grid-cols-2 gap-3 mt-6">
              <SetupSummaryCard
                title="السجل الأكاديمي"
                isReady={hasTranscript}
                primaryLine={
                  hasTranscript
                    ? `${transcriptCourses} مادة منجزة · ${transcriptCurrent} في الترم الحالي`
                    : "لم يُرفع بعد"
                }
                secondaryLine={
                  hasTranscript && transcriptName
                    ? transcriptName
                    : transcriptUpdated
                      ? new Date(transcriptUpdated).toLocaleDateString("ar-SA")
                      : undefined
                }
              />
              <SetupSummaryCard
                title="الجدول الدراسي"
                isReady={hasSchedule}
                primaryLine={
                  hasSchedule
                    ? `${scheduleSlots} محاضرة موزعة على الأسبوع`
                    : "لم يُرفع بعد"
                }
                secondaryLine={
                  scheduleUpdated
                    ? new Date(scheduleUpdated).toLocaleDateString("ar-SA")
                    : undefined
                }
              />
            </div>
          )}
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Basic Info */}
          <Card className="glass p-8 rounded-[32px] border-foreground/10 space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-uqu-accent/10 flex items-center justify-center text-uqu-accent">
                <User className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold">البيانات الأساسية</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>الاسم الكامل</Label>
                <Input
                  value={draft.basic.name}
                  onChange={(e) => {
                    setDraft((d) => ({
                      ...d,
                      basic: { ...d.basic, name: e.target.value },
                    }));
                    setDirty(true);
                  }}
                  placeholder="أدخل اسمك..."
                  className="rounded-xl glass border-foreground/10"
                />
              </div>
              <div className="space-y-2">
                <Label>التخصص الدراسي</Label>
                <Input
                  value={draft.basic.major}
                  onChange={(e) => {
                    setDraft((d) => ({
                      ...d,
                      basic: { ...d.basic, major: e.target.value },
                    }));
                    setDirty(true);
                  }}
                  placeholder="مثال: هندسة حاسب"
                  className="rounded-xl glass border-foreground/10"
                />
              </div>
              <div className="space-y-2">
                <Label>الرقم الجامعي</Label>
                <Input
                  value={draft.basic.studentId}
                  onChange={(e) => {
                    setDraft((d) => ({
                      ...d,
                      basic: { ...d.basic, studentId: e.target.value },
                    }));
                    setDirty(true);
                  }}
                  placeholder="4xxxxxxxx"
                  className="rounded-xl glass border-foreground/10"
                />
              </div>
              <div className="space-y-2">
                <Label>عدد ساعات الخطة</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={draft.basic.totalPlanHours}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setDraft((d) => ({
                      ...d,
                      basic: {
                        ...d.basic,
                        totalPlanHours:
                          raw === "" ? "" : Math.max(0, parseInt(raw, 10) || 0),
                      },
                    }));
                    setDirty(true);
                  }}
                  placeholder="مثال: 132"
                  className="rounded-xl glass border-foreground/10"
                />
                <p className="text-[11px] text-muted leading-relaxed">
                  إجمالي الساعات في خطتك الأكاديمية — يُستخدم لحساب المعدل التراكمي.
                </p>
              </div>
            </div>
          </Card>

          {/* Academic Goals */}
          <Card className="glass p-8 rounded-[32px] border-foreground/10 space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-uqu-cyan/10 flex items-center justify-center text-uqu-cyan">
                <Target className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold">الأهداف الأكاديمية</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>المعدل الحالي</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={draft.goals.currentGpa}
                  onChange={(e) => {
                    setDraft((d) => ({
                      ...d,
                      goals: {
                        ...d.goals,
                        currentGpa: parseFloat(e.target.value) || 0,
                      },
                    }));
                    setDirty(true);
                  }}
                  className="rounded-xl glass border-foreground/10"
                />
              </div>
              <div className="space-y-2">
                <Label>المعدل المستهدف</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={draft.goals.targetGpa}
                  onChange={(e) => {
                    setDraft((d) => ({
                      ...d,
                      goals: {
                        ...d.goals,
                        targetGpa: parseFloat(e.target.value) || 0,
                      },
                    }));
                    setDirty(true);
                  }}
                  className="rounded-xl glass border-foreground/10"
                />
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-uqu-cyan/5 border border-uqu-cyan/10">
              <p className="text-xs text-uqu-cyan font-medium leading-relaxed">
                <Sparkles className="inline-block w-3 h-3 ml-1" />
                سيستخدم المساعد هذه الأهداف لتقديم نصائح مخصصة لتحسين أدائك الأكاديمي.
              </p>
            </div>
          </Card>

          {/* Smart Preferences — compact summary; opens full hub in a modal */}
          <Card className="glass p-6 md:p-7 rounded-[32px] border-foreground/10 md:col-span-2 relative overflow-hidden">
            <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-uqu-accent/10 blur-3xl pointer-events-none" />
            <div className="relative flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-uqu-accent/10 flex items-center justify-center text-uqu-accent shrink-0">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold mb-1">تفضيلات المذاكرة</h2>
                  <p className="text-xs text-muted-foreground">
                    اختياراتك الحالية — تُغذّي مولّد خطة الدراسة وجلسات التركيز.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => setIsPrefsOpen(true)}
                className="rounded-2xl bg-foreground/5 border border-foreground/10 hover:bg-foreground/5 text-foreground gap-2 font-bold"
              >
                <Settings2 className="w-4 h-4" />
                تعديل التفضيلات
              </Button>
            </div>

            <div className="relative flex flex-wrap gap-2 mt-5">
              {summaryChips.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center px-3 py-1.5 rounded-xl bg-foreground/5 border border-foreground/10 text-[13px] font-bold text-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          </Card>
        </div>
      </main>

      <SetupWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
      <SmartPreferencesModal
        isOpen={isPrefsOpen}
        onClose={() => setIsPrefsOpen(false)}
        preferences={draft.preferences}
        onPreferencesChange={handlePreferencesChange}
      />
    </div>
  );
}

function SetupSummaryCard({
  title,
  isReady,
  primaryLine,
  secondaryLine,
}: {
  title: string;
  isReady: boolean;
  primaryLine: string;
  secondaryLine?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-4 rounded-2xl border",
        isReady
          ? "bg-emerald-500/[0.07] border-emerald-500/20"
          : "bg-foreground/5 border-foreground/10",
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
          isReady ? "bg-emerald-500/15 text-emerald-400" : "bg-foreground/5 text-muted",
        )}
      >
        {isReady ? <CheckCircle2 className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold">{title}</span>
          {isReady && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              مُكتمل
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{primaryLine}</div>
        {secondaryLine && (
          <div className="text-[10px] text-muted truncate font-mono">{secondaryLine}</div>
        )}
      </div>
    </div>
  );
}
