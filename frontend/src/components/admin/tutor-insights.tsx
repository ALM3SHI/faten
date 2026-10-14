"use client";

import { useEffect, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";

interface LectureInsight {
  id: string;
  title: string;
  students: number;
  enough_data: boolean;
  note?: string;
  hardest_topics?: { topic: string; accuracy: number | null; answers: number; mastery_rate: number | null; avg_minutes: number | null; avg_rounds: number | null }[];
  most_missed_concepts?: { concept: string; accuracy: number; answers: number }[];
  question_flags?: { question: string; topic: string; accuracy: number | null; answers: number; flag: string; advice: string }[];
  strategies?: { strategy: string; rounds: number; improved_rate: number | null }[];
  retention?: Record<string, { answers: number; accuracy: number | null }>;
  finals?: Record<string, { attempts: number; avg_score: number | null }>;
}

const STRATEGY: Record<string, string> = {
  reexplain: "إعادة الشرح",
  worked_example: "أمثلة محلولة",
  contrast: "مثال مضاد/مقارنة",
  prerequisite: "الرجوع للمتطلب",
};

const p = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);

/**
 * Anonymous, aggregate results of the smart study mode (/api/admin/tutor-insights).
 * Nothing is shown for a lecture until enough students have used it.
 */
export function TutorInsights() {
  const [data, setData] = useState<{ min_students: number; lectures: LectureInsight[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/admin/tutor-insights")
      .then((d) => alive && setData({ min_students: d?.min_students ?? 10, lectures: Array.isArray(d?.lectures) ? d.lectures : [] }))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "تعذّر التحميل."));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card className="glass rounded-3xl p-6 space-y-4">
      <h2 className="text-lg font-black flex items-center gap-2">
        <GraduationCap className="w-5 h-5 text-uqu-accent" aria-hidden /> المذاكرة الذكية — مؤشرات جماعية مجهولة الهوية
      </h2>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      {!data && !error && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="جاري التحميل" />}
      {data && data.lectures.length === 0 && <p className="text-sm text-muted-foreground">لا توجد بيانات بعد.</p>}
      {data?.lectures.map((l) => (
        <div key={l.id} className="rounded-2xl border border-foreground/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold" dir="auto">{l.title}</h3>
            <span className="text-xs text-muted-foreground">{l.students} طالب</span>
          </div>
          {!l.enough_data ? (
            <p className="text-sm text-muted-foreground">{l.note}</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-bold mb-1">أصعب الموضوعات</div>
                <ul className="space-y-1">
                  {l.hardest_topics?.map((t) => (
                    <li key={t.topic}>
                      {t.topic}: دقة {p(t.accuracy)} · إتقان {p(t.mastery_rate)} · {t.avg_minutes ?? "—"} د · {t.avg_rounds ?? "—"} جولة علاج
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-bold mb-1">أكثر المفاهيم خطأً</div>
                <ul className="space-y-1">
                  {l.most_missed_concepts?.length ? l.most_missed_concepts.map((c) => <li key={c.concept}>{c.concept}: {p(c.accuracy)} ({c.answers} إجابة)</li>) : <li className="text-muted-foreground">لم تكتمل العينة لكل مفهوم.</li>}
                </ul>
              </div>
              <div>
                <div className="font-bold mb-1">أسئلة تحتاج مراجعة</div>
                <ul className="space-y-1.5">
                  {l.question_flags?.length ? l.question_flags.map((f, i) => (
                    <li key={i}><span className="font-bold">{f.flag}</span> ({p(f.accuracy)} من {f.answers}): <span dir="auto">{f.question}</span><div className="text-xs text-muted-foreground">{f.advice}</div></li>
                  )) : <li className="text-muted-foreground">لا توجد أسئلة شاذة الصعوبة.</li>}
                </ul>
              </div>
              <div>
                <div className="font-bold mb-1">أثر أساليب العلاج</div>
                <ul className="space-y-1">
                  {l.strategies?.map((s) => <li key={s.strategy}>{STRATEGY[s.strategy] ?? s.strategy}: تحسّن بعد {p(s.improved_rate)} من {s.rounds} جولة</li>)}
                </ul>
                <div className="font-bold mt-3 mb-1">الاحتفاظ بالمعلومة (المراجعات المتباعدة)</div>
                <ul className="space-y-1">
                  {Object.entries(l.retention ?? {}).map(([k, v]) => <li key={k}>بعد {k}: {p(v.accuracy)} ({v.answers})</li>)}
                </ul>
                <div className="font-bold mt-3 mb-1">الاختبار الشامل</div>
                <ul className="space-y-1">
                  {Object.entries(l.finals ?? {}).map(([k, v]) => <li key={k}>{k === "first" ? "المحاولة الأولى" : "المحاولات اللاحقة"}: {p(v.avg_score)} ({v.attempts})</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground leading-6">
        أرقام مجمّعة بلا هوية طالب. لا تُعرض نتائج محاضرة قبل {data?.min_students ?? 10} طلاب. انخفاض الدرجات لا يعني صعوبة المحتوى بالضرورة — راجع صياغة السؤال وتغطية الشرح أولاً.
      </p>
    </Card>
  );
}
