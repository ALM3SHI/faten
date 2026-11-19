"use client";

import { useState } from "react";
import { SketchCheck, SketchCircle } from "@/components/sketch";
import { Button } from "@/components/ds/button";
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
import { LessonVisual } from "@/components/tutor/lesson-visual";
import { LessonParts } from "@/components/tutor/lesson-parts";
import { LessonVideo } from "@/components/tutor/lesson-video";
import { ConceptChips } from "@/components/tutor/concept-chips";
import { cn } from "@/lib/utils";
import { CONTEXT_LABEL, pct, type AnswerPayload, type Block, type Confidence, type QuestionBlock, type ReportReason } from "@/lib/tutor";
import { MatchInput, OrderInput } from "@/components/tutor/question-inputs";

interface Common {
  onSlide: (page: number) => void;
  /** open a concept's deep-dive page */
  onDeepDive?: (conceptId: string) => void;
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-card border border-line bg-surface px-4 py-3.5 text-body leading-relaxed", className)}>{children}</div>;
}

function PageChips({ pages, onSlide }: { pages?: number[]; onSlide: (p: number) => void }) {
  if (!pages?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-3" aria-label="الشرائح المرتبطة">
      {pages.slice(0, 8).map((p) => (
        <Button variant="bare"
          key={p}
          type="button"
          onClick={() => onSlide(p)}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-line text-small font-bold text-ink-muted hover:text-info-ink hover:border-info-line transition-colors"
        >
          <FileText className="w-3 h-3" aria-hidden /> شريحة {p}
        </Button>
      ))}
    </div>
  );
}

