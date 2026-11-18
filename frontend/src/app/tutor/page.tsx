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
import { Button } from "@/components/ds/button";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpenCheck,
  Loader2,
  PauseCircle,
  PlayCircle,
  Presentation,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { CourseBar, useFocusPage } from "@/components/tutor/course-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useBoardMode } from "@/lib/use-board-mode";
import { useOutlineOpen } from "@/lib/use-outline-open";
import { StudentBlock, TutorBlock } from "@/components/tutor/blocks";
import { TopicPanel } from "@/components/tutor/topic-panel";
import { FocusTimer } from "@/components/tutor/focus-timer";
import dynamic from "next/dynamic";
// the original-slide dialog loads when a slide is first opened
const SlideViewer = dynamic(() => import("@/components/tutor/slide-viewer").then((m) => m.SlideViewer), { ssr: false });
import { CourseOutline } from "@/components/tutor/course-outline";
import { LectureRef } from "@/components/tutor/lesson-visual";
import { AskBar } from "@/components/tutor/ask-bar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ApiError } from "@/lib/api";
import { logPomodoroSession, todayYmd } from "@/lib/pomodoro";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_FOCUS,
  STATUS_LABEL,
  clockSkew,
  isConflict,
  lectureTerms,
  loadSession,
  masteredCount,
  mergeTerms,
  nowWithSkew,
  resetLecture,
  resumeFocus,
  saveFocus,
  messagesOfSection,
  sectionOf,
  sendStep,
  tutorHandoff,
  type Action,
  type Confidence,
  type FocusState,
  type ReportReason,
  type Session,
  type TutorMessage,
} from "@/lib/tutor";
import { useProfileStore } from "@/store/profileStore";
import { useStudyStore } from "@/store/studyStore";

export default function TutorPage() {
  return (
    <Suspense fallback={<div className="ds-page min-h-screen bg-canvas text-ink" />}>
      <TutorContent />
    </Suspense>
  );
}

