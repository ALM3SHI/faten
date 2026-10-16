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
        <section className="rounded-3xl border border-sky-500/30 bg-sky-500/[0.06] p-5 space-y-3" aria-label="مراجعة اليوم">
          <div className="flex items-center gap-2 font-black">
            <Brain className="w-5 h-5 text-sky-600" aria-hidden /> مراجعة اليوم
          </div>
          <p className="text-[13.5px] text-muted-foreground leading-7">
            موضوعات أتقنتها وحان موعد مراجعتها — سؤال واحد من كل موضوع يكفي.
          </p>
          <ul className="space-y-2">
            {dueToday.map((l) => (
              <li key={l.id} className="flex items-center gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-[14px] truncate" dir="auto">{l.title}</span>
                  <span className="block text-[12px] text-muted-foreground truncate" dir="auto">{(l.dueTopics ?? []).map((t) => t.title).join("، ")}</span>
                </span>
                <button
                  type="button"
                  onClick={() => router.push(`/tutor?lecture=${encodeURIComponent(l.id)}&review=1`)}
                  className="h-9 px-4 rounded-xl bg-sky-600 text-white text-[13px] font-bold shrink-0"
                >
                  راجع ({l.reviewDue})
                </button>
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
              "flex flex-col items-center justify-center gap-2 p-8 rounded-3xl border-2 border-dashed cursor-pointer transition-colors text-center",
              drag ? "border-uqu-accent bg-uqu-accent/10" : "border-foreground/15 hover:border-uqu-accent/40",
            )}
          >
            <Upload className="w-9 h-9 text-uqu-accent" aria-hidden />
            <span className="font-black">اختر ملف المحاضرة (PDF)</span>
            <span className="text-xs text-muted-foreground">أو اسحبه هنا · حتى {MAX_PDF_MB} ميجابايت · يقرأ العربي والإنجليزي والرسومات</span>
            <input id="study-file" type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-2xl border border-uqu-accent/30 bg-uqu-accent/[0.05]">
            <FileText className="w-6 h-6 text-uqu-accent shrink-0" aria-hidden />
            {/* Without ".pdf": mixed Arabic/Latin names otherwise render as "pdf.4". */}
            <span className="flex-1 min-w-0 font-bold truncate" dir="auto" title={file.name}>
              {file.name.replace(/\.pdf$/i, "")}
            </span>
            {!busy && (
              <button type="button" onClick={() => setFile(null)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground" aria-label="اختر ملفاً آخر">
                <X className="w-4 h-4" aria-hidden />
              </button>
            )}
          </div>
        )}

        {/* 2 · how to study it */}
        {file && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl bg-foreground text-background p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5" aria-hidden />
                <span className="font-black">درّسني خطوة بخطوة</span>
              </div>
              <p className="text-[13px] leading-6 opacity-80 flex-1">
                موضوعاً موضوعاً: أشرح من الشرائح، أتأكد من فهمك بأسئلة، أعالج أخطاءك، وفي النهاية اختبار شامل وخطة مراجعة.
              </p>
              <button
                type="button"
                onClick={teach}
                disabled={!!busy}
                aria-busy={busy === "tutor"}
                className="h-11 rounded-xl bg-background text-foreground font-bold inline-flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {busy === "tutor" && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                <span aria-live="polite">{busy === "tutor" ? TUTOR_STEPS[stepIdx] : "ابدأ الدرس"}</span>
              </button>
            </div>

            <div className="rounded-3xl border border-foreground/10 p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <BookOpenCheck className="w-5 h-5 text-uqu-accent" aria-hidden />
                <span className="font-black">مراجعة سريعة</span>
              </div>
              <p className="text-[13px] leading-6 text-muted-foreground">ملخص · مصطلحات · بطاقات مراجعة · اختبار قصير.</p>
              <div className="flex flex-wrap gap-3">
                <Choice label="عدد الأسئلة" value={questions} options={[[5, "5"], [10, "10"], [15, "15"]]} onChange={setQuestions} />
                <Choice label="اللغة" value={language} options={[["ar", "عربي"], ["en", "English"]]} onChange={setLanguage} />
              </div>
              <button
                type="button"
                onClick={quick}
                disabled={!!busy}
                className="h-11 rounded-xl bg-uqu-accent text-white font-bold inline-flex items-center justify-center gap-2 hover:bg-uqu-accent/90 disabled:opacity-70"
              >
                {busy === "quick" && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                {busy === "quick" ? "أقرأ الملف وأجهّز المذاكرة…" : "جهّز لي المذاكرة"}
              </button>
              <span className="text-[11px] text-muted-foreground">يستهلك 5 من رصيدك اليومي{busy === "quick" ? " — قد يأخذ حتى دقيقة" : ""}</span>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-rose-500 font-medium" role="alert">{error}</p>}
      </section>

      {/* 3 · everything uploaded before */}
      <section aria-label="ملفاتك" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-black">ملفاتك</h2>
          {listError && (
            <button type="button" onClick={refresh} className="text-[13px] text-uqu-accent font-bold inline-flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden /> إعادة المحاولة
            </button>
          )}
        </div>
        {listError && <p className="text-sm text-rose-500">{listError}</p>}
        {lectures === null && !listError && (
          <div className="flex justify-center py-6 text-muted-foreground" role="status">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
            <span className="sr-only">جاري التحميل…</span>
          </div>
        )}
        {nothingYet && <p className="text-sm text-muted-foreground">لم ترفع محاضرة بعد. ابدأ بأقرب محاضرة عندك اختبار فيها.</p>}

        <ul className="space-y-2">
          {(lectures ?? []).map((l) => {
            const mastered = (l.counts.mastered ?? 0) + (l.counts.review_due ?? 0);
            const share = l.topics ? mastered / l.topics : 0;
            return (
              <li key={`l-${l.id}`} className="flex items-center gap-3 p-4 rounded-2xl border border-foreground/10 bg-card">
                <button type="button" onClick={() => router.push(`/tutor?lecture=${encodeURIComponent(l.id)}`)} className="flex-1 min-w-0 text-right">
                  <span className="flex items-center gap-2">
                    <span className="font-bold truncate" dir="auto">{l.title}</span>
                    <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-foreground/10">درس</span>
                  </span>
                  <span className="block text-xs text-muted-foreground truncate mt-0.5">
                    {l.topics} موضوعات · {l.pageCount} صفحة
                    {l.finalScore !== null && l.finalScore !== undefined ? ` · الاختبار الشامل ${pct(l.finalScore)}` : ""}
                  </span>
                  <span className="flex items-center gap-2 mt-2">
                    <span className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden" aria-hidden>
                      <span className="block h-full bg-emerald-500" style={{ width: `${Math.round(share * 100)}%` }} />
                    </span>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{mastered}/{l.topics} متقن</span>
                  </span>
                </button>
                <button type="button" onClick={() => setToDelete(l)} className="p-2 rounded-lg text-muted-foreground hover:text-rose-500" aria-label={`حذف ${l.title}`}>
                  <Trash2 className="w-4 h-4" aria-hidden />
                </button>
              </li>
            );
          })}
          {mounted &&
            packs.map((p) => (
              <li key={`p-${p.id}`} className="flex items-center gap-3 p-4 rounded-2xl border border-foreground/10 bg-card">
                <button type="button" onClick={() => onOpenPack(p.id)} className="flex-1 min-w-0 text-right">
                  <span className="flex items-center gap-2">
                    <span className="font-bold truncate" dir="auto">{p.title}</span>
                    {/* Cards saved from a lesson come without a quiz: label them as cards. */}
                    <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-uqu-accent/10 text-uqu-accent">
                      {p.quiz.length > 0 ? "مراجعة سريعة" : "بطاقات"}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground truncate mt-0.5">
                    {[p.quiz.length > 0 ? `${p.quiz.length} سؤال` : null, new Date(p.createdAt).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn")]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {dueLabel(p) && <span className="block text-xs font-bold text-uqu-accent mt-0.5">{dueLabel(p)}</span>}
                </button>
                <button type="button" onClick={() => removePack(p.id)} className="p-2 rounded-lg text-muted-foreground hover:text-rose-500" aria-label="حذف">
                  <Trash2 className="w-4 h-4" aria-hidden />
                </button>
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
      <div className="text-[11px] font-bold text-muted-foreground">{label}</div>
      <div className="flex gap-1 p-1 rounded-xl bg-foreground/5 border border-foreground/10 w-fit" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn("px-3 py-1 rounded-lg text-[13px] font-bold transition-colors", value === v ? "bg-uqu-accent text-white" : "text-muted-foreground hover:text-foreground")}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