function Meter({ value, label }: { value: number | null; label: string }) {
  const v = value ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-small text-ink-muted">
        <span>{label}</span>
        <span className="font-bold text-ink">{pct(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden" aria-hidden>
        <div className={cn("h-full rounded-full", v >= 0.8 ? "bg-success-ink" : v >= 0.5 ? "bg-warning-ink" : "bg-danger-ink")} style={{ width: `${Math.round(v * 100)}%` }} />
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
        <div className={cn("flex gap-2.5 rounded-card border px-4 py-3 text-small leading-7", block.tone === "warn" ? "border-warning-line bg-warning-soft" : "border-info-line bg-info-soft")} role="note">
          {block.tone === "warn" ? <AlertTriangle className="w-4 h-4 mt-1.5 shrink-0 text-warning-ink" aria-hidden /> : <Info className="w-4 h-4 mt-1.5 shrink-0 text-info-ink" aria-hidden />}
          <span>{block.md}</span>
        </div>
      );
    case "map":
      return <MapCard block={block} {...c} />;
    case "goal":
      return <GoalCard block={block} {...c} />;
    case "lesson":
      return (
        <Card className={cn(block.remedial && "border-warning-line", block.alternative && "border-info-line")}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-bold text-body">{block.title}</h3>
            {typeof block.segment === "number" && block.total ? (
              <span className="text-caption font-bold text-ink-muted whitespace-nowrap">الجزء {block.segment + 1} من {block.total}</span>
            ) : null}
          </div>
          {Array.isArray(block.parts) && block.parts.length ? (
            <LessonParts parts={block.parts} reviewed={block.reviewed} onSlide={c.onSlide} />
          ) : (
            <BotMarkdown content={block.md} onSlide={c.onSlide} />
          )}
          {block.visual && <LessonVisual visual={block.visual} topicId={block.topicId} segment={block.segment} onSlide={c.onSlide} />}
          {block.video && <LessonVideo video={block.video} />}
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
        <div className="flex gap-2.5 rounded-card border border-warning-line bg-warning-soft px-4 py-3 text-body leading-7">
          <Lightbulb className="w-4 h-4 mt-1.5 shrink-0 text-warning-ink" aria-hidden />
          <div>
            {block.index ? <span className="text-caption font-bold text-ink-muted block">تلميح {block.index} من {block.total}</span> : null}
            <BotMarkdown content={block.md} onSlide={c.onSlide} />
          </div>
        </div>
      );
    case "answer_text":
      return (
        <Card>
          {block.inLecture === false && <span className="inline-block mb-2 text-caption font-bold px-2 py-0.5 rounded-full bg-warning-soft text-warning-ink">خارج المحاضرة</span>}
          <BotMarkdown content={block.md} onSlide={c.onSlide} />
          <PageChips pages={block.pages} onSlide={c.onSlide} />
        </Card>
      );
    case "diagnosis":
      return <DiagnosisCard block={block} {...c} />;
    case "deep_dive":
      return (
        <Card className="border-info-line">
          <div className="mb-1 text-caption font-bold text-info-ink">تعمّق · {block.topicTitle}</div>
          <h3 className="mb-1 text-subheading font-bold" dir="auto">{block.name}</h3>
          {block.definition && <p className="mb-3 text-small leading-7 text-ink-muted" dir="auto">{block.definition}</p>}
          <LessonParts parts={block.parts ?? []} reviewed={block.reviewed} onSlide={c.onSlide} />
          <ConceptChips concepts={(block.related ?? []).map((r: { id: string; name: string }) => ({ ...r, level: "unknown" as const }))} label="مفاهيم مرتبطة به" busy={c.busy} onDeepDive={c.onDeepDive} />
        </Card>
      );
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
        <Route className="w-5 h-5 text-info-ink mt-1 shrink-0" aria-hidden />
        <div>
          <h3 className="font-bold">خريطة المحاضرة: {block.title}</h3>
          {block.overview && <p className="text-small text-ink-muted leading-7 mt-1">{block.overview}</p>}
        </div>
      </div>
      <ol className="space-y-2">
        {(block.topics as { id: string; title: string; pages: number[]; est_minutes: number; importance: number }[]).map((t, i) => (
          <li key={t.id} className="flex items-center gap-3 rounded-control border border-line px-3 py-2">
            <span className="w-6 h-6 rounded-full bg-info-soft text-info-ink text-small font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="flex-1 min-w-0 text-body font-bold truncate" dir="auto">{t.title}</span>
            {t.importance >= 3 && <span className="text-caption font-bold px-1.5 py-0.5 rounded bg-info-soft text-info-ink shrink-0">محوري</span>}
            <Button variant="bare" type="button" onClick={() => onSlide(t.pages[0])} className="text-caption text-ink-muted hover:text-info-ink shrink-0">
              ص {t.pages[0]}–{t.pages[1]}
            </Button>
            <span className="text-caption text-ink-muted shrink-0 hidden sm:inline">~{t.est_minutes} د</span>
          </li>
        ))}
      </ol>
      {block.estMinutes ? (
        <p className="flex items-center gap-1.5 text-small text-ink-muted mt-3">
          <Clock className="w-3.5 h-3.5" aria-hidden /> الوقت التقديري للمحاضرة كاملة: نحو {Math.round(block.estMinutes / 5) * 5} دقيقة — يمكنك تقسيمها على أكثر من جلسة.
        </p>
      ) : null}
    </Card>
  );
}

