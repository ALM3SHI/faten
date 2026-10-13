"use client";

import { useMemo, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useStudyStore, type StudyPack } from "@/store/studyStore";
import { Flashcards, dueLabel } from "@/components/study/flashcards";

const MAX_MB = 10;
type Tab = "summary" | "terms" | "cards" | "quiz";

export default function StudyPage() {
  const router = useRouter();
  const mounted = useHydrated();

  const packs = useStudyStore((s) => s.packs);
  const addPack = useStudyStore((s) => s.addPack);
  const removePack = useStudyStore((s) => s.removePack);

  const [file, setFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState(10);
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = packs.find((p) => p.id === activeId) ?? null;

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) return setError("اختر ملف PDF.");
    if (f.size > MAX_MB * 1024 * 1024) return setError(`حجم الملف أكبر من ${MAX_MB} ميجابايت.`);
    setFile(f);
  };

  const generate = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("questions", String(questions));
    form.append("language", language);
    try {
      const data = await fetchWithAuth("/api/study/pdf", { method: "POST", body: form });
      const pack = addPack({ ...data, fileName: file.name });
      setActiveId(pack.id);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تجهيز المذاكرة، حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-28 md:pt-32 px-4 max-w-4xl">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => (active ? setActiveId(null) : router.back())} className="rounded-xl glass border-foreground/10" aria-label="رجوع">
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-black flex items-center gap-3">
              <BookOpenCheck className="w-7 h-7 text-uqu-accent" />
              المذاكرة من ملف المحاضرة
            </h1>
            <p className="text-muted-foreground text-sm">ارفع ملف المحاضرة، وخذ ملخصاً ومصطلحات واختباراً قصيراً منه.</p>
          </div>
        </div>

        {!mounted ? null : active ? (
          <PackView pack={active} />
        ) : (
          <div className="space-y-6">
            <Card className="glass border-foreground/10 rounded-[32px] p-6 md:p-8 space-y-5">
              <label
                htmlFor="study-file"
                className={cn(
                  "flex flex-col items-center justify-center gap-3 p-8 rounded-3xl border-2 border-dashed cursor-pointer transition-colors text-center",
                  file ? "border-uqu-accent/40 bg-uqu-accent/5" : "border-foreground/15 hover:border-uqu-accent/30",
                )}
              >
                {file ? <FileText className="w-10 h-10 text-uqu-accent" /> : <Upload className="w-10 h-10 text-uqu-accent" />}
                <div className="font-bold">{file ? file.name : "اختر ملف المحاضرة (PDF)"}</div>
                <div className="text-xs text-muted-foreground">الحد الأقصى {MAX_MB} ميجابايت — يقرأ النص العربي والإنجليزي والرسومات</div>
                <input id="study-file" type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              </label>

              <div className="flex flex-wrap gap-6">
                <Choice label="عدد الأسئلة" value={questions} options={[[5, "5"], [10, "10"], [15, "15"]]} onChange={setQuestions} />
                <Choice label="لغة الملخص والأسئلة" value={language} options={[["ar", "عربي"], ["en", "English"]]} onChange={setLanguage} />
              </div>

              {error && <p className="text-sm text-rose-500 font-medium" role="alert">{error}</p>}

              <div className="flex items-center gap-3 flex-wrap">
                <Button onClick={generate} disabled={!file || loading} className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white gap-2 h-11 px-6">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpenCheck className="w-4 h-4" />}
                  {loading ? "أقرأ الملف وأجهّز المذاكرة…" : "جهّز لي المذاكرة"}
                </Button>
                <span className="text-xs text-muted-foreground">يستهلك 5 من رصيدك اليومي{loading ? " — قد يأخذ حتى دقيقة" : ""}</span>
              </div>
            </Card>

            {packs.length > 0 && (
              <div className="space-y-3">
                <h2 className="font-bold">آخر ملفاتك</h2>
                {packs.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-4 rounded-2xl border border-foreground/10 bg-card">
                    <button type="button" onClick={() => setActiveId(p.id)} className="flex-1 min-w-0 text-right">
                      <div className="font-bold truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.fileName} · {p.quiz.length} سؤال · {new Date(p.createdAt).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn")}
                      </div>
                      {dueLabel(p) && <div className="text-xs font-bold text-uqu-accent mt-0.5">{dueLabel(p)}</div>}
                    </button>
                    <button type="button" onClick={() => removePack(p.id)} className="p-2 rounded-lg text-muted-foreground hover:text-rose-500" aria-label="حذف">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
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
    <div className="space-y-2">
      <div className="text-xs font-bold text-muted-foreground">{label}</div>
      <div className="flex gap-1.5 p-1 rounded-xl bg-foreground/5 border border-foreground/10 w-fit" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn("px-4 py-1.5 rounded-lg text-sm font-bold transition-colors", value === v ? "bg-uqu-accent text-white" : "text-muted-foreground hover:text-foreground")}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function PackView({ pack }: { pack: StudyPack }) {
  const [tab, setTab] = useState<Tab>("summary");
  const tabs: [Tab, string][] = [
    ["summary", "الملخص"],
    ["terms", `المصطلحات (${pack.key_terms.length})`],
    ["cards", "البطاقات"],
    ["quiz", `الاختبار (${pack.quiz.length})`],
  ];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black">{pack.title}</h2>
        <div className="text-xs text-muted-foreground mt-1">{pack.fileName}</div>
      </div>
      <div className="flex gap-1.5 p-1 rounded-xl bg-foreground/5 border border-foreground/10 w-fit" role="tablist">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("px-4 py-2 rounded-lg text-sm font-bold transition-colors", tab === t ? "bg-uqu-accent text-white" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <Card className="glass border-foreground/10 rounded-3xl p-6">
          <ul className="space-y-3 list-disc pr-5 leading-8">
            {pack.summary.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </Card>
      )}
      {tab === "terms" && (
        <div className="grid sm:grid-cols-2 gap-3">
          {pack.key_terms.map((t) => (
            <Card key={t.term} className="glass border-foreground/10 rounded-2xl p-4">
              <div className="font-bold text-uqu-accent mb-1" dir="auto">{t.term}</div>
              <div className="text-sm leading-7 text-foreground/90" dir="auto">{t.definition}</div>
            </Card>
          ))}
          {pack.key_terms.length === 0 && <p className="text-sm text-muted-foreground">لا توجد مصطلحات.</p>}
        </div>
      )}
      {tab === "cards" && <Flashcards key={pack.id} pack={pack} />}
      {tab === "quiz" && <Quiz key={pack.id} questions={pack.quiz} />}
    </div>
  );
}

function Quiz({ questions }: { questions: StudyPack["quiz"] }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const answered = Object.keys(answers).length;
  const correct = useMemo(
    () => questions.reduce((n, q, i) => n + (answers[i] === q.answer_index ? 1 : 0), 0),
    [answers, questions],
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-uqu-accent/5 border border-uqu-accent/20">
        <div className="font-bold">
          النتيجة: {correct} / {questions.length}
          {answered === questions.length && <span className="mr-2 text-sm text-muted-foreground">({Math.round((correct / questions.length) * 100)}%)</span>}
        </div>
        {answered > 0 && (
          <Button variant="ghost" size="sm" className="gap-1.5 rounded-xl" onClick={() => setAnswers({})}>
            <RotateCcw className="w-4 h-4" /> أعد الاختبار
          </Button>
        )}
      </div>
      {questions.map((q, i) => {
        const picked = answers[i];
        const done = picked !== undefined;
        return (
          <Card key={i} className="glass border-foreground/10 rounded-3xl p-5 space-y-3">
            <div className="font-bold leading-7" dir="auto">
              <span className="text-muted-foreground ml-1">{i + 1}.</span> {q.question}
            </div>
            <div className="grid gap-2">
              {q.options.map((opt, j) => {
                const isRight = j === q.answer_index;
                const isPicked = j === picked;
                return (
                  <button
                    key={j}
                    type="button"
                    disabled={done}
                    onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}
                    className={cn(
                      "flex items-center justify-between gap-3 text-right px-4 py-3 rounded-2xl border text-sm transition-colors",
                      !done && "border-foreground/10 hover:border-uqu-accent/40 bg-card",
                      done && isRight && "border-emerald-500/40 bg-emerald-500/10",
                      done && isPicked && !isRight && "border-rose-500/40 bg-rose-500/10",
                      done && !isRight && !isPicked && "border-foreground/10 opacity-60",
                    )}
                    dir="auto"
                  >
                    <span>{opt}</span>
                    {done && isRight && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                    {done && isPicked && !isRight && <XCircle className="w-4 h-4 text-rose-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {done && q.explanation && (
              <p className="text-sm leading-7 text-muted-foreground border-t border-foreground/10 pt-3" dir="auto">{q.explanation}</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
