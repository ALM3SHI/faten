"use client";

/**
 * Smaller advisor tools: schedule check, major comparison, instructor
 * evidence and follow-up questions. Each one calls its own endpoint.
 */

import { useState } from "react";
import { CheckCircle2, MessageCircleQuestion, Scale, Search, Send, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import {
  CONFIDENCE_LABEL,
  VERIFICATION_LABEL,
  advisorApi,
  parseCodes,
  type AskResult,
  type InstructorEvidence,
  type MajorsComparison,
  type ScheduleCheck,
} from "@/lib/advisor";
import { toast } from "@/lib/toast";

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "تعذّر إكمال الطلب. حاول مرة أخرى.");
const PRIMARY = "rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white gap-2";

export function ScheduleChecker() {
  const [text, setText] = useState("");
  const [summer, setSummer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScheduleCheck | null>(null);
  const codes = parseCodes(text);
  const check = async () => {
    setBusy(true);
    try {
      setResult(await advisorApi.validate(codes, summer));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-7">
        اكتب المقررات التي تنوي تسجيلها، ونفحصها مقابل المتطلبات السابقة وقواعد العبء في اللائحة قبل أن تعتمد التسجيل.
      </p>
      <div className="space-y-2">
        <Label htmlFor="sched-codes">رموز المقررات</Label>
        <Input id="sched-codes" dir="ltr" placeholder="CS2105, MTH1441, CEN2011" value={text} onChange={(e) => setText(e.target.value)} className="h-11 rounded-xl" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={summer} onChange={(e) => setSummer(e.target.checked)} className="size-4" />
        هذا جدول فصل صيفي
      </label>
      <Button disabled={busy || codes.length === 0} onClick={check} className={PRIMARY}>
        <Search className="w-4 h-4" aria-hidden />
        افحص ({codes.length})
      </Button>
      {result && (
        <div className="space-y-3" role="status">
          <p className={`font-black flex items-center gap-2 ${result.valid ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
            {result.valid ? <CheckCircle2 className="w-5 h-5" aria-hidden /> : <XCircle className="w-5 h-5" aria-hidden />}
            {result.valid ? `الجدول سليم (${result.credits} ساعة)` : `الجدول يخالف قواعد التسجيل (${result.credits} ساعة)`}
          </p>
          <ul className="space-y-2 text-sm">
            {result.courses.map((c) => (
              <li key={c.input} className={`rounded-xl border p-3 ${c.ok ? "border-foreground/10" : "border-rose-500/30 bg-rose-500/5"}`}>
                <span dir="ltr" className="font-bold">{c.code || c.input}</span>
                {c.problems.length ? ` — ${c.problems.join(" ")}` : " — مستوفٍ لمتطلباته."}
              </li>
            ))}
          </ul>
          {(result.notes ?? []).length > 0 && (
            <p className="text-sm text-muted-foreground">
              مقررات السنة التأهيلية تُسجَّل حسب المستوى دون النظر للمتطلبات السابقة (اللائحة).
            </p>
          )}
          {[...result.violations, ...result.warnings].map((v) => (
            <p key={v.rule + v.message} className="text-sm text-amber-800 dark:text-amber-300">
              {v.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function MajorsCompare({ interests }: { interests: string[] }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<MajorsComparison | null>(null);
  const load = async () => {
    setBusy(true);
    try {
      setData(await advisorApi.compare(interests));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-7">
        نقارن الخطط المنشورة بسجلك: ما اجتزته منها، ودرجاتك في مجالاتها الرئيسية، وأسرع مدة ممكنة لإكمالها.
        {interests.length === 0 && " أضف اهتماماتك من «بياناتك وأهدافك» لتحسين المقارنة."}
      </p>
      <Button onClick={load} disabled={busy} className={PRIMARY}>
        <Scale className="w-4 h-4" aria-hidden />
        {busy ? "جارٍ المقارنة…" : data ? "أعد المقارنة" : "قارن التخصصات"}
      </Button>
      {data && (
        <div className="space-y-3">
          <ul className="grid gap-3 md:grid-cols-2">
            {data.programs.map((p) => (
              <li key={p.program_id} className="rounded-2xl border border-foreground/10 p-4 space-y-2 text-sm">
                <p className="font-black">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.department} · {p.stated_total_hours ?? "؟"} ساعة · خطة {VERIFICATION_LABEL[p.curriculum_verification]}
                </p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">اجتزت منها</dt>
                  <dd className="font-bold">{p.overlap_hours} ساعة</dd>
                  <dt className="text-muted-foreground">أداؤك في مجالاتها</dt>
                  <dd className="font-bold">{p.related_performance !== null ? `${p.related_performance.toFixed(2)} / 4` : "غير معروف"}</dd>
                  <dt className="text-muted-foreground">أسرع إكمال</dt>
                  <dd className="font-bold">{p.fastest_terms ? `${p.fastest_terms} فصول (${p.fastest_graduation})` : "—"}</dd>
                </dl>
                <ul className="list-disc ps-5 leading-6">
                  {p.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {p.missing.map((m) => (
                    <li key={m} className="text-muted-foreground">
                      {m}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <details className="text-sm rounded-2xl border border-foreground/10 p-4">
            <summary className="cursor-pointer font-bold">شروط التحويل في اللائحة</summary>
            <ul className="mt-2 list-disc ps-5 space-y-1 leading-7">
              {data.transfer_rules.map((r) => (
                <li key={r.text}>{r.text}</li>
              ))}
            </ul>
          </details>
          <p className="text-xs text-muted-foreground leading-6">
            {data.disclaimer} {data.coverage_note}
          </p>
        </div>
      )}
    </div>
  );
}

export function InstructorsPanel({ suggested }: { suggested: string[] }) {
  const [code, setCode] = useState(suggested[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<InstructorEvidence | null>(null);
  const [form, setForm] = useState({ instructor: "", clarity: 0, organization: 0, fairness: 0, workload: 0, recommend: true });
  const normalized = parseCodes(code)[0] ?? "";

  const load = async (c = normalized) => {
    if (!c) return;
    setBusy(true);
    try {
      setData(await advisorApi.instructors(c));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setData(await advisorApi.reviewInstructor(normalized, form));
      toast.success("شكراً، أُضيف تقييمك.");
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const ratingFields: [keyof typeof form, string][] = [
    ["clarity", "وضوح الشرح"],
    ["organization", "التنظيم"],
    ["fairness", "عدالة التقييم"],
    ["workload", "العبء (1 خفيف – 5 ثقيل)"],
  ];
  const ready = form.instructor.trim().length >= 3 && ratingFields.every(([k]) => (form[k] as number) > 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-7">
        نعرض أدلة تقييم المحاضرين فقط حين تكفي: تقييمات موثقة من طلاب درسوا المقرر، مع مراعاة قلة العدد وقِدَم التقييم وتباين الآراء. لا نرشّح أحداً بلا أدلة كافية.
      </p>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-2">
          <Label htmlFor="inst-code">رمز المقرر</Label>
          <Input id="inst-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} className="h-11 rounded-xl w-40" />
        </div>
        <Button onClick={() => load()} disabled={busy || !normalized} className={PRIMARY}>
          <UserRound className="w-4 h-4" aria-hidden />
          اعرض الأدلة
        </Button>
      </div>
      {data && (
        <div className="space-y-3 text-sm">
          <p className="font-bold" role="status">{data.message}</p>
          {data.instructors.length > 0 && (
            <ul className="space-y-2">
              {data.instructors.map((i) => (
                <li key={i.instructor} className="rounded-xl border border-foreground/10 p-3">
                  <p className="font-bold">{i.instructor}</p>
                  <p className="text-muted-foreground">
                    {i.reviews} تقييم · ثقة {i.confidence === "insufficient" ? "غير كافية" : CONFIDENCE_LABEL[i.confidence]}
                    {i.quality_adjusted !== null && ` · تقييم معدَّل ${i.quality_adjusted}/5`}
                    {i.workload !== null && ` · العبء ${i.workload}/5`}
                  </p>
                  {i.notes.map((n) => (
                    <p key={n} className="text-amber-800 dark:text-amber-300">
                      {n}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <ul className="text-xs text-muted-foreground list-disc ps-5 leading-6">
            {data.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
            {data.providers.filter((p) => !p.available).map((p) => (
              <li key={p.name}>{p.reason}</li>
            ))}
          </ul>

          <details className="rounded-2xl border border-foreground/10 p-4">
            <summary className="cursor-pointer font-bold">قيّم محاضراً درّسك هذا المقرر</summary>
            <form onSubmit={submit} className="mt-3 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="inst-name">اسم المحاضر</Label>
                <Input id="inst-name" value={form.instructor} onChange={(e) => setForm({ ...form, instructor: e.target.value })} className="h-11 rounded-xl" />
              </div>
              {ratingFields.map(([k, label]) => (
                <fieldset key={k} className="flex flex-wrap items-center gap-2">
                  <legend className="text-sm w-40">{label}</legend>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className={`size-9 rounded-lg border inline-flex items-center justify-center cursor-pointer text-sm font-bold ${form[k] === n ? "bg-uqu-accent text-white border-uqu-accent" : "border-foreground/15"}`}>
                      <input type="radio" name={k} className="sr-only" checked={form[k] === n} onChange={() => setForm({ ...form, [k]: n })} />
                      {n}
                    </label>
                  ))}
                </fieldset>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.recommend} onChange={(e) => setForm({ ...form, recommend: e.target.checked })} className="size-4" />
                أنصح به
              </label>
              <Button type="submit" disabled={!ready} className={PRIMARY}>
                أرسل التقييم
              </Button>
              <p className="text-xs text-muted-foreground">يُقبل فقط إذا كان المقرر في سجلك الأكاديمي، ولا يظهر اسمك لأحد.</p>
            </form>
          </details>
        </div>
      )}
    </div>
  );
}

type Turn = { role: "user" | "assistant"; content: string };

export function AskAdvisor({ runId }: { runId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<{ q: string; a: AskResult }[]>([]);
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 2) return;
    setBusy(true);
    const history: Turn[] = turns.flatMap((t) => [
      { role: "user" as const, content: t.q },
      { role: "assistant" as const, content: t.a.source === "llm_validated" ? t.a.answer : t.a.summary.what },
    ]);
    try {
      const a = await advisorApi.ask(runId, q, history);
      setTurns((prev) => [...prev, { q, a }]);
      setQuestion("");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-7">
        اسأل عن خطتك («ليش هذا المقرر أولاً؟»، «وش يصير لو أجّلت الصيفي؟»). الإجابة مقيّدة بنتائج التحليل؛ وإن خرجت عنها نعرض لك الملخص المحسوب بدلها.
      </p>
      <ul className="space-y-3">
        {turns.map((t, i) => (
          <li key={i} className="space-y-2">
            <p className="text-sm font-bold">س: {t.q}</p>
            {t.a.source === "llm_validated" ? (
              <div className="rounded-2xl border border-foreground/10 p-3 text-sm leading-7 space-y-1">
                <p>{t.a.answer}</p>
                {t.a.points.length > 0 && (
                  <ul className="list-disc ps-5">
                    {t.a.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {t.a.next_step && <p className="font-bold">الخطوة التالية: {t.a.next_step}</p>}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-7 space-y-1">
                <p className="text-xs font-bold">{t.a.reason} — هذا الملخص المحسوب:</p>
                <p>{t.a.summary.what}</p>
                <ul className="list-disc ps-5">
                  {t.a.summary.why.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={ask} className="flex gap-2">
        <label htmlFor="adv-q" className="sr-only">
          سؤالك
        </label>
        <Input id="adv-q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="اكتب سؤالك عن خطتك…" className="h-11 rounded-xl" maxLength={800} />
        <Button type="submit" disabled={busy || question.trim().length < 2} className={PRIMARY} aria-label="أرسل السؤال">
          {busy ? <MessageCircleQuestion className="w-4 h-4 animate-pulse" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />}
        </Button>
      </form>
    </div>
  );
}
