"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { useStudyStore, type StudyPack } from "@/store/studyStore";
import { Flashcards } from "@/components/study/flashcards";
import { StudyHome } from "@/components/study/study-home";

type Tab = "summary" | "terms" | "cards" | "quiz";

/**
 * «ذاكر محاضرة» — the study half of فطن. The home (components/study/
 * study-home.tsx) picks the file and the way to study it; a quick-review
 * pack opens here (summary · terms · cards · quiz), a guided lesson opens
 * in /tutor.
 */
export default function StudyPage() {
  const mounted = useHydrated();
  const packs = useStudyStore((s) => s.packs);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = packs.find((p) => p.id === activeId) ?? null;

  return (
    <div className="min-h-screen bg-background pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 max-w-3xl">
        <SectionTabs className="mb-6" />
        {active ? (
          <div className="space-y-5">
            <Button variant="ghost" onClick={() => setActiveId(null)} className="rounded-xl gap-1.5 -ms-2 text-muted-foreground hover:text-foreground">
              <ArrowRight className="w-4 h-4" aria-hidden />
              ملفاتك
            </Button>
            <PackView pack={active} />
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl md:text-3xl font-black">ذاكر محاضرة</h1>
              <p className="text-muted-foreground text-sm mt-1">ارفع الملف مرة وحدة، واختر: درس خطوة بخطوة أو مراجعة سريعة.</p>
            </div>
            {mounted ? <StudyHome onOpenPack={setActiveId} /> : null}
          </>
        )}
      </main>
    </div>
  );
}

function PackView({ pack }: { pack: StudyPack }) {
  const [tab, setTab] = useState<Tab>("summary");
  // Counts are hidden on phones so the four tabs fit on one line.
  const tabs: [Tab, string, number | null][] = [
    ["summary", "الملخص", null],
    ["terms", "المصطلحات", pack.key_terms.length],
    ["cards", "البطاقات", null],
    ["quiz", "الاختبار", pack.quiz.length],
  ];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black">{pack.title}</h2>
        <div className="text-xs text-muted-foreground mt-1">{pack.fileName}</div>
      </div>
      <div className="flex sm:w-fit gap-1 sm:gap-1.5 p-1 rounded-xl bg-foreground/5 border border-foreground/10" role="tablist">
        {tabs.map(([t, label, count]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-auto sm:flex-none px-2 sm:px-4 py-2 rounded-lg text-[13px] sm:text-sm font-bold whitespace-nowrap transition-colors",
              tab === t ? "bg-uqu-accent text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {count !== null && <span className="hidden sm:inline"> ({count})</span>}
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