function GoalCard({ block, onSlide, onDeepDive, busy }: { block: Block } & Common & QuestionProps) {
  return (
    <Card className="border-info-line bg-info-soft">
      <div className="text-caption font-bold text-info-ink mb-1">الموضوع {block.index} من {block.total}</div>
      <h3 className="text-subheading font-bold mb-2" dir="auto">{block.title}</h3>
      {block.why && <p className="text-body leading-7 mb-3">{block.why}</p>}
      {block.objectives?.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 text-small font-bold mb-1.5"><Target className="w-3.5 h-3.5 text-info-ink" aria-hidden /> بنهاية هذا الموضوع ستكون قادراً أن:</div>
          <ul className="list-disc pr-5 space-y-1 text-body">
            {(block.objectives as string[]).map((o) => <li key={o}>{o}</li>)}
          </ul>
        </div>
      )}
      <div className="text-small text-ink-muted leading-6">
        <span className="font-bold text-ink">تحتاج قبله: </span>{block.prerequisites}
        {block.weakPrerequisites?.length > 0 && (
          <span className="block text-warning-ink mt-1">لم تتقن بعد: {(block.weakPrerequisites as string[]).join("، ")} — سأرجع لها إن احتجنا.</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3 text-small text-ink-muted">
        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden /> ~{block.estMinutes} دقيقة</span>
        <Button variant="bare" type="button" onClick={() => onSlide(block.pages[0])} className="hover:text-info-ink font-bold">الشرائح {block.pages[0]}–{block.pages[1]}</Button>
      </div>
      <ConceptChips concepts={block.concepts ?? []} label="مفاهيم الموضوع — اضغط أي مفهوم لتتعمّق فيه" busy={busy} onDeepDive={onDeepDive} />
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
  onAnswer?: (questionId: string, answer: AnswerPayload) => void;
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
        <Button variant="bare" type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-caption text-ink-muted hover:text-danger-ink">
          <Flag className="w-3 h-3" aria-hidden /> أبلغ عن خطأ في السؤال
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="سبب الإبلاغ">
          {REPORT_REASONS.map((r) => (
            <Button variant="bare"
              key={r.value}
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onReport(questionId, r.value);
              }}
              className="h-7 px-2.5 rounded-control border border-danger-line text-caption font-bold text-danger-ink hover:bg-danger-soft disabled:opacity-50"
            >
              {r.label}
            </Button>
          ))}
          <Button variant="bare" type="button" onClick={() => setOpen(false)} className="h-7 px-2 text-caption text-ink-muted">إلغاء</Button>
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
  const [order, setOrder] = useState<number[]>(() => (q.items ?? []).map((_, i) => i));
  const [matches, setMatches] = useState<(number | null)[]>(() => (q.lefts ?? []).map(() => null));
  const ready =
    q.format === "choice"
      ? choice !== null
      : q.format === "order"
        ? order.length > 1
        : q.format === "match"
          ? matches.every((m) => m !== null) && new Set(matches).size === matches.length
          : !!text.trim();
  const submit = (confidence: Confidence) => {
    if (!live || busy || !ready) return;
    if (q.format === "choice") onAnswer!(q.id, { choice: choice!, confidence });
    else if (q.format === "order") onAnswer!(q.id, { order, confidence });
    else if (q.format === "match") onAnswer!(q.id, { matches: matches as number[], confidence });
    else onAnswer!(q.id, { text, confidence });
  };
  return (
    <Card className={cn(live ? "border-info-line" : "opacity-80", block.context === "final" && live && "border-info-line")}>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-caption font-bold">
        <span className="px-2 py-0.5 rounded-full bg-info-soft text-info-ink">{CONTEXT_LABEL[block.context]}</span>
        {block.index && block.total ? <span className="text-ink-muted">سؤال {block.index}{block.context === "final" ? ` من ${block.total}` : ""}</span> : null}
        <span className="text-ink-muted">{q.skill_label}</span>
        <span className="text-ink-muted">· {DIFF_LABEL[q.difficulty] ?? ""}</span>
      </div>
      <div className="font-bold" dir="auto"><BotMarkdown content={q.prompt} onSlide={onSlide} /></div>

      {q.format === "choice" ? (
        <div className="grid gap-2 mt-3" role="radiogroup" aria-label="الخيارات">
          {q.options!.map((opt, i) => (
            <Button variant="bare"
              key={i}
              type="button"
              role="radio"
              aria-checked={choice === i}
              disabled={!live || busy}
              onClick={() => setChoice(i)}
              className={cn(
                "text-right px-4 py-2.5 rounded-control border text-body transition-colors",
                choice === i ? "border-info-line bg-info-soft" : "border-line bg-surface hover:border-info-line",
                !live && "cursor-default hover:border-line",
              )}
              dir="auto"
            >
              {opt}
            </Button>
          ))}
        </div>
      ) : q.format === "order" ? (
        <OrderInput items={q.items ?? []} order={order} onChange={setOrder} disabled={!live || busy} />
      ) : q.format === "match" ? (
        <MatchInput lefts={q.lefts ?? []} rights={q.rights ?? []} matches={matches} onChange={setMatches} disabled={!live || busy} />
      ) : q.format === "fill" ? (
        live && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit("think");
            }}
            maxLength={200}
            dir="auto"
            placeholder="الكلمة الناقصة…"
            aria-label="الكلمة الناقصة"
            className="mt-3 h-11 w-full max-w-sm rounded-control border border-line-strong bg-surface px-3 text-body focus:outline-none focus:border-info-line"
          />
        )
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
              "mt-3 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-body leading-7 focus:outline-none focus:border-info-line",
              q.format === "code" && "font-mono text-small",
            )}
          />
        )
      )}

      {live && (
        <div className="mt-3 space-y-1.5">
          <div className="text-small text-ink-muted flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
            {block.context === "final" ? "سجّل إجابتك" : "أرسل إجابتك"} — ومدى ثقتك فيها:
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="أرسل الإجابة مع مدى ثقتك">
            {CONFIDENCE_BUTTONS.map((c) => (
              <Button variant="bare"
                key={c.value}
                type="button"
                onClick={() => submit(c.value)}
                disabled={busy || !ready}
                title={c.hint}
                className={cn(
                  "h-11 rounded-control text-small font-bold disabled:opacity-40 transition-colors",
                  c.value === "sure" ? "bg-brand text-on-brand hover:bg-brand-hover" : "border border-info-line text-info-ink hover:bg-info-soft",
                )}
              >
                {c.label}
              </Button>
            ))}
          </div>
          {(q.format === "text" || q.format === "code") && <span className="block text-caption text-ink-muted">Ctrl+Enter = «أظن»</span>}
          {q.format === "fill" && <span className="block text-caption text-ink-muted">Enter = «أظن»</span>}
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
    <Card className={cn(ok ? "border-success-line bg-success-soft" : skipped ? "border-line-strong" : partial ? "border-warning-line bg-warning-soft" : "border-danger-line bg-danger-soft")}>
      <div className="flex items-center gap-2 font-bold mb-1.5">
        {ok ? <CheckCircle2 className="w-5 h-5 text-success-ink" aria-hidden /> : <XCircle className={cn("w-5 h-5", skipped ? "text-ink-muted" : partial ? "text-warning-ink" : "text-danger-ink")} aria-hidden />}
        {ok ? "إجابة صحيحة" : skipped ? "الإجابة" : partial ? "إجابة صحيحة جزئياً" : block.retry ? "ليست بعد" : "إجابة غير صحيحة"}
      </div>
      {block.confidentError && (
        <p className="text-small mb-1.5 px-2.5 py-1.5 rounded-control bg-danger-soft text-danger-ink font-bold">
          كنت متأكداً من هذه الإجابة — وهذا النوع من الأخطاء أهم ما نصححه، لأنه فكرة راسخة لا مجرد نسيان.
        </p>
      )}
      {block.luckyGuess && (
        <p className="text-small mb-1.5 px-2.5 py-1.5 rounded-control bg-warning-soft text-warning-ink">
          صحيحة، لكنك كنت تخمّن — تُحسب نصف درجة، وسأعطيك سؤالاً عن نفس الفكرة بصيغة أخرى لنتأكد.
        </p>
      )}
      {block.misconception && !ok && (
        <p className="text-small mb-1.5"><span className="font-bold">ما يبدو أنه حصل: </span>{block.misconception}</p>
      )}
      {block.md && <BotMarkdown content={block.md} onSlide={onSlide} />}
      {block.correctText !== undefined && !ok && (
        <p className="mt-2 text-body"><span className="font-bold">الإجابة الصحيحة: </span><span dir="auto">{block.correctText}</span></p>
      )}
      {Array.isArray(block.correctOrder) && !ok && (
        <div className="mt-2 text-body">
          <span className="font-bold">الترتيب الصحيح:</span>
          <ol className="mt-1 list-decimal space-y-0.5 pe-5">
            {(block.correctOrder as string[]).map((s) => (
              <li key={s}><span dir="auto">{s}</span></li>
            ))}
          </ol>
        </div>
      )}
      {Array.isArray(block.correctPairs) && !ok && (
        <div className="mt-2 text-body">
          <span className="font-bold">التوصيل الصحيح:</span>
          <ul className="mt-1 space-y-0.5">
            {(block.correctPairs as { left: string; right: string }[]).map((p) => (
              <li key={p.left}><bdi className="font-bold">{p.left}</bdi> ← <bdi>{p.right}</bdi></li>
            ))}
          </ul>
        </div>
      )}
      {block.modelAnswer && !ok && (
        <div className="mt-2 text-body"><span className="font-bold">إجابة نموذجية:</span><BotMarkdown content={block.modelAnswer} onSlide={onSlide} /></div>
      )}
      {block.explanation && (ok ? !block.md?.includes(block.explanation) : true) && (
        <div className="mt-2 pt-2 border-t border-line text-small text-ink-muted"><BotMarkdown content={block.explanation} onSlide={onSlide} /></div>
      )}
      {block.questionId && !block.retry && <ReportLink questionId={block.questionId} onReport={onReport} busy={busy} />}
    </Card>
  );
}

