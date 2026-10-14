"use client";

/**
 * Academic advisor (/advisor) — «المرشد الأكاديمي».
 *
 * The plan, eligibility, scenarios and risks are computed on the server
 * from the official UQU study plan and the student's own record
 * (backend/services/advisor). This page shows them, lets the student set
 * their goals, and keeps every uncertainty visible.
 */

import { useCallback, useEffect, useState } from "react";
import { Compass, GraduationCap, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PanelTabs } from "@/components/ui/panel-tabs";
import { SetupForm } from "@/components/advisor/setup-form";
import { NextTermPanel } from "@/components/advisor/next-term";
import { ScenariosPanel } from "@/components/advisor/scenarios";
import { RisksPanel } from "@/components/advisor/risks";
import { AskAdvisor, InstructorsPanel, MajorsCompare, ScheduleChecker } from "@/components/advisor/tools";
import { FitAlert, StandingCard } from "@/components/advisor/evidence";
import { ApiError } from "@/lib/api";
import {
  CONFIDENCE_LABEL,
  STRATEGY_LABEL,
  VERIFICATION_LABEL,
  advisorApi,
  type AdvisorRun,
  type AdvisorSettings,
  type ProgramSummary,
} from "@/lib/advisor";
import { toast } from "@/lib/toast";

type Status = "loading" | "ready" | "error";

