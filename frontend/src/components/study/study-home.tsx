"use client";

/**
 * «ذاكر محاضرة» — one place to study a lecture file.
 *
 *   1. Review due today (spaced repetition from the tutor), when there is any.
 *   2. Pick the PDF once, then choose how to study it:
 *        • «درّسني خطوة بخطوة» — the guided tutor (/tutor?lecture=…)
 *        • «مراجعة سريعة»      — summary · terms · flashcards · quiz (a study pack)
 *   3. Everything uploaded before, in one list: tutor lectures with their
 *      mastery, and quick-review packs with cards due.
 */

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ds/states";
import { BlankLectureArt } from "@/components/sketch/notebook-art";
import { Button } from "@/components/ds/button";
import { useRouter } from "next/navigation";
import { BookOpenCheck, Brain, FileText, GraduationCap, Loader2, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { dueLabel } from "@/components/study/flashcards";
import { fetchWithAuth } from "@/lib/api";
import { saveLectureFile } from "@/lib/lecture-files";
import { toast } from "@/lib/toast";
import { MAX_PDF_MB, deleteLecture, listLectures, pct, tutorHandoff, uploadLecture, type LectureSummary } from "@/lib/tutor";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { useStudyStore } from "@/store/studyStore";

const TUTOR_STEPS = ["أرفع الملف…", "أقرأ الصفحات والجداول والصور…", "أرتّب المحاضرة في موضوعات…", "أجهّز خطة الدراسة…"];

export function StudyHome({ onOpenPack }: { onOpenPack: (id: string) => void }) {
  const router = useRouter();
  const mounted = useHydrated();

  const packs = useStudyStore((s) => s.packs);
  const addPack = useStudyStore((s) => s.addPack);
  const removePack = useStudyStore((s) => s.removePack);

  const [lectures, setLectures] = useState<LectureSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LectureSummary | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"tutor" | "quick" | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [questions, setQuestions] = useState(10);
  const [language, setLanguage] = useState<"ar" | "en">("ar");

  const refresh = useCallback(() => {
    setListError(null);
    listLectures()
      .then(setLectures)
      .catch((e) => setListError(e instanceof Error ? e.message : "تعذّر تحميل محاضراتك."));
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    listLectures()
      .then((l) => alive && setLectures(l))
      .catch((e) => alive && setListError(e instanceof Error ? e.message : "تعذّر تحميل محاضراتك."));
    return () => {
      alive = false;
    };
  }, [mounted]);

  useEffect(() => {
    if (busy !== "tutor") return;
    const t = window.setInterval(() => setStepIdx((i) => Math.min(TUTOR_STEPS.length - 1, i + 1)), 6000);
    return () => window.clearInterval(t);
  }, [busy]);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") return setError("اختر ملف PDF.");
    if (f.size > MAX_PDF_MB * 1024 * 1024) return setError(`حجم الملف أكبر من ${MAX_PDF_MB} ميجابايت.`);
    setFile(f);
  };

  const teach = async () => {
    if (!file) return;
    setError(null);
    setBusy("tutor");
    setStepIdx(0);
    try {
      const session = await uploadLecture(file);
      await saveLectureFile(session.lecture.fileHash, file, file.name);
      if (session.reused === "mine") toast.info("هذه المحاضرة عندك من قبل — نكمل من حيث توقفت.");
      tutorHandoff.session = session;
      router.push(`/tutor?lecture=${encodeURIComponent(session.lecture.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر تجهيز المحاضرة. حاول مرة أخرى.");
      setBusy(null);
    }
  };

  const quick = async () => {
    if (!file) return;
    setError(null);
    setBusy("quick");
    const form = new FormData();
    form.append("file", file);
    form.append("questions", String(questions));
    form.append("language", language);
    try {
      const data = await fetchWithAuth("/api/study/pdf", { method: "POST", body: form });
      const pack = addPack({ ...data, fileName: file.name });
      setFile(null);
      onOpenPack(pack.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر تجهيز المذاكرة، حاول مرة أخرى.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (l: LectureSummary) => {
    try {
      await deleteLecture(l.id);
      setLectures((xs) => (xs ?? []).filter((x) => x.id !== l.id));
      toast.success("حُذفت المحاضرة وتقدّمها.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الحذف.");
    }
  };

  const dueToday = (lectures ?? []).filter((l) => l.reviewDue > 0);
  const nothingYet = lectures !== null && lectures.length === 0 && packs.length === 0;

  return (
    <div className="space-y-6">
      {dueToday.length > 0 && (
        <section className="rounded-card border border-info-line bg-info-soft p-5 space-y-3" aria-label="مراجعة اليوم">
          <div className="flex items-center gap-2 font-bold">
            <Brain className="w-5 h-5 text-info-ink" aria-hidden /> مراجعة اليوم
          </div>
          <p className="text-small text-ink-muted leading-7">
            موضوعات أتقنتها وحان موعد مراجعتها — سؤال واحد من كل موضوع يكفي.
          </p>
          <ul className="space-y-2">
            {dueToday.map((l) => (
              <li key={l.id} className="flex items-center gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-body truncate" dir="auto">{l.title}</span>
                  <span className="block text-small text-ink-muted truncate" dir="auto">{(l.dueTopics ?? []).map((t) => t.title).join("، ")}</span>
                </span>
                <Button variant="bare"
                  type="button"
                  onClick={() => router.push(`/tutor?lecture=${encodeURIComponent(l.id)}&review=1`)}
                  className="h-9 px-4 rounded-control bg-brand text-on-brand text-small font-bold shrink-0"
                >
                  راجع ({l.reviewDue})
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 1 · the file */}
      <section aria-label="ملف المحاضرة" className="space-y-3">
        {!file ? (
          <label
            htmlFor="study-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 p-8 rounded-card border-2 border-dashed cursor-pointer transition-colors text-center",
              drag ? "border-info-line bg-info-soft" : "border-line-strong hover:border-info-line",
            )}
          >
            <Upload className="w-9 h-9 text-info-ink" aria-hidden />
            <span className="font-bold">اختر ملف المحاضرة (PDF)</span>
            <span className="text-caption text-ink-muted">أو اسحبه هنا · حتى {MAX_PDF_MB} ميجابايت · يقرأ العربي والإنجليزي والرسومات</span>
            <input id="study-file" type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-card border border-info-line bg-info-soft">
            <FileText className="w-6 h-6 text-info-ink shrink-0" aria-hidden />
            {/* Without ".pdf": mixed Arabic/Latin names otherwise render as "pdf.4". */}
            <span className="flex-1 min-w-0 font-bold truncate" dir="auto" title={file.name}>
              {file.name.replace(/\.pdf$/i, "")}
            </span>
            {!busy && (
              <Button variant="bare" type="button" onClick={() => setFile(null)} className="p-2 rounded-control text-ink-muted hover:text-ink" aria-label="اختر ملفاً آخر">
                <X className="w-4 h-4" aria-hidden />
              </Button>
            )}
          </div>
        )}

        {/* 2 · how to study it */}
        {file && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-card bg-brand text-on-brand shadow-card p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5" aria-hidden />
                <span className="font-bold">درّسني خطوة بخطوة</span>
              </div>
              <p className="text-small leading-6 text-white/90 flex-1">
                موضوعاً موضوعاً: أشرح من الشرائح، أتأكد من فهمك بأسئلة، أعالج أخطاءك، وفي النهاية اختبار شامل وخطة مراجعة.
              </p>
              <Button variant="bare"
                type="button"
                onClick={teach}
                disabled={!!busy}
                aria-busy={busy === "tutor"}
                className="h-11 rounded-control bg-white text-brand font-bold hover:bg-white/90 inline-flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {busy === "tutor" && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                <span aria-live="polite">{busy === "tutor" ? TUTOR_STEPS[stepIdx] : "ابدأ الدرس"}</span>
              </Button>
            </div>

            <div className="rounded-card border border-line p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <BookOpenCheck className="w-5 h-5 text-info-ink" aria-hidden />
                <span className="font-bold">مراجعة سريعة</span>
              </div>
              <p className="text-small leading-6 text-ink-muted">ملخص · مصطلحات · بطاقات مراجعة · اختبار قصير.</p>
              <div className="flex flex-wrap gap-3">
                <Choice label="عدد الأسئلة" value={questions} options={[[5, "5"], [10, "10"], [15, "15"]]} onChange={setQuestions} />
                <Choice label="اللغة" value={language} options={[["ar", "عربي"], ["en", "English"]]} onChange={setLanguage} />
              </div>
              <Button variant="bare"
                type="button"
                onClick={quick}
                disabled={!!busy}
                className="h-11 rounded-control bg-brand text-on-brand font-bold inline-flex items-center justify-center gap-2 hover:bg-brand-hover disabled:opacity-70"
              >
                {busy === "quick" && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                {busy === "quick" ? "أقرأ الملف وأجهّز المذاكرة…" : "جهّز لي المذاكرة"}
              </Button>
              <span className="text-caption text-ink-muted">يستهلك 5 من رصيدك اليومي{busy === "quick" ? " — قد يأخذ حتى دقيقة" : ""}</span>
            </div>
          </div>
        )}
        {error && <p className="text-small text-danger-ink font-medium" role="alert">{error}</p>}
      </section>

      {/* 3 · everything uploaded before */}
      <section aria-label="ملفاتك" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">ملفاتك</h2>
          {listError && (
            <Button variant="bare" type="button" onClick={refresh} className="text-small text-info-ink font-bold inline-flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden /> إعادة المحاولة
            </Button>
          )}
        </div>
        {listError && <p className="text-small text-danger-ink">{listError}</p>}
        {lectures === null && !listError && (
          <div className="flex justify-center py-6 text-ink-muted" role="status">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
            <span className="sr-only">جاري التحميل…</span>
          </div>
        )}
        {nothingYet && (
          <EmptyState art={<BlankLectureArt />} title="لم ترفع محاضرة بعد." text="ابدأ بأقرب محاضرة عندك اختبار فيها." className="py-8" />
        )}

        <ul className="space-y-2">
          {(lectures ?? []).map((l) => {
            const mastered = (l.counts.mastered ?? 0) + (l.counts.review_due ?? 0);
            const share = l.topics ? mastered / l.topics : 0;
            return (
              <li key={`l-${l.id}`} className="flex items-center gap-3 p-4 rounded-card border border-line bg-surface">
                <Button variant="bare" type="button" onClick={() => router.push(`/tutor?lecture=${encodeURIComponent(l.id)}`)} className="flex-1 min-w-0 text-right">
                  <span className="flex items-center gap-2">
                    <span className="font-bold truncate" dir="auto">{l.title}</span>
                    <span className="shrink-0 text-caption font-bold px-2 py-0.5 rounded-full bg-surface-sunken">درس</span>
                  </span>
                  <span className="block text-caption text-ink-muted truncate mt-0.5">
                    {l.topics} موضوعات · {l.pageCount} صفحة
                    {l.finalScore !== null && l.finalScore !== undefined ? ` · الاختبار الشامل ${pct(l.finalScore)}` : ""}
                  </span>
                  <span className="flex items-center gap-2 mt-2">
                    <span className="flex-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden" aria-hidden>
                      <span className="block h-full bg-success-ink" style={{ width: `${Math.round(share * 100)}%` }} />
                    </span>
                    <span className="text-caption text-ink-muted whitespace-nowrap">{mastered}/{l.topics} متقن</span>
                  </span>
                </Button>
                <Button variant="bare" type="button" onClick={() => setToDelete(l)} className="p-2 rounded-control text-ink-muted hover:text-danger-ink" aria-label={`حذف ${l.title}`}>
                  <Trash2 className="w-4 h-4" aria-hidden />
                </Button>
              </li>
            );
          })}
          {mounted &&
            packs.map((p) => (
              <li key={`p-${p.id}`} className="flex items-center gap-3 p-4 rounded-card border border-line bg-surface">
                <Button variant="bare" type="button" onClick={() => onOpenPack(p.id)} className="flex-1 min-w-0 text-right">
                  <span className="flex items-center gap-2">
                    <span className="font-bold truncate" dir="auto">{p.title}</span>
                    {/* Cards saved from a lesson come without a quiz: label them as cards. */}
                    <span className="shrink-0 text-caption font-bold px-2 py-0.5 rounded-full bg-info-soft text-info-ink">
                      {p.quiz.length > 0 ? "مراجعة سريعة" : "بطاقات"}
                    </span>
                  </span>
                  <span className="block text-caption text-ink-muted truncate mt-0.5">
                    {[p.quiz.length > 0 ? `${p.quiz.length} سؤال` : null, new Date(p.createdAt).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn")]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {dueLabel(p) && <span className="block text-caption font-bold text-info-ink mt-0.5">{dueLabel(p)}</span>}
                </Button>
                <Button variant="bare" type="button" onClick={() => removePack(p.id)} className="p-2 rounded-control text-ink-muted hover:text-danger-ink" aria-label="حذف">
                  <Trash2 className="w-4 h-4" aria-hidden />
                </Button>
              </li>
            ))}
        </ul>
      </section>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="حذف المحاضرة"
        description="سيُحذف تقدّمك وسجل المذاكرة لهذه المحاضرة. لا يمكن التراجع."
        confirmLabel="حذف"
        destructive
        onConfirm={() => toDelete && void remove(toDelete)}
      />
    </div>
  );
}

function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-caption font-bold text-ink-muted">{label}</div>
      <div className="flex gap-1 p-1 rounded-control bg-surface-sunken border border-line w-fit" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <Button variant="bare"
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn("px-3 py-1 rounded-control text-small font-bold transition-colors", value === v ? "bg-brand text-on-brand" : "text-ink-muted hover:text-ink")}
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  );
}
