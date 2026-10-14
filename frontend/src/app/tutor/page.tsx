"use client";

/**
 * «المذاكرة الذكية الديناميكية» — a private tutor that runs one lecture:
 * upload → lecture map → topic by topic (goal, explanation, checks, adaptive
 * mastery quiz, targeted re-teaching) → final exam → review plan.
 *
 * The server keeps the learning state (backend/services/tutor). This page
 * renders it, sends one action at a time with the version it last saw, and
 * reloads if another tab or device moved the session on.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  FileUp,
  GraduationCap,
  ListTree,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { ChatModeSwitch } from "@/components/tutor/mode-switch";
import { StudentBlock, TutorBlock } from "@/components/tutor/blocks";
import { TopicPanel } from "@/components/tutor/topic-panel";
import { FocusTimer } from "@/components/tutor/focus-timer";
import { SlideViewer } from "@/components/tutor/slide-viewer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useHydrated } from "@/lib/use-hydrated";
import { ApiError } from "@/lib/api";
import { saveLectureFile } from "@/lib/lecture-files";
import { logPomodoroSession, todayYmd } from "@/lib/pomodoro";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_FOCUS,
  MAX_PDF_MB,
  STATUS_LABEL,
  clockSkew,
  deleteLecture,
  isConflict,
  lectureTerms,
  listLectures,
  loadSession,
  masteredCount,
  mergeTerms,
  nowWithSkew,
  pct,
  resetLecture,
  resumeFocus,
  saveFocus,
  sendStep,
  uploadLecture,
  type Action,
  type Confidence,
  type FocusState,
  type LectureSummary,
  type ReportReason,
  type Session,
  type TutorMessage,
} from "@/lib/tutor";
import { useProfileStore } from "@/store/profileStore";
import { useStudyStore } from "@/store/studyStore";

export default function TutorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <TutorContent />
    </Suspense>
  );
}

/** The session returned by an upload, handed to the session view without a refetch. */
let handoff: Session | null = null;

function TutorContent() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("lecture");
  return id ? (
    <StudySession key={id} id={id} startReview={params.get("review") === "1"} onExit={() => router.push("/tutor")} />
  ) : (
    <TutorHome
      onOpen={(s) => {
        handoff = s;
        router.push(`/tutor?lecture=${encodeURIComponent(s.lecture.id)}`);
      }}
      onResume={(lid) => router.push(`/tutor?lecture=${encodeURIComponent(lid)}`)}
      onReview={(lid) => router.push(`/tutor?lecture=${encodeURIComponent(lid)}&review=1`)}
    />
  );
}

// ══════════════════════════════════════════════════════════════════
//  Home: upload a lecture or continue one
// ══════════════════════════════════════════════════════════════════

const UPLOAD_STEPS = ["أرفع الملف…", "أقرأ الصفحات والجداول والصور…", "أرتّب المحاضرة في موضوعات…", "أجهّز خطة الدراسة…"];