function DiagnosisCard({ block, onDeepDive, busy }: { block: Block } & Common & QuestionProps) {
  return (
    <Card className="border-warning-line">
      <div className="flex items-center gap-2 font-bold mb-2"><Stethoscope className="w-4 h-4 text-warning-ink" aria-hidden /> ما لاحظته من إجاباتك</div>
      <ul className="space-y-1.5 text-body">
        {block.weak?.length > 0 && <li><span className="font-bold">المفاهيم التي تحتاج تثبيتاً: </span>{(block.weak as string[]).join("، ")}</li>}
        {block.misconceptions?.length > 0 && <li><span className="font-bold">أخطاء تكررت: </span>{(block.misconceptions as string[]).join("؛ ")}</li>}
        {block.prerequisites?.length > 0 && <li><span className="font-bold">يعتمد على: </span>{(block.prerequisites as string[]).join("، ")}</li>}
        {(block.reasons as string[] | undefined)?.map((r) => <li key={r} className="text-ink-muted">• {r}</li>)}
        <li><span className="font-bold">الخطة: </span>{block.strategy}</li>
      </ul>
      <ConceptChips concepts={block.weakConcepts ?? []} label="تعمّق في مفهوم منها" busy={busy} onDeepDive={onDeepDive} />
    </Card>
  );
}

