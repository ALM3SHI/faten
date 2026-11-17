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
import dynamic from "next/dynamic";
import { useLatch } from "@/lib/use-latch";
import { PrivacyCard } from "@/components/profile/privacy-card";
import { NotificationsCard } from "@/components/profile/notifications-card";
import { ReplayTourButton } from "@/components/profile/replay-tour-button";
import { AdminLink } from "@/components/profile/admin-link";
import { PageTabs } from "@/components/ui/page-tabs";
// Dialogs load the first time they open, not with the page.
const SetupWizard = dynamic(() => import("@/components/setup-wizard/SetupWizard").then((m) => m.SetupWizard), { ssr: false });
const SmartPreferencesModal = dynamic(() => import("@/components/profile/SmartPreferencesModal").then((m) => m.SmartPreferencesModal), { ssr: false });
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
  const wizardMounted = useLatch(isWizardOpen);
  const prefsMounted = useLatch(isPrefsOpen);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror the store into the form until the user edits
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
    <div className="ds-page min-h-screen bg-canvas text-ink pb-20">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-24 px-4 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-title font-bold mb-2">الملف الشخصي</h1>
            <p className="text-ink-muted">قم بإعداد بياناتك للحصول على أفضل تجربة</p>
          </div>
          <div className="flex gap-3">
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
              className="rounded-card gap-2"
            >
              <LogOut className="w-4 h-4" />
              خروج
            </Button>
          </div>
        </div>

        <PageTabs
          label="أقسام الملف الشخصي"
          tabs={[
            {
              value: "data",
              label: "بياناتي",
              content: (
                <div className="space-y-6">
        {/* Unified Academic Setup card — replaces the old separate
            "محلل السجل" and "محلل الجدول" buttons. */}
        <Card
          className={cn(
            "rounded-card p-6 md:p-8 relative overflow-hidden",
            hasTranscript && hasSchedule
              ? "border shadow-card border-success-line bg-info-soft border-info-line"
              : "border shadow-card border-info-line bg-info-soft ",
          )}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  "w-14 h-14 rounded-card flex items-center justify-center shrink-0",
                  hasTranscript && hasSchedule
                    ? "bg-success-soft text-success-ink border border-success-line"
                    : "bg-brand text-on-brand ",
                )}
              >
                {hasTranscript && hasSchedule ? (
                  <CheckCircle2 className="w-7 h-7" />
                ) : (
                  <Rocket className="w-7 h-7" />
                )}
              </div>
              <div>
                <h2 className="text-heading md:text-heading font-bold tracking-tight mb-1">
                  تهيئة بياناتي الأكاديمية
                </h2>
                <p className="text-small text-ink-muted max-w-lg">
                  {hasTranscript && hasSchedule
                    ? "ملفك الأكاديمي مكتمل. يمكنك إعادة المعالج لتحديث البيانات في أي وقت."
                    : "ارفع سجلك الأكاديمي وجدولك الأسبوعي مرة واحدة، وسيشتغل المساعد بكامل قدراته."}
                </p>
              </div>
            </div>
            <Button
              onClick={() => setIsWizardOpen(true)}
              className={cn(
                "rounded-card gap-2 px-5 py-5 font-bold",
                hasTranscript && hasSchedule
                  ? "bg-surface-sunken border border-line hover:bg-surface-sunken text-ink"
                  : "bg-brand hover:bg-brand-hover text-on-brand ",
              )}
            >
              {hasTranscript && hasSchedule ? (
                <>عرض / تعديل</>
              ) : (
                <>
                  <Rocket className="w-4 h-4" />
                  ابدأ تهيئة بياناتك الآن
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
          <Card className="border border-line bg-surface shadow-card p-8 rounded-card space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-control bg-info-soft flex items-center justify-center text-info-ink">
                <User className="w-5 h-5" />
              </div>
              <h2 className="text-heading font-bold">البيانات الأساسية</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">الاسم الكامل</Label>
                <Input
                  id="profile-name"
                  value={draft.basic.name}
                  onChange={(e) => {
                    setDraft((d) => ({
                      ...d,
                      basic: { ...d.basic, name: e.target.value },
                    }));
                    setDirty(true);
                  }}
                  placeholder="أدخل اسمك..."
                  className="rounded-control border border-line bg-surface shadow-card"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-major">التخصص الدراسي</Label>
                <Input
                  id="profile-major"
                  value={draft.basic.major}
                  onChange={(e) => {
                    setDraft((d) => ({
                      ...d,
                      basic: { ...d.basic, major: e.target.value },
                    }));
                    setDirty(true);
                  }}
                  placeholder="مثال: هندسة حاسب"
                  className="rounded-control border border-line bg-surface shadow-card"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-id">الرقم الجامعي</Label>
                <Input
                  id="profile-id"
                  value={draft.basic.studentId}
                  onChange={(e) => {
                    setDraft((d) => ({
                      ...d,
                      basic: { ...d.basic, studentId: e.target.value },
                    }));
                    setDirty(true);
                  }}
                  placeholder="4xxxxxxxx"
                  className="rounded-control border border-line bg-surface shadow-card"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-plan-hours">عدد ساعات الخطة</Label>
                <Input
                  id="profile-plan-hours"
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
                  className="rounded-control border border-line bg-surface shadow-card"
                />
                <p className="text-caption text-ink-muted leading-relaxed">
                  إجمالي الساعات في خطتك الأكاديمية — يُستخدم لحساب المعدل التراكمي.
                </p>
              </div>
            </div>
          </Card>

          {/* Academic Goals */}
          <Card className="border border-line bg-surface shadow-card p-8 rounded-card space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-control bg-info-soft flex items-center justify-center text-info-ink">
                <Target className="w-5 h-5" />
              </div>
              <h2 className="text-heading font-bold">الأهداف الأكاديمية</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="profile-gpa">المعدل الحالي</Label>
                <Input
                  id="profile-gpa"
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
                  className="rounded-control border border-line bg-surface shadow-card"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-target">المعدل المستهدف</Label>
                <Input
                  id="profile-target"
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
                  className="rounded-control border border-line bg-surface shadow-card"
                />
              </div>
            </div>

            <div className="p-4 rounded-card bg-info-soft border border-brand">
              <p className="text-caption text-info-ink font-medium leading-relaxed">
                <Sparkles className="inline-block w-3 h-3 ml-1" />
                سيستخدم المساعد هذه الأهداف لتقديم نصائح مخصصة لتحسين أدائك الأكاديمي.
              </p>
            </div>
          </Card>

                  </div>
                </div>
              ),
            },
            {
              value: "notifications",
              label: "الإعدادات",
              content: (
                <div className="grid gap-6">
          {/* Smart Preferences — compact summary; opens full hub in a modal */}
          <Card className="border border-line bg-surface shadow-card p-6 md:p-7 rounded-card relative overflow-hidden">
            <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-info-soft blur-3xl pointer-events-none" />
            <div className="relative flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-11 h-11 rounded-control bg-info-soft flex items-center justify-center text-info-ink shrink-0">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-subheading font-bold mb-1">تفضيلات المذاكرة</h2>
                  <p className="text-caption text-ink-muted">
                    اختياراتك الحالية — تُغذّي مولّد خطة الدراسة وجلسات التركيز.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => setIsPrefsOpen(true)}
                className="rounded-card bg-surface-sunken border border-line hover:bg-surface-sunken text-ink gap-2 font-bold"
              >
                <Settings2 className="w-4 h-4" />
                تعديل التفضيلات
              </Button>
            </div>

            <div className="relative flex flex-wrap gap-2 mt-5">
              {summaryChips.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center px-3 py-1.5 rounded-control bg-surface-sunken border border-line text-small font-bold text-ink"
                >
                  {label}
                </span>
              ))}
            </div>
          </Card>
                  <NotificationsCard />
                </div>
              ),
            },
            {
              value: "account",
              label: "الخصوصية",
              content: (
                <div className="grid gap-6">
                  <PrivacyCard />
                  <div>
                    <ReplayTourButton />
                    <AdminLink />
                  </div>
                </div>
              ),
            },
          ]}
        />

        {/* Unsaved edits (basic info, goals, preferences) — one save bar for all tabs. */}
        {dirty && (
          <div className="app-fixed-x fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+0.75rem)] lg:bottom-6 z-40 px-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="mx-auto max-w-4xl flex items-center justify-between gap-3 rounded-card border border-info-line bg-surface shadow-card px-4 py-3">
              <span className="text-small font-bold">عندك تغييرات غير محفوظة</span>
              <Button onClick={handleSave} className="rounded-control bg-brand hover:bg-brand-hover gap-2">
                <Save className="w-4 h-4" />
                حفظ التغييرات
              </Button>
            </div>
          </div>
        )}
      </main>

      {wizardMounted && <SetupWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />}
      {prefsMounted && (
        <SmartPreferencesModal
          isOpen={isPrefsOpen}
          onClose={() => setIsPrefsOpen(false)}
          preferences={draft.preferences}
          onPreferencesChange={handlePreferencesChange}
        />
      )}
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
        "flex items-center gap-3 p-4 rounded-card border",
        isReady
          ? "bg-success-soft border-success-line"
          : "bg-surface-sunken border-line",
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-control flex items-center justify-center shrink-0",
          isReady ? "bg-success-soft text-success-ink" : "bg-surface-sunken text-ink-muted",
        )}
      >
        {isReady ? <CheckCircle2 className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-small font-bold">{title}</span>
          {isReady && (
            <span className="text-caption px-1.5 py-0.5 rounded-full bg-success-soft text-success-ink border border-success-line">
              مُكتمل
            </span>
          )}
        </div>
        <div className="text-caption text-ink-muted truncate">{primaryLine}</div>
        {secondaryLine && (
          <div className="text-caption text-ink-muted truncate font-mono">{secondaryLine}</div>
        )}
      </div>
    </div>
  );
}
