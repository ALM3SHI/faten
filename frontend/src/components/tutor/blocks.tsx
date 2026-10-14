"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Flag,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  Lightbulb,
  ListChecks,
  Loader2,
  Route,
  Stethoscope,
  Target,
  Trophy,
  XCircle,
} from "lucide-react";
import { BotMarkdown } from "@/components/bot-markdown";
import { cn } from "@/lib/utils";
import { CONTEXT_LABEL, pct, type Block, type Confidence, type QuestionBlock, type ReportReason } from "@/lib/tutor";

interface Common {
  onSlide: (page: number) => void;
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-foreground/10 bg-card px-4 py-3.5 text-[15px] leading-relaxed", className)}>{children}</div>;
}

function PageChips({ pages, onSlide }: { pages?: number[]; onSlide: (p: number) => void }) {
  if (!pages?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-3" aria-label="الشرائح المرتبطة">
      {pages.slice(0, 8).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSlide(p)}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-foreground/10 text-[12px] font-bold text-muted-foreground hover:text-uqu-accent hover:border-uqu-accent/40 transition-colors"
        >
          <FileText className="w-3 h-3" aria-hidden /> شريحة {p}
        </button>
      ))}
    </div>
  );
}

function Meter({ value, label }: { value: number | null; label: string }) {
  const v = value ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[12px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-bold text-foreground">{pct(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden" aria-hidden>
        <div className={cn("h-full rounded-full", v >= 0.8 ? "bg-emerald-500" : v >= 0.5 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.round(v * 100)}%` }} />
      </div>
    </div>
  );
}

// ── Tutor blocks ─────────────────────────────────────────────────

export function TutorBlock({ block, ...c }: { block: Block } & Common & QuestionProps) {
  switch (block.type) {
    case "text":
      return <Card><BotMarkdown content={block.md} onSlide={c.onSlide} /></Card>;
    case "notice":
      return (
        <div className={cn("flex gap-2.5 rounded-2xl border px-4 py-3 text-[13.5px] leading-7", block.tone === "warn" ? "border-amber-500/40 bg-amber-500/10" : "border-sky-500/30 bg-sky-500/10")} role="note">
          {block.tone === "warn" ? <AlertTriangle className="w-4 h-4 mt-1.5 shrink-0 text-amber-600" aria-hidden /> : <Info className="w-4 h-4 mt-1.5 shrink-0 text-sky-600" aria-hidden />}
          <span>{block.md}</span>
        </div>
      );
    case "map":
      return <MapCard block={block} {...c} />;
    case "goal":
      return <GoalCard block={block} {...c} />;
    case "lesson":
      return (
        <Card className={cn(block.remedial && "border-amber-500/30", block.alternative && "border-sky-500/30")}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-black text-[15px]">{block.title}</h3>
            {typeof block.segment === "number" && block.total ? (
              <span className="text-[11px] font-bold text-muted-foreground whitespace-nowrap">الجزء {block.segment + 1} من {block.total}</span>
            ) : null}
          </div>
          <BotMarkdown content={block.md} onSlide={c.onSlide} />
          <PageChips pages={block.pages} onSlide={c.onSlide} />
        </Card>
      );
    case "question":
      // A new attempt on the same question starts with a clean selection.
      return <QuestionCard key={`${block.question?.id}:${c.attempt ?? 0}`} block={block as QuestionBlock} {...c} />;
    case "feedback":
      return <FeedbackCard block={block} {...c} />;
    case "hint":
      return (
        <div className="flex gap-2.5 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[14px] leading-7">
          <Lightbulb className="w-4 h-4 mt-1.5 shrink-0 text-amber-500" aria-hidden />
          <div>
            {block.index ? <span className="text-[11px] font-bold text-muted-foreground block">تلميح {block.index} من {block.total}</span> : null}
            <BotMarkdown content={block.md} onSlide={c.onSlide} />
          </div>
        </div>
      );
    case "answer_text":
      return (
        <Card>
          {block.inLecture === false && <span className="inline-block mb-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">خارج المحاضرة</span>}
          <BotMarkdown content={block.md} onSlide={c.onSlide} />
          <PageChips pages={block.pages} onSlide={c.onSlide} />
        </Card>
      );
    case "diagnosis":
      return <DiagnosisCard block={block} />;
    case "topic_summary":
      return <TopicSummaryCard block={block} {...c} />;
    case "final_report":
      return <FinalReport block={block} {...c} />;
    default:
      return null;
  }
}

function MapCard({ block, onSlide }: { block: Block } & Common) {
  return (
    <Card>
      <div className="flex items-start gap-3 mb-3">
        <Route className="w-5 h-5 text-uqu-accent mt-1 shrink-0" aria-hidden />
        <div>
          <h3 className="font-black">خريطة المحاضرة: {block.title}</h3>
          {block.overview && <p className="text-[13.5px] text-muted-foreground leading-7 mt-1">{block.overview}</p>}
        </div>
      </div>
      <ol className="space-y-2">
        {(block.topics as { id: string; title: string; pages: number[]; est_minutes: number; importance: number }[]).map((t, i) => (
          <li key={t.id} className="flex items-center gap-3 rounded-xl border border-foreground/10 px-3 py-2">
            <span className="w-6 h-6 rounded-full bg-uqu-accent/10 text-uqu-accent text-[12px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="flex-1 min-w-0 text-[14px] font-bold truncate" dir="auto">{t.title}</span>
            {t.importance >= 3 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-uqu-accent/10 text-uqu-accent shrink-0">محوري</span>}
            <button type="button" onClick={() => onSlide(t.pages[0])} className="text-[11px] text-muted-foreground hover:text-uqu-accent shrink-0">
              ص {t.pages[0]}–{t.pages[1]}
            </button>
            <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">~{t.est_minutes} د</span>
          </li>
        ))}
      </ol>
      {block.estMinutes ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground mt-3">
          <Clock className="w-3.5 h-3.5" aria-hidden /> الوقت التقديري للمحاضرة كاملة: نحو {Math.round(block.estMinutes / 5) * 5} دقيقة — يمكنك تقسيمها على أكثر من جلسة.
        </p>
      ) : null}
    </Card>
  );
}

function GoalCard({ block, onSlide }: { block: Block } & Common) {
  return (
    <Card className="border-uqu-accent/30 bg-uqu-accent/[0.04]">
      <div className="text-[11px] font-bold text-uqu-accent mb-1">الموضوع {block.index} من {block.total}</div>
      <h3 className="text-lg font-black mb-2" dir="auto">{block.title}</h3>
      {block.why && <p className="text-[14px] leading-7 mb-3">{block.why}</p>}
      {block.objectives?.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 text-[12.5px] font-bold mb-1.5"><Target className="w-3.5 h-3.5 text-uqu-accent" aria-hidden /> بنهاية هذا الموضوع ستكون قادراً أن:</div>
          <ul className="list-disc pr-5 space-y-1 text-[14px]">
            {(block.objectives as string[]).map((o) => <li key={o}>{o}</li>)}
          </ul>
        </div>
      )}
      <div className="text-[13px] text-muted-foreground leading-6">
        <span className="font-bold text-foreground">تحتاج قبله: </span>{block.prerequisites}
        {block.weakPrerequisites?.length > 0 && (
          <span className="block text-amber-700 dark:text-amber-300 mt-1">لم تتقن بعد: {(block.weakPrerequisites as string[]).join("، ")} — سأرجع لها إن احتجنا.</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden /> ~{block.estMinutes} دقيقة</span>
        <button type="button" onClick={() => onSlide(block.pages[0])} className="hover:text-uqu-accent font-bold">الشرائح {block.pages[0]}–{block.pages[1]}</button>
      </div>
    </Card>
  );
}

// ── Questions ───────────────────────────────────────────────────

export interface QuestionProps {
  /** id of the question that is still open (only that card is interactive) */
  pendingId?: string | null;
  busy?: boolean;
  /** attempts already made on the open question */
  attempt?: number;
  onAnswer?: (questionId: string, answer: { choice?: number; text?: string; confidence?: Confidence }) => void;
  /** flag a question shown to the student (wrong key, unclear, not from the lecture) */
  onReport?: (questionId: string, reason: ReportReason) => void;
}

/** One tap with every answer: how sure the student is. */
const CONFIDENCE_BUTTONS: { value: Confidence; label: string; hint: string }[] = [
  { value: "sure", label: "متأكد", hint: "أعرف الإجابة" },
  { value: "think", label: "أظن", hint: "غالباً صحيحة" },
  { value: "guess", label: "أخمّن", hint: "لست متأكداً" },
];

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "wrong_key", label: "الإجابة المعتمدة خاطئة" },
  { value: "unclear", label: "السؤال غير واضح" },
  { value: "off_lecture", label: "ليس من المحاضرة" },
];

function ReportLink({ questionId, onReport, busy }: { questionId: string; onReport?: QuestionProps["onReport"]; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!onReport) return null;
  return (
    <div className="mt-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-rose-500">
          <Flag className="w-3 h-3" aria-hidden /> أبلغ عن خطأ في السؤال
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="سبب الإبلاغ">
          {REPORT_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onReport(questionId, r.value);
              }}
              className="h-7 px-2.5 rounded-lg border border-rose-500/30 text-[11.5px] font-bold text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
          <button type="button" onClick={() => setOpen(false)} className="h-7 px-2 text-[11.5px] text-muted-foreground">إلغاء</button>
        </div>
      )}
    </div>
  );
}

const DIFF_LABEL = ["", "سهل", "متوسط", "صعب"];

function QuestionCard({ block, pendingId, busy, onAnswer, onReport, onSlide }: { block: QuestionBlock } & QuestionProps & Common) {
  const q = block.question;
  const live = pendingId === q.id && !!onAnswer;
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const ready = q.format === "choice" ? choice !== null : !!text.trim();
  const submit = (confidence: Confidence) => {
    if (!live || busy || !ready) return;
    if (q.format === "choice") onAnswer!(q.id, { choice: choice!, confidence });
    else onAnswer!(q.id, { text, confidence });
  };
  return (
    <Card className={cn(live ? "border-uqu-accent/40 shadow-sm" : "opacity-80", block.context === "final" && live && "border-violet-500/40")}>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] font-bold">
        <span className="px-2 py-0.5 rounded-full bg-uqu-accent/10 text-uqu-accent">{CONTEXT_LABEL[block.context]}</span>
        {block.index && block.total ? <span className="text-muted-foreground">سؤال {block.index}{block.context === "final" ? ` من ${block.total}` : ""}</span> : null}
        <span className="text-muted-foreground">{q.skill_label}</span>
        <span className="text-muted-foreground">· {DIFF_LABEL[q.difficulty] ?? ""}</span>
      </div>
      <div className="font-bold" dir="auto"><BotMarkdown content={q.prompt} onSlide={onSlide} /></div>

      {q.format === "choice" ? (
        <div className="grid gap-2 mt-3" role="radiogroup" aria-label="الخيارات">
          {q.options!.map((opt, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={choice === i}
              disabled={!live || busy}
              onClick={() => setChoice(i)}
              className={cn(
                "text-right px-4 py-2.5 rounded-xl border text-[14px] transition-colors",
                choice === i ? "border-uqu-accent bg-uqu-accent/10" : "border-foreground/10 bg-background hover:border-uqu-accent/40",
                !live && "cursor-default hover:border-foreground/10",
              )}
              dir="auto"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        live && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (q.format === "code" && e.key === "Tab") {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: s, selectionEnd: en } = el;
                const next = text.slice(0, s) + "    " + text.slice(en);
                setText(next);
                requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit("think");
            }}
            rows={q.format === "code" ? 7 : 4}
            maxLength={4000}
            dir={q.format === "code" ? "ltr" : "auto"}
            spellCheck={q.format !== "code"}
            placeholder={q.format === "code" ? "اكتب الكود هنا…" : "اكتب إجابتك بأسلوبك…"}
            aria-label="إجابتك"
            className={cn(
              "mt-3 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-[14px] leading-7 focus:outline-none focus:border-uqu-accent/60",
              q.format === "code" && "font-mono text-[13px]",
            )}
          />
        )
      )}

      {live && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[12px] text-muted-foreground flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
            {block.context === "final" ? "سجّل إجابتك" : "أرسل إجابتك"} — ومدى ثقتك فيها:
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="أرسل الإجابة مع مدى ثقتك">
            {CONFIDENCE_BUTTONS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => submit(c.value)}
                disabled={busy || !ready}
                title={c.hint}
                className={cn(
                  "h-11 rounded-xl text-sm font-bold disabled:opacity-40 transition-colors",
                  c.value === "sure" ? "bg-uqu-accent text-white hover:bg-uqu-accent/90" : "border border-uqu-accent/40 text-uqu-accent hover:bg-uqu-accent/10",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          {q.format !== "choice" && <span className="block text-[11px] text-muted-foreground">Ctrl+Enter = «أظن»</span>}
        </div>
      )}
      {!live && <PageChips pages={q.pages} onSlide={onSlide} />}
      {live && <ReportLink questionId={q.id} onReport={onReport} busy={busy} />}
    </Card>
  );
}

function FeedbackCard({ block, onSlide, onReport, busy }: { block: Block } & Common & QuestionProps) {
  const ok = block.correct;
  const skipped = block.verdict === "skipped" || block.verdict === "revealed";
  const partial = block.verdict === "partial";
  return (
    <Card className={cn(ok ? "border-emerald-500/40 bg-emerald-500/[0.06]" : skipped ? "border-foreground/15" : partial ? "border-amber-500/40 bg-amber-500/[0.06]" : "border-rose-500/40 bg-rose-500/[0.05]")}>
      <div className="flex items-center gap-2 font-black mb-1.5">
        {ok ? <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden /> : <XCircle className={cn("w-5 h-5", skipped ? "text-muted-foreground" : partial ? "text-amber-500" : "text-rose-500")} aria-hidden />}
        {ok ? "إجابة صحيحة" : skipped ? "الإجابة" : partial ? "إجابة صحيحة جزئياً" : block.retry ? "ليست بعد" : "إجابة غير صحيحة"}
      </div>
      {block.confidentError && (
        <p className="text-[13px] mb-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300 font-bold">
          كنت متأكداً من هذه الإجابة — وهذا النوع من الأخطاء أهم ما نصححه، لأنه فكرة راسخة لا مجرد نسيان.
        </p>
      )}
      {block.luckyGuess && (
        <p className="text-[13px] mb-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-300">
          صحيحة، لكنك كنت تخمّن — تُحسب نصف درجة، وسأعطيك سؤالاً عن نفس الفكرة بصيغة أخرى لنتأكد.
        </p>
      )}
      {block.misconception && !ok && (
        <p className="text-[13px] mb-1.5"><span className="font-bold">ما يبدو أنه حصل: </span>{block.misconception}</p>
      )}
      {block.md && <BotMarkdown content={block.md} onSlide={onSlide} />}
      {block.correctText !== undefined && !ok && (
        <p className="mt-2 text-[14px]"><span className="font-bold">الإجابة الصحيحة: </span><span dir="auto">{block.correctText}</span></p>
      )}
      {block.modelAnswer && !ok && (
        <div className="mt-2 text-[14px]"><span className="font-bold">إجابة نموذجية:</span><BotMarkdown content={block.modelAnswer} onSlide={onSlide} /></div>
      )}
      {block.explanation && (ok ? !block.md?.includes(block.explanation) : true) && (
        <div className="mt-2 pt-2 border-t border-foreground/10 text-[13.5px] text-muted-foreground"><BotMarkdown content={block.explanation} onSlide={onSlide} /></div>
      )}
      {block.questionId && !block.retry && <ReportLink questionId={block.questionId} onReport={onReport} busy={busy} />}
    </Card>
  );
}

function DiagnosisCard({ block }: { block: Block }) {
  return (
    <Card className="border-amber-500/30">
      <div className="flex items-center gap-2 font-black mb-2"><Stethoscope className="w-4 h-4 text-amber-600" aria-hidden /> ما لاحظته من إجاباتك</div>
      <ul className="space-y-1.5 text-[14px]">
        {block.weak?.length > 0 && <li><span className="font-bold">المفاهيم التي تحتاج تثبيتاً: </span>{(block.weak as string[]).join("، ")}</li>}
        {block.misconceptions?.length > 0 && <li><span className="font-bold">أخطاء تكررت: </span>{(block.misconceptions as string[]).join("؛ ")}</li>}
        {block.prerequisites?.length > 0 && <li><span className="font-bold">يعتمد على: </span>{(block.prerequisites as string[]).join("، ")}</li>}
        {(block.reasons as string[] | undefined)?.map((r) => <li key={r} className="text-muted-foreground">• {r}</li>)}
        <li><span className="font-bold">الخطة: </span>{block.strategy}</li>
      </ul>
    </Card>
  );
}

function TopicSummaryCard({ block }: { block: Block } & Common) {
  return (
    <Card className={block.mastered ? "border-emerald-500/40" : "border-amber-500/40"}>
      <div className="flex items-center gap-2 font-black mb-3">
        {block.mastered ? <Trophy className="w-5 h-5 text-emerald-500" aria-hidden /> : <ListChecks className="w-5 h-5 text-amber-500" aria-hidden />}
        {block.mastered ? `أتقنت: ${block.title}` : `${block.title} — يحتاج مراجعة`}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <Meter value={block.score} label="درجة الإتقان" />
        <Meter value={block.confidence} label="الثقة في الحكم (كمية الأدلة وتنوعها)" />
      </div>
      {block.strengths?.length > 0 && <p className="text-[13.5px]"><span className="font-bold text-emerald-700 dark:text-emerald-300">ثبّتّ: </span>{(block.strengths as string[]).join("، ")}</p>}
      {block.toReview?.length > 0 && <p className="text-[13.5px] mt-1"><span className="font-bold text-amber-700 dark:text-amber-300">راجع: </span>{(block.toReview as string[]).join("، ")}</p>}
      {block.missing?.length > 0 && (
        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer font-bold text-muted-foreground">لماذا لم يُحسب متقناً؟</summary>
          <ul className="list-disc pr-5 mt-1 space-y-0.5">{(block.missing as string[]).map((m) => <li key={m}>{m}</li>)}</ul>
        </details>
      )}
      <CalibrationLine c={block.calibration} />
      {block.note && <p className="text-[13px] text-muted-foreground mt-2">{block.note}</p>}
      {block.reviewDue && <p className="text-[12.5px] text-muted-foreground mt-2">أول مراجعة متباعدة: {formatDay(block.reviewDue)}</p>}
    </Card>
  );
}

function FinalReport({ block, onSlide }: { block: Block } & Common) {
  return (
    <Card className="border-violet-500/30">
      <div className="flex items-center gap-2 font-black text-lg mb-1"><Trophy className="w-5 h-5 text-violet-500" aria-hidden /> نتيجة الاختبار الشامل — {pct(block.score)}</div>
      {typeof block.change === "number" && (
        <p className="text-[13px] text-muted-foreground mb-2">مقارنة بالمحاولة السابقة: {block.change >= 0 ? "+" : ""}{Math.round(block.change * 100)} نقطة</p>
      )}
      <div className="space-y-3 my-3">
        {(block.topics as { topicId: string; title: string; score: number | null; questions: number; correct: number; why: string[] }[]).map((t) => (
          <div key={t.topicId} className="rounded-xl border border-foreground/10 p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="font-bold text-[14px]" dir="auto">{t.title}</span>
              <span className="text-[12px] text-muted-foreground whitespace-nowrap">{t.correct}/{t.questions}</span>
            </div>
            <Meter value={t.score} label="" />
            {t.why.length > 0 && <ul className="mt-1.5 text-[12.5px] text-muted-foreground space-y-0.5">{t.why.map((w) => <li key={w}>• {w}</li>)}</ul>}
          </div>
        ))}
      </div>
      <CalibrationLine c={block.calibration} />
      {block.byLevel && (
        <div className="flex flex-wrap gap-2 mb-3 text-[12px]">
          {Object.entries(block.byLevel as Record<string, { label: string; total: number; correct: number }>).map(([k, v]) => (
            <span key={k} className="px-2 py-1 rounded-lg bg-foreground/5">{v.label}: {v.correct}/{v.total}</span>
          ))}
        </div>
      )}
      <h4 className="font-black text-[14px] mb-2">خطة المراجعة المقترحة</h4>
      <ol className="space-y-1.5 text-[13.5px]">
        {(block.plan as { topicId: string; title: string; action: string; due: string | null; pages: number[]; priority: number }[]).map((p) => (
          <li key={p.topicId} className="flex gap-2">
            <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", p.priority === 0 ? "bg-rose-500" : p.priority === 1 ? "bg-amber-500" : "bg-emerald-500")} aria-hidden />
            <span>
              <span className="font-bold">{p.title}: </span>{p.action}
              {p.due && <span className="text-muted-foreground"> — {formatDay(p.due)}</span>}{" "}
              <button type="button" className="text-uqu-accent text-[12px] font-bold" onClick={() => onSlide(p.pages[0])}>ص {p.pages[0]}–{p.pages[1]}</button>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** "When you were sure you were right 4 of 5 times" — confidence vs. results. */
function CalibrationLine({ c }: { c?: { by_level?: Record<string, { answers: number; correct: number }>; confident_errors?: number; lucky_guesses?: number } }) {
  const sure = c?.by_level?.sure;
  if (!c || (!sure && !c.lucky_guesses)) return null;
  return (
    <p className="text-[12.5px] text-muted-foreground mt-2">
      {sure ? `عندما كنت متأكداً أصبت ${sure.correct} من ${sure.answers}` : ""}
      {sure && c.lucky_guesses ? " · " : ""}
      {c.lucky_guesses ? `أصبت ${c.lucky_guesses} بالتخمين (لم تُحسب كاملة)` : ""}
      {c.confident_errors ? ` · ${c.confident_errors} خطأ بثقة عالية — راجعه أولاً` : ""}
    </p>
  );
}

export function formatDay(day: string): string {
  try {
    const d = new Date(`${day}T12:00:00`);
    const today = new Date();
    const diff = Math.round((d.getTime() - new Date(today.toDateString()).getTime()) / 86400000);
    if (diff <= 0) return "اليوم";
    if (diff === 1) return "بكرة";
    return d.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return day;
  }
}

// ── Student blocks ──────────────────────────────────────────────

const CONF_LABEL: Record<Confidence, string> = { sure: "متأكد", think: "أظن", guess: "أخمّن" };

export function StudentBlock({ block }: { block: Block }) {
  if (block.type === "answer") {
    const conf = block.confidence ? <span className="block text-[10.5px] opacity-75 mt-0.5">{CONF_LABEL[block.confidence as Confidence] ?? ""}</span> : null;
    return block.code ? (
      <div className="px-4 py-3 rounded-2xl rounded-tr-sm bg-uqu-accent text-white">
        <pre className="text-[13px] font-mono whitespace-pre-wrap text-left overflow-x-auto" dir="ltr">{block.text}</pre>
        {conf}
      </div>
    ) : (
      <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-uqu-accent text-white text-[14.5px] whitespace-pre-wrap" dir="auto">
        {block.text}
        {conf}
      </div>
    );
  }
  const text = block.text ?? block.md ?? "";
  return <div className={cn("px-4 py-2.5 rounded-2xl rounded-tr-sm text-[14px] whitespace-pre-wrap", block.type === "request" ? "bg-uqu-accent/15 text-uqu-accent font-bold" : "bg-uqu-accent text-white")} dir="auto">{text}</div>;
}