function TopicSummaryCard({ block, onDeepDive, busy }: { block: Block } & Common & QuestionProps) {
  return (
    <Card className={block.mastered ? "border-success-line" : "border-warning-line"}>
      <div className="flex items-center gap-2 font-bold mb-3">
        {block.mastered ? (
          <SketchCircle className="text-success-ink">
            <SketchCheck className="size-5" />
          </SketchCircle>
        ) : (
          <ListChecks className="w-5 h-5 text-warning-ink" aria-hidden />
        )}
        {block.mastered ? `أتقنت: ${block.title}` : `${block.title} — يحتاج مراجعة`}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <Meter value={block.score} label="درجة الإتقان" />
        <Meter value={block.confidence} label="الثقة في الحكم (كمية الأدلة وتنوعها)" />
      </div>
      {block.strengths?.length > 0 && <p className="text-small"><span className="font-bold text-success-ink">ثبّتّ: </span>{(block.strengths as string[]).join("، ")}</p>}
      {block.toReview?.length > 0 && <p className="text-small mt-1"><span className="font-bold text-warning-ink">راجع: </span>{(block.toReview as string[]).join("، ")}</p>}
      <ConceptChips concepts={block.toReviewConcepts ?? []} label="تعمّق فيما تحتاج مراجعته" busy={busy} onDeepDive={onDeepDive} />
      {block.missing?.length > 0 && (
        <details className="mt-2 text-small">
          <summary className="cursor-pointer font-bold text-ink-muted">لماذا لم يُحسب متقناً؟</summary>
          <ul className="list-disc pr-5 mt-1 space-y-0.5">{(block.missing as string[]).map((m) => <li key={m}>{m}</li>)}</ul>
        </details>
      )}
      <CalibrationLine c={block.calibration} />
      {block.note && <p className="text-small text-ink-muted mt-2">{block.note}</p>}
      {block.reviewDue && <p className="text-small text-ink-muted mt-2">أول مراجعة متباعدة: {formatDay(block.reviewDue)}</p>}
    </Card>
  );
}

