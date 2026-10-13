"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Flag,
  Loader2,
  MessageSquareQuote,
  Search,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth-provider";
import { useTranscriptStore } from "@/store/transcriptStore";
import { api, fetchWithAuth } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ── Types mirrored from backend/services/community.py ────────────────
type RatingKey = "difficulty" | "workload" | "usefulness";
type Averages = Record<RatingKey, number | null>;

interface CourseSummary {
  code: string;
  name: string | null;
  count: number;
  averages: Averages;
  recommend_pct: number | null;
}

interface Review {
  id: string;
  ratings: Record<RatingKey, number>;
  recommend: boolean;
  tip: string;
  semester: string;
  status: "completed" | "current";
  updatedAt: string;
  mine: boolean;
}

interface CourseDetail extends CourseSummary {
  reviews: Review[];
  my_review: Review | null;
  can_review: boolean;
  my_course_name: string | null;
}

const RATING_LABELS: Record<RatingKey, { label: string; low: string; high: string }> = {
  difficulty: { label: "الصعوبة", low: "سهلة", high: "صعبة جدًا" },
  workload: { label: "الضغط والواجبات", low: "خفيف", high: "ثقيل" },
  usefulness: { label: "الفائدة", low: "قليلة", high: "عالية" },
};

export default function CommunityPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const completed = useTranscriptStore((s) => s.completedCourses);
  const current = useTranscriptStore((s) => s.currentCourses);

  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [selected, setSelected] = useState<CourseDetail | null>(null);
  const [loadingCourse, setLoadingCourse] = useState<string | null>(null);

  // Courses from the student's own record — the ones they can review.
  const myCourses = useMemo(() => {
    const seen = new Set<string>();
    return [...current, ...completed]
      .filter((c) => c?.code && !seen.has(c.code) && seen.add(c.code))
      .map((c) => ({ code: c.code, name: c.nameAr || c.name || c.code }));
  }, [completed, current]);

  const loadCourses = useCallback(async (q: string) => {
    try {
      const data = await api.get(`/api/community/courses?q=${encodeURIComponent(q)}`);
      setCourses(data.courses ?? []);
    } catch (e) {
      setCourses([]);
      toast.error(e instanceof Error ? e.message : "تعذّر تحميل المواد");
    }
  }, []);

  const openCourse = useCallback(async (code: string) => {
    setLoadingCourse(code);
    try {
      const data: CourseDetail = await api.get(`/api/community/courses/${encodeURIComponent(code)}`);
      setSelected(data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر فتح المادة");
    } finally {
      setLoadingCourse(null);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => loadCourses(query), 300);
    return () => clearTimeout(t);
  }, [user, query, loadCourses]);

  if (!authLoading && !user) {
    return (
      <Shell onBack={() => router.back()}>
        <Card className="glass border-foreground/10 rounded-3xl p-10 text-center space-y-4">
          <p className="text-lg font-bold">سجّل دخولك لتشاهد تقييمات الطلاب وتشارك تجربتك.</p>
          <Button onClick={() => router.push("/login")} className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90">
            تسجيل الدخول
          </Button>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell onBack={() => router.back()}>
      {selected ? (
        <CourseView
          course={selected}
          onBack={() => setSelected(null)}
          onChanged={(c) => {
            setSelected(c);
            loadCourses(query);
          }}
        />
      ) : (
        <div className="space-y-8">
          {myCourses.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-muted-foreground">موادك — قيّمها لتفيد زملاءك</h2>
              <div className="flex flex-wrap gap-2">
                {myCourses.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => openCourse(c.code)}
                    className="px-3 py-1.5 rounded-xl glass border border-foreground/10 text-sm hover:border-uqu-accent/40 transition-colors flex items-center gap-2"
                  >
                    {loadingCourse === c.code && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span className="font-mono text-xs text-uqu-accent">{c.code}</span>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="relative">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث برمز المادة أو اسمها…"
              className="h-11 pr-9 rounded-xl"
            />
          </div>

          {courses === null ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-uqu-accent" />
            </div>
          ) : courses.length === 0 ? (
            <Card className="glass border-dashed border-foreground/10 rounded-3xl p-10 text-center text-muted-foreground">
              {query ? "لا توجد تقييمات لهذه المادة بعد." : "لا توجد تقييمات بعد — كن أول من يقيّم مادة من موادك."}
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {courses.map((c) => (
                <Card
                  key={c.code}
                  onClick={() => openCourse(c.code)}
                  className="glass border-foreground/10 rounded-2xl p-5 cursor-pointer hover:border-uqu-accent/40 transition-colors space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-uqu-accent">{c.code}</p>
                      <h3 className="font-bold">{c.name || c.code}</h3>
                    </div>
                    <Badge variant="outline" className="shrink-0">{c.count} تقييم</Badge>
                  </div>
                  <RatingBars averages={c.averages} />
                  {c.recommend_pct !== null && (
                    <p className="text-xs text-muted-foreground">
                      <ThumbsUp className="w-3 h-3 inline ml-1 text-emerald-500" />
                      {c.recommend_pct}% ينصحون بها
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────────────────
function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="min-h-screen bg-background pb-20" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 max-w-5xl">
        <SectionTabs className="mb-6" />
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={onBack} className="rounded-xl glass border-foreground/10">
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-black flex items-center gap-3">
              <Users className="w-7 h-7 text-uqu-accent" />
              مجتمع فطن
            </h1>
            <p className="text-muted-foreground text-sm">
              تقييمات ونصائح من طلاب درسوا المادة فعلًا — قبل ما تسجّل، اعرف وش ينتظرك.
            </p>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

function RatingBars({ averages }: { averages: Averages }) {
  return (
    <div className="space-y-2">
      {(Object.keys(RATING_LABELS) as RatingKey[]).map((k) => {
        const v = averages[k];
        return (
          <div key={k} className="flex items-center gap-3 text-xs">
            <span className="w-28 text-muted-foreground">{RATING_LABELS[k].label}</span>
            <div className="flex-1 h-2 rounded-full bg-foreground/5 overflow-hidden">
              <div className="h-full rounded-full bg-uqu-accent" style={{ width: `${((v ?? 0) / 5) * 100}%` }} />
            </div>
            <span className="w-8 text-left font-mono">{v ?? "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Course detail + review form ───────────────────────────────────────
function CourseView({
  course,
  onBack,
  onChanged,
}: {
  course: CourseDetail;
  onBack: () => void;
  onChanged: (c: CourseDetail) => void;
}) {
  const others = course.reviews.filter((r) => !r.mine);
  return (
    <div className="space-y-6 animate-in fade-in">
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
        → كل المواد
      </button>
      <Card className="glass border-foreground/10 rounded-3xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm text-uqu-accent">{course.code}</p>
            <h2 className="text-2xl font-black">{course.name || course.my_course_name || course.code}</h2>
          </div>
          <Badge variant="outline">{course.count} تقييم</Badge>
        </div>
        {course.count > 0 ? (
          <>
            <RatingBars averages={course.averages} />
            {course.recommend_pct !== null && (
              <p className="text-sm">
                <ThumbsUp className="w-4 h-4 inline ml-1 text-emerald-500" />
                {course.recommend_pct}% من الطلاب ينصحون بها
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">لا توجد تقييمات بعد.</p>
        )}
      </Card>

      {course.can_review ? (
        <ReviewForm course={course} onChanged={onChanged} />
      ) : (
        <Card className="glass border-foreground/10 rounded-2xl p-4 text-sm text-muted-foreground">
          تقدر تقيّم هذه المادة بعد ما تكون في سجلك الأكاديمي — ارفع سجلك من صفحة السجل.
        </Card>
      )}

      <section className="space-y-3">
        <h3 className="font-bold flex items-center gap-2">
          <MessageSquareQuote className="w-5 h-5 text-uqu-cyan" />
          نصائح الطلاب
        </h3>
        {others.filter((r) => r.tip).length === 0 && (
          <p className="text-sm text-muted-foreground">لا توجد نصائح مكتوبة بعد.</p>
        )}
        {others
          .filter((r) => r.tip)
          .map((r) => (
            <ReviewCard key={r.id} review={r} code={course.code} />
          ))}
      </section>
    </div>
  );
}

function ReviewCard({ review, code }: { review: Review; code: string }) {
  const [reported, setReported] = useState(false);
  const report = async () => {
    try {
      await api.post(`/api/community/courses/${code}/reviews/${review.id}/report`, {});
      setReported(true);
      toast.success("شكرًا، وصلنا البلاغ.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر إرسال البلاغ");
    }
  };
  return (
    <Card className="glass border-foreground/10 rounded-2xl p-4 space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">
          {review.status === "completed" ? "درس المادة" : "يدرسها حاليًا"}
        </Badge>
        {review.semester && <span>{review.semester}</span>}
        {review.recommend ? (
          <ThumbsUp className="w-3 h-3 text-emerald-500" />
        ) : (
          <ThumbsDown className="w-3 h-3 text-rose-500" />
        )}
        <button
          onClick={report}
          disabled={reported}
          className="mr-auto flex items-center gap-1 hover:text-rose-500 disabled:opacity-50"
          title="إبلاغ عن محتوى غير لائق"
        >
          <Flag className="w-3 h-3" />
          {reported ? "تم الإبلاغ" : "إبلاغ"}
        </button>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line">{review.tip}</p>
    </Card>
  );
}

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} من 5`}>
          <Star
            className={cn("w-6 h-6 transition-colors", n <= value ? "fill-uqu-accent text-uqu-accent" : "text-foreground/20")}
          />
        </button>
      ))}
    </div>
  );
}

function ReviewForm({ course, onChanged }: { course: CourseDetail; onChanged: (c: CourseDetail) => void }) {
  const mine = course.my_review;
  const [ratings, setRatings] = useState<Record<RatingKey, number>>(
    mine?.ratings ?? { difficulty: 0, workload: 0, usefulness: 0 },
  );
  const [recommend, setRecommend] = useState<boolean | null>(mine ? mine.recommend : null);
  const [tip, setTip] = useState(mine?.tip ?? "");
  const [semester, setSemester] = useState(mine?.semester ?? "");
  const [saving, setSaving] = useState(false);

  const complete = Object.values(ratings).every((v) => v > 0) && recommend !== null;

  const save = async () => {
    if (!complete) return;
    setSaving(true);
    try {
      const data: CourseDetail = await fetchWithAuth(`/api/community/courses/${course.code}/review`, {
        method: "PUT",
        body: JSON.stringify({ ...ratings, recommend, tip, semester }),
      });
      onChanged(data);
      toast.success(mine ? "تم تحديث تقييمك" : "شكرًا! تقييمك يفيد زملاءك");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر حفظ التقييم");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const data: CourseDetail = await api.delete(`/api/community/courses/${course.code}/review`);
      onChanged(data);
      toast.success("تم حذف تقييمك");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الحذف");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="glass border-uqu-accent/20 rounded-3xl p-6 space-y-5">
      <h3 className="font-bold">{mine ? "تقييمك" : "قيّم المادة"}</h3>
      {(Object.keys(RATING_LABELS) as RatingKey[]).map((k) => (
        <div key={k} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{RATING_LABELS[k].label}</p>
            <p className="text-[11px] text-muted-foreground">
              1 = {RATING_LABELS[k].low} · 5 = {RATING_LABELS[k].high}
            </p>
          </div>
          <StarInput value={ratings[k]} onChange={(v) => setRatings((r) => ({ ...r, [k]: v }))} />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold ml-2">تنصح فيها؟</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRecommend(true)}
          className={cn("rounded-xl gap-1", recommend === true && "border-emerald-500 text-emerald-500")}
        >
          <ThumbsUp className="w-4 h-4" /> نعم
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRecommend(false)}
          className={cn("rounded-xl gap-1", recommend === false && "border-rose-500 text-rose-500")}
        >
          <ThumbsDown className="w-4 h-4" /> لا
        </Button>
      </div>
      <Input
        value={semester}
        onChange={(e) => setSemester(e.target.value)}
        placeholder="الفصل الذي درستها فيه (اختياري) — مثال: الأول 1447"
        maxLength={40}
        className="h-10 rounded-xl"
      />
      <div className="space-y-1">
        <textarea
          value={tip}
          onChange={(e) => setTip(e.target.value)}
          maxLength={600}
          rows={4}
          placeholder="نصيحة لمن سيدرسها: كيف تذاكرها؟ وش أهم شي فيها؟ (بدون أسماء أو روابط)"
          className="w-full rounded-xl border border-input bg-transparent p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <p className="text-[11px] text-muted-foreground text-left">{tip.length}/600</p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        يظهر تقييمك بدون اسمك. التقييم الذي يُبلَّغ عنه من 3 طلاب يُخفى تلقائيًا.
      </p>
      <div className="flex gap-2">
        <Button onClick={save} disabled={!complete || saving} className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90">
          {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
          {mine ? "تحديث التقييم" : "نشر التقييم"}
        </Button>
        {mine && (
          <Button variant="outline" onClick={remove} disabled={saving} className="rounded-xl text-rose-500 gap-1">
            <Trash2 className="w-4 h-4" /> حذف
          </Button>
        )}
      </div>
    </Card>
  );
}