function TutorContent() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("lecture");
  // The tutor has no home of its own any more: uploading and the list of
  // lectures live in «ذاكر محاضرة» (/study), next to the quick review.
  useEffect(() => {
    if (!id) router.replace("/study");
  }, [id, router]);
  return id ? (
    <StudySession key={id} id={id} startReview={params.get("review") === "1"} linkTopic={params.get("topic")} onExit={() => router.push("/study")} />
  ) : (
    <div className="ds-page min-h-screen bg-canvas text-ink" aria-busy="true" />
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

function StudySession({ id, startReview, linkTopic, onExit }: { id: string; startReview?: boolean; linkTopic?: string | null; onExit: () => void }) {
  const [session, setSession] = useState<Session | null>(() => (tutorHandoff.session && tutorHandoff.session.lecture.id === id ? tutorHandoff.session : null));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: { action: string; payload: Record<string, unknown> } | null } | null>(null);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [board, setBoard] = useBoardMode();
  const [outlineOpen, setOutlineOpen] = useOutlineOpen();
  useFocusPage();
  const [slide, setSlide] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [skew, setSkew] = useState(() => (tutorHandoff.session && tutorHandoff.session.lecture.id === id ? clockSkew(tutorHandoff.session.focus?.serverNow) : 0));
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
    if (tutorHandoff.session && tutorHandoff.session.lecture.id === id) {
      tutorHandoff.session = null;
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

  const messages = useMemo(() => session?.messages ?? [], [session?.messages]);
  // One part of the lecture at a time: moving to another topic opens its own
  // page instead of piling its lesson under the last one's.
  const section = session ? sectionOf(session.state) : "";
  const shown = useMemo(() => messagesOfSection(messages, section), [messages, section]);
  const shownSection = useRef(section);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (shownSection.current !== section) {
      shownSection.current = section;
      el.scrollTo({ top: 0 });
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [shown.length, busy, section]);

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

  // ── a link per lesson: the address names the topic on screen ──
  // Opened with ?topic=t3 (a bookmark, a link from another device): go there
  // once, unless that would interrupt a test in progress.
  const linkHandled = useRef(!linkTopic);
  useEffect(() => {
    if (linkHandled.current || !session || busy) return;
    const st = session.state;
    const known = session.lecture.topics.some((t) => t.id === linkTopic);
    const inTest = st.phase === "final" || st.phase === "review" || (st.pending && st.pending.context !== "check");
    const t = window.setTimeout(() => {
      linkHandled.current = true;
      if (known && !inTest && !(st.phase === "topic" && st.currentTopicId === linkTopic)) void act("goto", { topicId: linkTopic });
    }, 0);
    return () => window.clearTimeout(t);
  }, [linkTopic, session, busy, act]);
  // …and follows the student: moving to another topic updates the address.
  const topicOnScreen = session?.state.phase === "topic" ? session.state.currentTopicId : null;
  useEffect(() => {
    if (!session || !linkHandled.current) return;
    const url = new URL(window.location.href);
    if ((url.searchParams.get("topic") ?? null) === topicOnScreen) return;
    if (topicOnScreen) url.searchParams.set("topic", topicOnScreen);
    else url.searchParams.delete("topic");
    url.searchParams.delete("review");
    window.history.replaceState(window.history.state, "", url);
  }, [session, topicOnScreen, busy]);

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
        toast.success(`أضفت ${terms.length} بطاقة مراجعة — تجدها في «ذاكر محاضرة ← ملفاتك».`);
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
          <p className="text-danger-ink">{loadError}</p>
          <div className="flex justify-center gap-2">
            <Button variant="bare" type="button" onClick={() => void load()} className="h-10 px-4 rounded-control bg-brand text-on-brand font-bold">إعادة المحاولة</Button>
            <Button variant="bare" type="button" onClick={onExit} className="h-10 px-4 rounded-control border border-line-strong font-bold">محاضراتي</Button>
          </div>
        </div>
      </Shell>
    );
  }
  if (!session) {
    return (
      <Shell>
        <div className="flex justify-center pt-20 text-ink-muted" role="status">
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
  const lectureRef = { id: lecture.id, fileHash: lecture.fileHash };

  const subtitle =
    state.phase === "final" && state.final
      ? `الاختبار الشامل · السؤال ${state.final.index + 1} من ${state.final.total}`
      : current
        ? `${current.title} · ${STATUS_LABEL[state.topics[current.id]?.status ?? "in_progress"]}`
        : state.phase === "done"
          ? "أنهيت المحاضرة"
          : "خريطة المحاضرة";
  const sessionTools = (
    <>
      <FocusTimer focus={focus} skewMs={skew} onChange={changeFocus} onFocusCompleted={focusDone} />
      <Button
        variant="quiet"
        size="sm"
        aria-pressed={board}
        onClick={() => setBoard(!board)}
        className="px-2 aria-pressed:bg-info-soft aria-pressed:text-info-ink sm:px-3"
      >
        <Presentation aria-hidden /> <span className="hidden sm:inline">السبورة</span>
        <span className="sr-only sm:hidden">وضع السبورة</span>
      </Button>
      <Button variant="quiet" size="sm" onClick={() => setPaused(true)} className="hidden sm:inline-flex">
        <PauseCircle aria-hidden /> إيقاف مؤقت
      </Button>
    </>
  );
  // phones: what the course bar has no room for lives in the course drawer
  const drawerTools = (
    <div className="flex flex-wrap items-center gap-2 sm:hidden">
      <Button variant="secondary" size="sm" onClick={() => { setTopicsOpen(false); setPaused(true); }}>
        <PauseCircle aria-hidden /> إيقاف مؤقت
      </Button>
      <ThemeToggle />
    </div>
  );

  return (
    // Focus mode: this page is the whole screen — no app sidebar, top bar or
    // tab bar (lib/nav.ts FOCUS_PATHS). One bar, the course menu, the lesson.
    <div className="h-[100dvh] flex flex-col bg-canvas" dir="rtl">
      <CourseBar
        title={lecture.title}
        subtitle={subtitle}
        progress={total ? mastered / total : 0}
        progressLabel={`أتقنت ${mastered} من ${total}`}
        onExit={onExit}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen(!outlineOpen)}
        onOpenTopics={() => setTopicsOpen(true)}
        tools={sessionTools}
      />
      <div className="flex flex-1 min-h-0">
        {outlineOpen && (
          <CourseOutline
            className="hidden lg:flex"
            lecture={lecture}
            state={state}
            busy={!!busy}
            onGoto={(tid) => void act("goto", { topicId: tid })}
            onFinal={() => void act("final")}
          />
        )}
        <LectureRef.Provider value={lectureRef}>
        <main className="flex-1 min-w-0 flex flex-col bg-surface">
        {/* Conversation: one comfortable reading column, centred */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-line"
          aria-live="polite"
        >
        <div
          className={cn(
            "mx-auto w-full max-w-3xl px-3 py-6 space-y-4 sm:px-6",
            board && "dark board-mode my-3 rounded-card border-4 border-board-frame bg-canvas sm:my-6",
          )}
        >
          {shown.map((m) => (
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
            <div className="flex items-center gap-2 text-small text-ink-muted px-2" role="status">
              <span className="w-7 h-7 rounded-full bg-brand text-on-brand flex items-center justify-center motion-safe:animate-pulse">
                <Sparkles className="w-3.5 h-3.5" aria-hidden />
              </span>
              {BUSY_LABEL[busy] ?? "لحظة…"}
            </div>
          )}
          {failed && (
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-small" role="alert">
              <span className="flex-1">{failed.message}</span>
              <Button variant="bare" type="button" onClick={() => (failed.retry ? void act(failed.retry.action, failed.retry.payload) : setFailed(null))} className="h-8 px-3 rounded-control border border-danger-line bg-danger-soft text-danger-ink text-small font-bold">
                {failed.retry ? "حاول مرة أخرى" : "حسناً"}
              </Button>
            </div>
          )}
        </div>
        </div>

        {/* Next steps + ask anything — aligned with the lesson column */}
        <div className="shrink-0 border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-3xl px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 space-y-2 sm:px-6">
          {actions.length > 0 && !busy && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a, i) => (
                <Button variant="bare"
                  key={a.id + i}
                  type="button"
                  onClick={() => onAction(a)}
                  className={cn(
                    "h-10 px-4 rounded-control text-small font-bold transition-colors",
                    i === 0 && !pendingId ? "bg-brand text-on-brand hover:bg-brand-hover" : "border border-line-strong hover:border-info-line hover:text-info-ink",
                  )}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          )}
          {state.phase === "done" && !busy && (
            <Button variant="bare" type="button" onClick={() => setResetOpen(true)} className="text-small text-ink-muted hover:text-ink inline-flex items-center gap-1">
              <RotateCcw className="w-3.5 h-3.5" aria-hidden /> ابدأ المحاضرة من جديد
            </Button>
          )}
          <AskBar
            scope={scrollRef}
            disabled={state.phase === "final"}
            busy={!!busy}
            onAsk={(text, quotes) => void act("ask", quotes.length ? { text, quotes } : { text })}
          />
        </div>
        </div>
        </main>
        </LectureRef.Provider>
      </div>

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
        tools={drawerTools}
      />
      {slide !== null && <SlideViewer lecture={lecture} page={slide} onPageChange={setSlide} onClose={() => setSlide(null)} />}
      {paused && (
        <div className="fixed inset-0 z-50 bg-surface flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="الجلسة متوقفة">
          <div className="max-w-sm text-center space-y-4">
            <PauseCircle className="w-12 h-12 text-info-ink mx-auto" aria-hidden />
            <h2 className="text-heading font-bold">الجلسة متوقفة</h2>
            <p className="text-small text-ink-muted leading-7">تقدّمك محفوظ بعد كل خطوة. ترجع متى ما حبيت — من هذا الجهاز أو غيره — وتكمل من نفس النقطة.</p>
            <div className="flex flex-col gap-2">
              <Button variant="bare"
                type="button"
                onClick={() => {
                  setPaused(false);
                  if (focus.mode !== "idle" && focus.pausedAt) changeFocus(resumeFocus(focus, nowWithSkew(skew)));
                }}
                className="h-11 rounded-control bg-brand text-on-brand font-bold inline-flex items-center justify-center gap-2"
              >
                <PlayCircle className="w-4 h-4" aria-hidden /> استكمال
              </Button>
              <Button variant="bare" type="button" onClick={onExit} className="h-11 rounded-control border border-line-strong font-bold">
                الخروج إلى محاضراتي
              </Button>
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
      <span className="w-8 h-8 rounded-full bg-brand text-on-brand flex items-center justify-center shrink-0 mt-0.5" aria-hidden>
        <BookOpenCheck className="w-4 h-4" />
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
    <div className="ds-page min-h-screen bg-canvas text-ink" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-24 px-4">{children}</main>
    </div>
  );
}