function FinalReport({ block, onSlide }: { block: Block } & Common) {
  return (
    <Card className="border-info-line">
      <div className="flex items-center gap-2 font-bold text-subheading mb-1"><Trophy className="w-5 h-5 text-info-ink" aria-hidden /> نتيجة الاختبار الشامل — {pct(block.score)}</div>
      {typeof block.change === "number" && (
        <p className="text-small text-ink-muted mb-2">مقارنة بالمحاولة السابقة: {block.change >= 0 ? "+" : ""}{Math.round(block.change * 100)} نقطة</p>
      )}
      <div className="space-y-3 my-3">
        {(block.topics as { topicId: string; title: string; score: number | null; questions: number; correct: number; why: string[] }[]).map((t) => (
          <div key={t.topicId} className="rounded-control border border-line p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="font-bold text-body" dir="auto">{t.title}</span>
              <span className="nums text-small text-ink-muted whitespace-nowrap">{t.correct} من {t.questions}</span>
            </div>
            <Meter value={t.score} label="" />
            {t.why.length > 0 && <ul className="mt-1.5 text-small text-ink-muted space-y-0.5">{t.why.map((w) => <li key={w}>• {w}</li>)}</ul>}
          </div>
        ))}
      </div>
      <CalibrationLine c={block.calibration} />
      {block.byLevel && (
        <div className="flex flex-wrap gap-2 mb-3 text-small">
          {Object.entries(block.byLevel as Record<string, { label: string; total: number; correct: number }>).map(([k, v]) => (
            <span key={k} className="nums px-2 py-1 rounded-control bg-surface-sunken">{v.label}: {v.correct} من {v.total}</span>
          ))}
        </div>
      )}
      <h4 className="font-bold text-body mb-2">خطة المراجعة المقترحة</h4>
      <ol className="space-y-1.5 text-small">
        {(block.plan as { topicId: string; title: string; action: string; due: string | null; pages: number[]; priority: number }[]).map((p) => (
          <li key={p.topicId} className="flex gap-2">
            <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", p.priority === 0 ? "bg-danger-ink" : p.priority === 1 ? "bg-warning-ink" : "bg-success-ink")} aria-hidden />
            <span>
              <span className="font-bold">{p.title}: </span>{p.action}
              {p.due && <span className="text-ink-muted"> — {formatDay(p.due)}</span>}{" "}
              <Button variant="bare" type="button" className="text-info-ink text-small font-bold" onClick={() => onSlide(p.pages[0])}>ص {p.pages[0]}–{p.pages[1]}</Button>
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
    <p className="text-small text-ink-muted mt-2">
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
    const conf = block.confidence ? <span className="block text-caption opacity-75 mt-0.5">{CONF_LABEL[block.confidence as Confidence] ?? ""}</span> : null;
    return block.code ? (
      <div className="px-4 py-3 rounded-card rounded-tr-sm bg-brand text-on-brand">
        <pre className="text-small font-mono whitespace-pre-wrap text-left overflow-x-auto" dir="ltr">{block.text}</pre>
        {conf}
      </div>
    ) : (
      <div className="px-4 py-2.5 rounded-card rounded-tr-sm bg-brand text-on-brand text-body whitespace-pre-wrap" dir="auto">
        {block.text}
        {conf}
      </div>
    );
  }
  const text = block.text ?? block.md ?? "";
  const quotes: string[] = Array.isArray(block.quotes) ? block.quotes : [];
  return (
    <div className={cn("px-4 py-2.5 rounded-card rounded-tr-sm text-body whitespace-pre-wrap", block.type === "request" ? "bg-info-soft text-info-ink font-bold" : "bg-brand text-on-brand")} dir="auto">
      {quotes.length > 0 && (
        <ul className="mb-1.5 space-y-1" aria-label="عن هذه المقاطع">
          {quotes.map((q) => (
            <li key={q} className="border-s-2 border-current/50 ps-2 text-small opacity-90">
              «{q}»
            </li>
          ))}
        </ul>
      )}
      {text}
    </div>
  );
}