function TutorHome({ onOpen, onResume, onReview }: { onOpen: (s: Session) => void; onResume: (id: string) => void; onReview: (id: string) => void }) {
  const mounted = useHydrated();
  const [lectures, setLectures] = useState<LectureSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [toDelete, setToDelete] = useState<LectureSummary | null>(null);
  const dueToday = (lectures ?? []).filter((l) => l.reviewDue > 0);

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
    if (!uploading) return;
    const t = window.setInterval(() => setStepIdx((i) => Math.min(UPLOAD_STEPS.length - 1, i + 1)), 6000);
    return () => window.clearInterval(t);
  }, [uploading]);

  const upload = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") return setError("اختر ملف PDF.");
    if (f.size > MAX_PDF_MB * 1024 * 1024) return setError(`حجم الملف أكبر من ${MAX_PDF_MB} ميجابايت.`);
    setUploading(true);
    setStepIdx(0);
    try {
      const session = await uploadLecture(f);
      await saveLectureFile(session.lecture.fileHash, f, f.name);
      if (session.reused === "mine") toast.info("هذه المحاضرة عندك من قبل — نكمل من حيث توقفت.");
      onOpen(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر تجهيز المحاضرة. حاول مرة أخرى.");
    } finally {
      setUploading(false);
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

  return (
    <div className="min-h-screen bg-background pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 max-w-3xl space-y-6">
        <ChatModeSwitch active="tutor" />
        <div>
          <h1 className="text-2xl md:text-3xl font-black flex items-center gap-3">
            <GraduationCap className="w-8 h-8 text-uqu-accent" aria-hidden />
            المذاكرة الذكية
          </h1>
          <p className="text-muted-foreground text-[14.5px] leading-7 mt-2">
            ارفع ملف المحاضرة وأنا أدرّسك إياها موضوعاً موضوعاً: أشرح من الشرائح نفسها، أتأكد من فهمك بأسئلة، أعالج أخطاءك،
            وما ننتقل للموضوع التالي إلا إذا أتقنت الحالي. وفي النهاية اختبار شامل وخطة مراجعة.
          </p>
        </div>

        {dueToday.length > 0 && (
          <section className="rounded-3xl border border-sky-500/30 bg-sky-500/[0.06] p-5 space-y-3" aria-label="مراجعة اليوم">
            <div className="flex items-center gap-2 font-black">
              <Brain className="w-5 h-5 text-sky-600" aria-hidden /> مراجعة اليوم
            </div>
            <p className="text-[13.5px] text-muted-foreground leading-7">
              موضوعات أتقنتها وحان موعد مراجعتها. سؤال واحد من كل موضوع — الاسترجاع في وقته هو ما يمنع النسيان.
            </p>
            <ul className="space-y-2">
              {dueToday.map((l) => (
                <li key={l.id} className="flex items-center gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-[14px] truncate" dir="auto">{l.title}</span>
                    <span className="block text-[12px] text-muted-foreground truncate" dir="auto">{(l.dueTopics ?? []).map((t) => t.title).join("، ")}</span>
                  </span>
                  <button type="button" onClick={() => onReview(l.id)} className="h-9 px-4 rounded-xl bg-sky-600 text-white text-[13px] font-bold shrink-0">
                    راجع ({l.reviewDue})
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <label
          htmlFor="tutor-file"
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!uploading) void upload(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-3 p-8 rounded-3xl border-2 border-dashed text-center transition-colors",
            uploading ? "border-uqu-accent/40 bg-uqu-accent/5 cursor-wait" : drag ? "border-uqu-accent bg-uqu-accent/10 cursor-copy" : "border-foreground/15 hover:border-uqu-accent/40 cursor-pointer",
          )}
          aria-busy={uploading}
        >
          {uploading ? <Loader2 className="w-10 h-10 text-uqu-accent animate-spin" aria-hidden /> : <FileUp className="w-10 h-10 text-uqu-accent" aria-hidden />}
          <div className="font-bold" aria-live="polite">{uploading ? UPLOAD_STEPS[stepIdx] : "ارفع ملف المحاضرة (PDF) أو اسحبه هنا"}</div>
          <div className="text-xs text-muted-foreground leading-6">
            {uploading
              ? "المحاضرات الطويلة أو المصوّرة قد تأخذ حتى دقيقتين. لا تغلق الصفحة."
              : `حتى ${MAX_PDF_MB} ميجابايت و120 صفحة · يقرأ العربي والإنجليزي والجداول والأكواد والشرائح المصوّرة · يستهلك 5 من رصيدك اليومي مرة واحدة`}
          </div>
          <input id="tutor-file" type="file" accept=".pdf,application/pdf" className="hidden" disabled={uploading} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        {error && <p className="text-sm text-rose-500 font-medium" role="alert">{error}</p>}

        <section className="space-y-3" aria-label="محاضراتك">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">محاضراتك</h2>
            {listError && (
              <button type="button" onClick={refresh} className="text-[13px] text-uqu-accent font-bold inline-flex items-center gap-1">
                <RefreshCw className="w-3.5 h-3.5" aria-hidden /> إعادة المحاولة
              </button>
            )}
          </div>
          {listError && <p className="text-sm text-rose-500">{listError}</p>}
          {lectures === null && !listError && (
            <div className="flex justify-center py-8 text-muted-foreground" role="status">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
              <span className="sr-only">جاري التحميل…</span>
            </div>
          )}
          {lectures?.length === 0 && <p className="text-sm text-muted-foreground">لم ترفع محاضرة بعد. ابدأ بأقرب محاضرة عندك اختبار فيها.</p>}
          {lectures?.map((l) => {
            const mastered = (l.counts.mastered ?? 0) + (l.counts.review_due ?? 0);
            const share = l.topics ? mastered / l.topics : 0;
            return (
              <div key={l.id} className="flex items-center gap-3 p-4 rounded-2xl border border-foreground/10 bg-card">
                <button type="button" onClick={() => onResume(l.id)} className="flex-1 min-w-0 text-right">
                  <div className="font-bold truncate" dir="auto">{l.title}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {l.fileName} · {l.topics} موضوعات · {l.pageCount} صفحة
                    {l.finalScore !== null && l.finalScore !== undefined ? ` · الاختبار الشامل ${pct(l.finalScore)}` : ""}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden" aria-hidden>
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.round(share * 100)}%` }} />
                    </div>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{mastered}/{l.topics} متقن</span>
                  </div>
                  {l.reviewDue > 0 && <div className="text-[11.5px] font-bold text-sky-600 mt-1">{l.reviewDue} موضوع للمراجعة اليوم</div>}
                </button>
                <button type="button" onClick={() => setToDelete(l)} className="p-2 rounded-lg text-muted-foreground hover:text-rose-500" aria-label={`حذف ${l.title}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </section>
      </main>
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

// ══════════════════════════════════════════════════════════════════
//  Session
// ══════════════════════════════════════════════════════════════════

const BUSY_LABEL: Record<string, string> = {
  next: "أجهّز الخطوة التالية…",
  answer: "أصحّح إجابتك…",
  reexplain: "أجهّز شرحاً بطريقة مختلفة…",
  ask: "أبحث في المحاضرة عن إجابة سؤالك…",
  final: "أجهّز الاختبار الشامل…",
  test_out: "أجهّز أسئلة الإتقان…",
  review: "أجهّز المراجعة…",
  report: "أستبعد السؤال…",
  goto: "أنقلك للموضوع…",
};

/** Actions that stay usable while a question is open. */
const WHILE_PENDING = new Set(["hint", "reexplain", "reveal", "save_cards"]);

function StudySession({ id, startReview, onExit }: { id: string; startReview?: boolean; onExit: () => void }) {
  const [session, setSession] = useState<Session | null>(() => (handoff && handoff.lecture.id === id ? handoff : null));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: { action: string; payload: Record<string, unknown> } | null } | null>(null);
  const [question, setQuestion] = useState("");
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [slide, setSlide] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [skew, setSkew] = useState(() => (handoff && handoff.lecture.id === id ? clockSkew(handoff.focus?.serverNow) : 0));
  const prefs = useProfileStore((s) => s.preferences);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await loadSession(id);
      setSession(s);
      setSkew(clockSkew(s.focus?.serverNow));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "تعذّر فتح الجلسة.");
    }
  }, [id]);

  useEffect(() => {
    if (handoff && handoff.lecture.id === id) {
      handoff = null;
      return;
    }
    let alive = true;
    loadSession(id)
      .then((s) => {
        if (!alive) return;
        setSession(s);
        setSkew(clockSkew(s.focus?.serverNow));
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : "تعذّر فتح الجلسة."));
    return () => {
      alive = false;
    };
  }, [id]);

  const messages = session?.messages ?? [];
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const act = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (!session || busy) return;
      setBusy(action);
      setFailed(null);
      try {
        const res = await sendStep(id, action, payload, session.state.version);
        setSession((s) => (s ? { ...s, state: res.state, messages: [...s.messages, ...res.messages] } : s));
      } catch (e) {
        if (isConflict(e)) {
          toast.info(e instanceof Error ? e.message : "تحدّثت الجلسة.");
          await load();
        } else {
          const message = e instanceof Error ? e.message : "حدث خطأ. حاول مرة أخرى.";
          // 4xx with a clear reason (e.g. "answer first") needs no retry button.
          const retryable = !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 429;
          setFailed({ message, retry: retryable ? { action, payload } : null });
        }
      } finally {
        setBusy(null);
      }
    },
    [session, busy, id, load],
  );

  // Opened from "مراجعة اليوم" (home card or the morning push): start the review once.
  const reviewStarted = useRef(false);
  useEffect(() => {
    if (!startReview || reviewStarted.current || !session || busy) return;
    const st = session.state;
    const can = st.reviewDue.length > 0 && st.phase !== "final" && st.phase !== "review" && (!st.pending || st.pending.context === "check");
    const t = window.setTimeout(() => {
      reviewStarted.current = true;
      if (can) void act("review");
    }, 0);
    return () => window.clearTimeout(t);
  }, [startReview, session, busy, act]);

  // ── review cards (existing flashcards with spaced repetition) ──
  const addPack = useStudyStore((s) => s.addPack);
  const packs = useStudyStore((s) => s.packs);
  const addTermsToPack = useStudyStore((s) => s.addTerms);
  const saveCards = useCallback(
    (topicId?: string) => {
      if (!session) return;
      const lec = session.lecture;
      const terms = lectureTerms(lec, topicId);
      if (!terms.length) return toast.info("لا توجد مصطلحات لهذا الموضوع.");
      const existing = packs.find((p) => p.lectureId === lec.id);
      if (existing) {
        const { added } = mergeTerms(existing.key_terms, terms);
        addTermsToPack(existing.id, terms);
        toast.success(added ? `أضفت ${added} بطاقة إلى «${existing.title}» في صفحة المذاكرة.` : "المصطلحات موجودة في بطاقاتك من قبل.");
      } else {
        addPack({
          fileName: lec.fileName,
          title: lec.title,
          summary: lec.topics.map((t) => `${t.title}${t.summary ? ` — ${t.summary}` : ""}`),
          key_terms: terms,
          quiz: [],
          lectureId: lec.id,
        });
        toast.success(`أضفت ${terms.length} بطاقة مراجعة — تجدها في «دراستي ← المذاكرة».`);
      }
    },
    [session, packs, addPack, addTermsToPack],
  );

  const onAction = (a: Action) => {
    if (a.id === "save_cards") return saveCards(session?.state.currentTopicId ?? undefined);
    void act(a.id, a.payload ?? {});
  };

  // ── focus timer ──
  const focus: FocusState = useMemo(() => {
    const f = session?.focus;
    if (f && f.mode !== undefined && f.focusMin) return f;
    return { ...DEFAULT_FOCUS, focusMin: prefs.pomodoroFocus || 25, breakMin: prefs.pomodoroShortBreak || 5 };
  }, [session?.focus, prefs.pomodoroFocus, prefs.pomodoroShortBreak]);

  const changeFocus = useCallback(
    (next: FocusState) => {
      setSession((s) => (s ? { ...s, focus: next } : s));
      // Saved right away (no debounce) so leaving the page never loses a pause/resume.
      saveFocus(id, next).catch(() => toast.warning("لم يُحفظ المؤقت على الخادم — سيعمل على هذا الجهاز."));
    },
    [id],
  );

  const focusDone = useCallback(
    (minutes: number) => {
      toast.success("أحسنت! انتهت جلسة تركيز — خذ 5 دقائق راحة.");
      logPomodoroSession({
        courseCode: "مذاكرة",
        courseName: session?.lecture.title ?? "المذاكرة الذكية",
        duration: minutes,
        type: "focus",
        date: todayYmd(),
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
    },
    [session?.lecture.title],
  );

  if (loadError) {
    return (
      <Shell>
        <div className="max-w-md mx-auto text-center space-y-4 pt-10">
          <p className="text-rose-500">{loadError}</p>
          <div className="flex justify-center gap-2">
            <button type="button" onClick={() => void load()} className="h-10 px-4 rounded-xl bg-uqu-accent text-white font-bold">إعادة المحاولة</button>
            <button type="button" onClick={onExit} className="h-10 px-4 rounded-xl border border-foreground/15 font-bold">محاضراتي</button>
          </div>
        </div>
      </Shell>
    );
  }
  if (!session) {
    return (
      <Shell>
        <div className="flex justify-center pt-20 text-muted-foreground" role="status">
          <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
          <span className="sr-only">جاري فتح الجلسة…</span>
        </div>
      </Shell>
    );
  }

  const { lecture, state } = session;
  const { mastered, total } = masteredCount(state);
  const pendingId = state.pending?.question.id ?? null;
  const lastTutor = [...messages].reverse().find((m) => m.role === "tutor");
  const actions = (lastTutor?.actions ?? []).filter((a) => !pendingId || WHILE_PENDING.has(a.id));
  const current = lecture.topics.find((t) => t.id === state.currentTopicId);
  const lastPendingSeq = pendingId ? lastSeqWithQuestion(messages, pendingId) : -1;

  return (
    <div className="h-[calc(100dvh-var(--bottom-nav-h))] flex flex-col bg-background" dir="rtl">
      <Navbar />
      <main className="flex-1 flex flex-col overflow-hidden w-full max-w-4xl mx-auto px-3 sm:px-4 pt-20">
        {/* Header: what matters now; details on demand */}
        <div className="shrink-0 space-y-2 pb-2 border-b border-foreground/10">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onExit} className="p-2 rounded-xl hover:bg-foreground/5" aria-label="محاضراتي">
              <ArrowRight className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="font-black text-[15px] sm:text-base truncate" dir="auto">{lecture.title}</h1>
              <p className="text-[12px] text-muted-foreground truncate">
                {state.phase === "final" && state.final
                  ? `الاختبار الشامل · ${state.final.index + 1} من ${state.final.total}`
                  : current
                    ? `${current.title} · ${STATUS_LABEL[state.topics[current.id]?.status ?? "in_progress"]}`
                    : state.phase === "done"
                      ? "أنهيت المحاضرة"
                      : "خريطة المحاضرة"}
              </p>
            </div>
            <FocusTimer focus={focus} skewMs={skew} onChange={changeFocus} onFocusCompleted={focusDone} />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setTopicsOpen(true)} className="flex-1 flex items-center gap-2 h-9 px-3 rounded-xl border border-foreground/10 hover:bg-foreground/5 text-[12.5px] font-bold" aria-label="الموضوعات والإتقان">
              <ListTree className="w-4 h-4 text-uqu-accent" aria-hidden />
              <span className="whitespace-nowrap">{mastered}/{total} متقن</span>
              <span className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden" aria-hidden>
                <span className="block h-full bg-emerald-500 transition-all" style={{ width: `${total ? (mastered / total) * 100 : 0}%` }} />
              </span>
              {state.reviewDue.length > 0 && <span className="text-sky-600 whitespace-nowrap">· {state.reviewDue.length} للمراجعة</span>}
            </button>
            <button type="button" onClick={() => setPaused(true)} className="h-9 px-3 rounded-xl border border-foreground/10 hover:bg-foreground/5 text-[12.5px] font-bold inline-flex items-center gap-1.5" aria-label="إيقاف مؤقت">
              <PauseCircle className="w-4 h-4" aria-hidden /> <span className="hidden sm:inline">إيقاف مؤقت</span>
            </button>
          </div>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-foreground/10" aria-live="polite">
          {messages.map((m) => (
            <MessageRow
              key={m.seq}
              m={m}
              pendingId={m.seq === lastPendingSeq ? pendingId : null}
              attempt={m.seq === lastPendingSeq ? (state.pending?.attempts ?? 0) : 0}
              busy={!!busy}
              onSlide={setSlide}
              onAnswer={(qid, ans) => void act("answer", { questionId: qid, ...ans })}
              onReport={(qid, reason) => void act("report", { questionId: qid, reason })}
            />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground px-2" role="status">
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-uqu-accent to-cyan-500 flex items-center justify-center animate-pulse">
                <Sparkles className="w-3.5 h-3.5 text-white" aria-hidden />
              </span>
              {BUSY_LABEL[busy] ?? "لحظة…"}
            </div>
          )}
          {failed && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-[13.5px]" role="alert">
              <span className="flex-1">{failed.message}</span>
              <button type="button" onClick={() => (failed.retry ? void act(failed.retry.action, failed.retry.payload) : setFailed(null))} className="h-8 px-3 rounded-lg bg-rose-600 text-white text-[12.5px] font-bold">
                {failed.retry ? "حاول مرة أخرى" : "حسناً"}
              </button>
            </div>
          )}
        </div>

        {/* Next steps + ask anything */}
        <div className="shrink-0 pb-4 pt-2 space-y-2 border-t border-foreground/10">
          {actions.length > 0 && !busy && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a, i) => (
                <button
                  key={a.id + i}
                  type="button"
                  onClick={() => onAction(a)}
                  className={cn(
                    "h-10 px-4 rounded-xl text-[13.5px] font-bold transition-colors",
                    i === 0 && !pendingId ? "bg-uqu-accent text-white hover:bg-uqu-accent/90" : "border border-foreground/15 hover:border-uqu-accent/40 hover:text-uqu-accent",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {state.phase === "done" && !busy && (
            <button type="button" onClick={() => setResetOpen(true)} className="text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <RotateCcw className="w-3.5 h-3.5" aria-hidden /> ابدأ المحاضرة من جديد
            </button>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!question.trim() || busy) return;
              const q = question;
              setQuestion("");
              void act("ask", { text: q });
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={1500}
              disabled={state.phase === "final"}
              placeholder={state.phase === "final" ? "الأسئلة معطّلة أثناء الاختبار الشامل" : "اسأل عن أي شيء في المحاضرة…"}
              aria-label="اسأل المعلم"
              className="flex-1 h-11 px-4 rounded-xl border border-foreground/15 bg-card text-[14px] focus:outline-none focus:border-uqu-accent/60 disabled:opacity-60"
            />
            <button type="submit" disabled={!question.trim() || !!busy} className="h-11 w-11 rounded-xl bg-uqu-accent text-white flex items-center justify-center disabled:opacity-50" aria-label="إرسال السؤال">
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </main>

      <TopicPanel
        open={topicsOpen}
        onClose={() => setTopicsOpen(false)}
        lecture={lecture}
        state={state}
        busy={!!busy}
        onGoto={(tid) => {
          setTopicsOpen(false);
          void act("goto", { topicId: tid });
        }}
        onReview={() => {
          setTopicsOpen(false);
          void act("review");
        }}
      />
      <SlideViewer lecture={lecture} page={slide} onPageChange={setSlide} onClose={() => setSlide(null)} />
      {paused && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="الجلسة متوقفة">
          <div className="max-w-sm text-center space-y-4">
            <PauseCircle className="w-12 h-12 text-uqu-accent mx-auto" aria-hidden />
            <h2 className="text-xl font-black">الجلسة متوقفة</h2>
            <p className="text-sm text-muted-foreground leading-7">تقدّمك محفوظ بعد كل خطوة. ترجع متى ما حبيت — من هذا الجهاز أو غيره — وتكمل من نفس النقطة.</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setPaused(false);
                  if (focus.mode !== "idle" && focus.pausedAt) changeFocus(resumeFocus(focus, nowWithSkew(skew)));
                }}
                className="h-11 rounded-xl bg-uqu-accent text-white font-bold inline-flex items-center justify-center gap-2"
              >
                <PlayCircle className="w-4 h-4" aria-hidden /> استكمال
              </button>
              <button type="button" onClick={onExit} className="h-11 rounded-xl border border-foreground/15 font-bold">
                الخروج إلى محاضراتي
              </button>
            </div>
          </div>
        </div>
      )}
      <PauseTimerWhenPaused paused={paused} focus={focus} skew={skew} onChange={changeFocus} />
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="البدء من جديد"
        description="سيُمسح تقدّمك في هذه المحاضرة (الإتقان والاختبارات) ونبدأ من خريطة المحاضرة. تحليل الملف يبقى ولا يُخصم رصيد."
        confirmLabel="ابدأ من جديد"
        destructive
        onConfirm={async () => {
          try {
            const s = await resetLecture(id);
            setSession(s);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "تعذّر البدء من جديد.");
          }
        }}
      />
    </div>
  );
}

/** Pausing the session also pauses a running focus timer. */
function PauseTimerWhenPaused({ paused, focus, skew, onChange }: { paused: boolean; focus: FocusState; skew: number; onChange: (f: FocusState) => void }) {
  const did = useRef(false);
  useEffect(() => {
    if (paused && !did.current && focus.mode !== "idle" && !focus.pausedAt) {
      did.current = true;
      onChange({ ...focus, pausedAt: new Date(Date.now() + skew).toISOString() });
    }
    if (!paused) did.current = false;
  }, [paused, focus, skew, onChange]);
  return null;
}

function lastSeqWithQuestion(messages: TutorMessage[], qid: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].blocks.some((b) => b.type === "question" && b.question?.id === qid)) return messages[i].seq;
  }
  return -1;
}