export default function AdvisorPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [settings, setSettings] = useState<AdvisorSettings>({});
  const [run, setRun] = useState<AdvisorRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const analyze = useCallback(async () => {
    setBusy(true);
    try {
      const r = await advisorApi.analyze();
      setRun(r);
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setEditing(true);
      toast.error(e instanceof ApiError ? e.message : "تعذّر حساب الخطة. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cat, s, latest] = await Promise.all([advisorApi.catalog(), advisorApi.settings(), advisorApi.latest()]);
        if (!alive) return;
        setPrograms(cat.programs);
        setSettings(s);
        setRun(latest.run);
        setEditing(!latest.run && !s.program_id);
        setStatus("ready");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async (next: AdvisorSettings) => {
    setBusy(true);
    try {
      setSettings(await advisorApi.saveSettings(next));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "تعذّر حفظ الإعدادات.");
      setBusy(false);
      return;
    }
    await analyze();
  };

  const detected = run?.program.source === "record" ? run.program.id : null;
  const planOk = run?.plan_applicable !== false;

  return (
    <div className="min-h-screen bg-background pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 max-w-4xl space-y-6">
        <SectionTabs />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black flex items-center gap-3">
              <Compass className="w-8 h-8 text-uqu-accent" aria-hidden />
              المرشد الأكاديمي
            </h1>
            <p className="text-muted-foreground text-sm mt-1 leading-6 max-w-2xl">
              ماذا تسجّل الفصل القادم، ومتى تتخرج، وما المخاطر — محسوبة من خطتك الرسمية وسجلك، مع توضيح كل ما هو غير مؤكد.
            </p>
          </div>
          {status === "ready" && (
            <div className="flex gap-2">
              {run && (
                <Button variant="outline" onClick={() => setEditing((v) => !v)} className="rounded-2xl h-11">
                  {editing ? "إخفاء الإعدادات" : "بياناتك وأهدافك"}
                </Button>
              )}
              <Button onClick={analyze} disabled={busy} className="rounded-2xl h-11 bg-uqu-accent hover:bg-uqu-accent/90 text-white gap-2">
                <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} aria-hidden />
                {run ? "أعد التحليل" : "حلّل وضعي"}
              </Button>
            </div>
          )}
        </div>

        {status === "loading" && <div className="h-48 rounded-[32px] bg-foreground/5 animate-pulse" aria-busy="true" />}
        {status === "error" && (
          <Card className="glass rounded-[24px] border-foreground/10 p-8 text-center text-sm">
            تعذّر تحميل المرشد. تأكد من اتصالك ثم حدّث الصفحة.
          </Card>
        )}

        {status === "ready" && editing && (
          <SetupForm programs={programs} initial={settings} detectedProgram={detected} saving={busy} onSave={save} />
        )}

        {status === "ready" && !run && !editing && (
          <Card className="glass rounded-[24px] border-foreground/10 p-8 text-center space-y-3">
            <GraduationCap className="w-12 h-12 mx-auto text-uqu-accent" aria-hidden />
            <p className="text-sm text-muted-foreground leading-7 max-w-md mx-auto">
              ارفع سجلك الأكاديمي من صفحة <Link href="/transcript" className="underline">السجل</Link> أولاً لنعرف مقرراتك المجتازة، ثم اضغط «حلّل وضعي».
            </p>
          </Card>
        )}

        {status === "ready" && run && (
          <>
            <Card className="glass rounded-[24px] border-foreground/10 p-5 md:p-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-4 text-center">
                <Stat label="التخصص" value={run.program.name} hint={`خطة ${VERIFICATION_LABEL[run.curriculum.verification]}`} />
                <Stat
                  label="المعدل"
                  value={run.profile.gpa !== null ? run.profile.gpa.toFixed(2) : "—"}
                  hint={run.profile.gpa_source === "record_field" ? "من بيانات سجلك المحفوظة" : "محسوب من مقررات سجلك"}
                />
                <Stat
                  label="مقررات الخطة المنجزة"
                  value={`${run.audit.percent_required_done}%`}
                  hint={`${run.audit.done_hours} من ${run.audit.required_hours} ساعة`}
                />
                <Stat label="درجة الثقة" value={CONFIDENCE_LABEL[run.confidence.level]} hint="حسب اكتمال البيانات" />
              </div>
              {planOk ? (
                <div className="rounded-2xl bg-uqu-accent/5 border border-uqu-accent/20 p-4 text-sm leading-7">
                  <p className="font-black">
                    المسار المقترح: {STRATEGY_LABEL[run.recommended_strategy]} — تخرج محسوب{" "}
                    {run.scenarios[run.recommended_strategy].graduation_label ?? "غير محدد"}
                  </p>
                  <p className="text-muted-foreground">{run.strategy_reason}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {run.load.basis}. الموعد ممكن رياضياً وفق الخطة المنشورة وليس مؤكداً للتسجيل.
                  </p>
                </div>
              ) : (
                <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm leading-7 font-bold">
                  {run.withheld_reason}
                </p>
              )}
              <FitAlert run={run} />
              <StandingCard run={run} />
              {run.summary && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-bold">الخلاصة في ست نقاط</summary>
                  <dl className="mt-2 space-y-2 leading-7">
                    <dt className="font-bold">ماذا أفعل؟</dt>
                    <dd>{run.summary.what}</dd>
                    <dt className="font-bold">لماذا؟</dt>
                    <dd>{run.summary.why.join(" ")}</dd>
                    <dt className="font-bold">ماذا لو اخترت غيره؟</dt>
                    <dd>{run.summary.alternatives.join(" ")}</dd>
                    <dt className="font-bold">الأثر على معدلي وتخرجي</dt>
                    <dd>{run.summary.effect.join(" ")}</dd>
                    <dt className="font-bold">ما غير المؤكد؟</dt>
                    <dd>{run.summary.uncertain.join(" ")}</dd>
                    <dt className="font-bold">الخطوة التالية</dt>
                    <dd>{run.summary.next_steps.join(" ")}</dd>
                  </dl>
                </details>
              )}
            </Card>

            <PanelTabs
              label="المرشد الأكاديمي"
              defaultValue="next"
              tabs={[
                { value: "next", label: "الفصل القادم", content: planOk ? <NextTermPanel run={run} /> : <Withheld text={run.withheld_reason} /> },
                { value: "paths", label: "مسارات التخرج", content: planOk ? <ScenariosPanel run={run} /> : <Withheld text={run.withheld_reason} /> },
                { value: "risks", label: "المخاطر والبيانات", content: <RisksPanel run={run} /> },
                { value: "check", label: "فحص جدول", content: <ScheduleChecker /> },
                { value: "majors", label: "مقارنة التخصصات", content: <MajorsCompare interests={settings.interests ?? []} /> },
                {
                  value: "instructors",
                  label: "المحاضرون",
                  content: <InstructorsPanel suggested={run.next_term.courses.filter((c) => !c.code.startsWith("ELECTIVE")).map((c) => c.code)} />,
                },
                { value: "ask", label: "اسأل المرشد", content: <AskAdvisor runId={run.run_id} /> },
              ]}
            />
            <p className="text-xs text-muted-foreground leading-6">
              فطن يساعدك على القرار ولا يسجّل عنك ولا يعدّل سجلك الرسمي. اعتمد التسجيل النهائي من نظام الجامعة وبعد مراجعة مرشدك الأكاديمي.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Withheld({ text }: { text?: string | null }) {
  return <p className="text-sm leading-7 text-muted-foreground">{text ?? "لا نستطيع اقتراح خطة لسجلك."}</p>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-black leading-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
