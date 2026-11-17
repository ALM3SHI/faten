"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRIORITY_LABEL,
  VERIFICATION_LABEL,
  parseCodes,
  termOptions,
  type AdvisorSettings,
  type Priority,
  type ProgramSummary,
} from "@/lib/advisor";

const FIELD = "h-11 rounded-control border border-line-strong bg-surface px-3 text-small w-full";

/** Everything here is the student's own input; nothing is guessed for them. */
export function SetupForm({
  programs,
  initial,
  detectedProgram,
  saving,
  onSave,
}: {
  programs: ProgramSummary[];
  initial: AdvisorSettings;
  detectedProgram: string | null;
  saving: boolean;
  onSave: (s: AdvisorSettings) => void;
}) {
  const [programId, setProgramId] = useState(initial.program_id ?? detectedProgram ?? "");
  const [priority, setPriority] = useState<Priority>(initial.priority ?? "balanced");
  const [maxLoad, setMaxLoad] = useState(initial.max_load ? String(initial.max_load) : "");
  const [summer, setSummer] = useState(!!initial.summer);
  const [target, setTarget] = useState(initial.target_term ?? "");
  const [gradGpa, setGradGpa] = useState(initial.program_grad_gpa ? String(initial.program_grad_gpa) : "");
  const [work, setWork] = useState(initial.weekly_work_hours ? String(initial.weekly_work_hours) : "");
  const [notOffered, setNotOffered] = useState((initial.unavailable ?? []).map((u) => u.code).join("، "));
  const [interests, setInterests] = useState((initial.interests ?? []).join("، "));

  const program = programs.find((p) => p.id === programId);
  const terms = termOptions(1448, 14, summer);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      program_id: programId || null,
      priority,
      max_load: maxLoad ? Number(maxLoad) : null,
      summer,
      target_term: target || null,
      program_grad_gpa: gradGpa ? Number(gradGpa) : null,
      weekly_work_hours: work ? Number(work) : null,
      unavailable: parseCodes(notOffered).map((code) => ({ code, term: "next" })),
      interests: interests.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
    });
  };

  return (
    <Card className="border border-line bg-surface shadow-card rounded-card p-5 md:p-6">
      <form onSubmit={submit} className="space-y-5" aria-labelledby="advisor-setup-title">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-info-ink" aria-hidden />
          <h2 id="advisor-setup-title" className="text-subheading font-bold">
            بياناتك وأهدافك
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="adv-program">التخصص</Label>
            <select id="adv-program" className={FIELD} value={programId} onChange={(e) => setProgramId(e.target.value)} required>
              <option value="">اختر تخصصك…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_ar} — {p.department_ar} ({p.curriculum.stated_total_hours ?? "؟"} ساعة)
                </option>
              ))}
            </select>
            {program && (
              <p className="text-caption text-ink-muted leading-6">
                الخطة {VERIFICATION_LABEL[program.curriculum.verification]} من{" "}
                <a href={program.curriculum.source_url} target="_blank" rel="noreferrer" className="underline">
                  موقع الجامعة
                </a>
                {program.curriculum.unlisted_hours > 0 && ` — ${program.curriculum.unlisted_hours} ساعة اختيارية لم تُنشر قائمتها.`}
                {!initial.program_id && detectedProgram === programId && " (اقترحناه من سجلك، أكّده.)"}
              </p>
            )}
          </div>

          <fieldset className="space-y-2 md:col-span-2">
            <legend className="text-small font-medium mb-2">أولويتك</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <label
                  key={p}
                  className={`cursor-pointer rounded-full border px-4 h-9 inline-flex items-center text-small font-bold ${
                    priority === p ? "border-info-line bg-info-soft text-info-ink" : "border-line-strong"
                  }`}
                >
                  <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="sr-only" />
                  {PRIORITY_LABEL[p]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="adv-load">أقصى عبء تتحمله في الفصل (ساعة)</Label>
            <Input id="adv-load" type="number" min={10} max={21} inputMode="numeric" placeholder="اتركه فارغاً = 18 (افتراض)"
              value={maxLoad} onChange={(e) => setMaxLoad(e.target.value)} className="h-11 rounded-control" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adv-target">متى تريد أن تتخرج؟ (اختياري)</Label>
            <select id="adv-target" className={FIELD} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">بدون هدف محدد</option>
              {terms.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3 text-small font-medium md:col-span-2">
            <input type="checkbox" checked={summer} onChange={(e) => setSummer(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            أقبل الدراسة في الفصل الصيفي (حدّه 10 ساعات بالنظام)
          </label>

          <div className="space-y-2">
            <Label htmlFor="adv-grad">معدل التخرج المطلوب لتخصصك (إن كنت تعرفه)</Label>
            <Input id="adv-grad" type="number" step="0.01" min={1} max={4} inputMode="decimal" placeholder="مثال: 2.00"
              value={gradGpa} onChange={(e) => setGradGpa(e.target.value)} className="h-11 rounded-control" />
            <p className="text-caption text-ink-muted">لم نجده منشوراً؛ بدونه لا نحكم بأنك في إنذار.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adv-work">ساعات عمل أو التزامات أسبوعية (اختياري)</Label>
            <Input id="adv-work" type="number" min={0} max={80} inputMode="numeric" value={work}
              onChange={(e) => setWork(e.target.value)} className="h-11 rounded-control" />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="adv-offered">مقررات تعرف أنها غير مطروحة الفصل القادم</Label>
            <Input id="adv-offered" placeholder="مثال: CS2105، MTH1441" value={notOffered}
              onChange={(e) => setNotOffered(e.target.value)} className="h-11 rounded-control" dir="ltr" />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="adv-interests">اهتماماتك (لمقارنة التخصصات)</Label>
            <Input id="adv-interests" placeholder="مثال: تعلم الآلة، الشبكات، تطوير الويب" value={interests}
              onChange={(e) => setInterests(e.target.value)} className="h-11 rounded-control" />
          </div>
        </div>

        <Button type="submit" disabled={saving || !programId} className="rounded-card h-11 bg-brand hover:bg-brand-hover text-on-brand px-6">
          {saving ? "جارٍ الحساب…" : "احفظ واحسب خطتي"}
        </Button>
      </form>
    </Card>
  );
}