function MessageRow({
  m,
  pendingId,
  attempt,
  busy,
  onSlide,
  onAnswer,
  onReport,
}: {
  m: TutorMessage;
  pendingId: string | null;
  attempt: number;
  busy: boolean;
  onSlide: (p: number) => void;
  onAnswer: (qid: string, a: { choice?: number; text?: string; confidence?: Confidence }) => void;
  onReport: (qid: string, reason: ReportReason) => void;
}) {
  if (m.role === "student") {
    return (
      <div className="flex justify-start flex-row-reverse">
        <div className="max-w-[85%] space-y-1.5">{m.blocks.map((b, i) => <StudentBlock key={i} block={b} />)}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5 items-start">
      <span className="w-8 h-8 rounded-full bg-gradient-to-br from-uqu-accent to-cyan-500 flex items-center justify-center shrink-0 mt-0.5" aria-hidden>
        <BookOpenCheck className="w-4 h-4 text-white" />
      </span>
      <div className="flex-1 min-w-0 space-y-2.5">
        {m.blocks.map((b, i) => (
          <TutorBlock key={i} block={b} onSlide={onSlide} pendingId={pendingId} attempt={attempt} busy={busy} onAnswer={onAnswer} onReport={onReport} />
        ))}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4">{children}</main>
    </div>
  );
}
