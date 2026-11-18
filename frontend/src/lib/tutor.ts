/**
 * Dynamic study mode («المذاكرة الذكية») — API client, types and the pure
 * helpers the page uses. The server (backend/services/tutor) owns the
 * learning state; the browser renders it and sends one action at a time.
 */

import { ApiError, fetchWithAuth } from "@/lib/api";

// ── Types (mirror backend/services/tutor/engine.py) ─────────────────

export type TopicStatus = "not_started" | "in_progress" | "needs_review" | "review_due" | "mastered";

export interface Topic {
  id: string;
  title: string;
  summary?: string;
  pages: [number, number];
  objectives: string[];
  concepts: { id: string; name: string; definition: string }[];
  prerequisites: string[];
  importance: number;
  est_minutes: number;
  has_code?: boolean;
  key_terms: { term: string; definition: string }[];
}

export interface Lecture {
  id: string;
  title: string;
  fileName: string;
  fileHash: string;
  overview?: string;
  pageCount: number;
  topics: Topic[];
  extraction?: {
    textPages: number;
    visionPages: number[];
    unreadablePages: number[];
    visionSkipped: number[];
    tables: number;
    imagePages: number;
  };
  estMinutes?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicQuestion {
  id: string;
  topic_id: string;
  format: "choice" | "text" | "code";
  skill: string;
  skill_label: string;
  difficulty: number;
  prompt: string;
  pages: number[];
  has_hint: boolean;
  options?: string[];
}

export type Confidence = "sure" | "think" | "guess";
export type ReportReason = "wrong_key" | "unclear" | "off_lecture";

export interface QuestionBlock {
  type: "question";
  context: "check" | "quiz" | "review" | "final" | "warmup";
  question: PublicQuestion;
  index?: number | null;
  total?: number | null;
  attempts?: number;
  hints?: number;
}

export interface TopicProgress {
  status: TopicStatus;
  score: number | null;
  confidence: number;
  mastered: boolean;
  missing: string[];
  met: string[];
  attempts: number;
  correct: number;
  reviewDue: string | null;
  lastReviewedAt: string | null;
  activeMinutes: number;
}

export interface TutorState {
  phase: "overview" | "topic" | "review" | "final_ready" | "final" | "done";
  currentTopicId: string | null;
  /** The part of the lecture on screen: "overview", "topic:<id>", "review" or "final". */
  section?: string;
  stage: "warmup" | "goal" | "explain" | "check" | "quiz" | "remediate" | "closed" | null;
  segment: number | null;
  segments: number;
  pending: QuestionBlock | null;
  topics: Record<string, TopicProgress>;
  reviewDue: string[];
  points: number;
  final: { status: string; index: number; total: number; attempt: number; result?: { score: number } } | null;
  version: number;
}

// ── Lesson pictures (backend: services/tutor/visuals.py) ──
export interface DiagramNode {
  id: string;
  label: string;
  shape: "box" | "db" | "decision";
}
export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  reply: boolean;
}
export interface Diagram {
  type: "flow" | "sequence" | "cycle";
  direction: "lr" | "tb";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}
export interface CommonsPhoto {
  url: string;
  width?: number;
  height?: number;
  title?: string;
  page?: string;
  license?: string;
  artist?: string;
}
export type Visual =
  | { kind: "diagram"; caption: string; diagram: Diagram }
  | { kind: "slide"; caption: string; page: number }
  | { kind: "photo"; caption: string; status: "pending" }
  | { kind: "photo"; caption: string; status: "ready"; photo: CommonsPhoto };

export async function loadVisual(id: string, topicId: string, segment: number): Promise<Visual | null> {
  const q = `topic=${encodeURIComponent(topicId)}&segment=${segment}`;
  const data = (await fetchWithAuth(`/api/tutor/lectures/${encodeURIComponent(id)}/visual?${q}`, { method: "GET" })) as { visual: Visual | null };
  return data.visual ?? null;
}

// Blocks are open-ended records from the server; each renderer reads its own fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Block = { type: string } & Record<string, any>;

export type PartRole = "idea" | "why" | "how" | "example" | "real_world" | "code" | "mistake" | "compare" | "summary";

/** One teaching piece of a lesson part; `origin` says if it comes from the student's file. */
export interface LessonPart {
  role: PartRole;
  origin: "lecture" | "added";
  md: string;
  pages: number[];
}

export interface Action {
  id: string;
  label: string;
  payload?: Record<string, unknown>;
}

export interface TutorMessage {
  seq: number;
  role: "tutor" | "student";
  ts: string;
  /** The part of the lecture it was said in (see TutorState.section); absent on older messages. */
  section?: string;
  blocks: Block[];
  actions?: Action[];
}

/** Where a state is, as a section key — the server sends it; older servers did not. */
export function sectionOf(state: Pick<TutorState, "phase" | "currentTopicId" | "section">): string {
  if (state.section) return state.section;
  if (state.phase === "topic" && state.currentTopicId) return `topic:${state.currentTopicId}`;
  if (state.phase === "final_ready" || state.phase === "final" || state.phase === "done") return "final";
  return state.phase;
}

/**
 * The messages of one part of the lecture, so a topic's lesson never runs on
 * into the next one's. Messages saved before sections existed carry no tag:
 * they show only while the part on screen has nothing tagged yet, so an older
 * session looks as it did until the student moves on.
 */
export function messagesOfSection(messages: TutorMessage[], section: string): TutorMessage[] {
  const tagged = messages.filter((m) => m.section === section);
  if (tagged.length) return tagged;
  return messages.filter((m) => !m.section);
}

export interface FocusState {
  mode: "idle" | "focus" | "break";
  startedAt: string | null;
  durationSec: number;
  pausedAt: string | null;
  pausedTotalSec: number;
  focusMin: number;
  breakMin: number;
  completedFocus: number;
  serverNow?: string;
}

export interface Session {
  lecture: Lecture;
  state: TutorState;
  messages: TutorMessage[];
  focus: FocusState;
  reused?: "mine" | "shared" | null;
}

export interface LectureSummary {
  id: string;
  title: string;
  fileName: string;
  fileHash: string;
  pageCount: number;
  topics: number;
  estMinutes: number;
  phase: TutorState["phase"];
  counts: Record<TopicStatus, number>;
  reviewDue: number;
  dueTopics?: { id: string; title: string }[];
  finalScore: number | null;
  updatedAt: string | null;
}

// ── API ─────────────────────────────────────────────────────────────

export const MAX_PDF_MB = 10;

/**
 * The session an upload just returned, handed to the tutor page so it
 * opens without a refetch. Set by «ذاكر محاضرة» (/study) right before it
 * navigates to /tutor?lecture=…; the session view takes it once.
 */
export const tutorHandoff: { session: Session | null } = { session: null };

/** A new lecture being prepared in the background (backend: services/tutor/prepare.py). */
export interface PrepJob {
  id: string;
  fileName?: string;
  status: "working" | "ready" | "failed";
  stage?: "reading" | "vision" | "structure" | "lesson" | "saving";
  done?: number;
  total?: number;
  error?: string | null;
  /** the work was lost (server restart): send the file again to resume, free */
  stalled: boolean;
}

export async function uploadLecture(file: File): Promise<Session> {
  const form = new FormData();
  form.append("file", file);
  return (await fetchWithAuth("/api/tutor/lectures", { method: "POST", body: form })) as Session;
}

/**
 * Upload without waiting for a new lecture to be prepared: a file prepared
 * before opens at once (a session); a new one comes back as a job to follow.
 */
export async function startLecture(file: File): Promise<Session | { job: PrepJob }> {
  const form = new FormData();
  form.append("file", file);
  form.append("background", "true");
  return (await fetchWithAuth("/api/tutor/lectures", { method: "POST", body: form })) as Session | { job: PrepJob };
}

export async function loadJob(id: string): Promise<PrepJob> {
  const data = (await fetchWithAuth(`/api/tutor/lectures/${encodeURIComponent(id)}/job`, { method: "GET" })) as { job: PrepJob };
  return data.job;
}

export async function listStudy(): Promise<{ lectures: LectureSummary[]; preparing: PrepJob[] }> {
  const data = (await fetchWithAuth("/api/tutor/lectures", { method: "GET" })) as { lectures: LectureSummary[]; preparing?: PrepJob[] };
  return { lectures: data.lectures ?? [], preparing: data.preparing ?? [] };
}

export async function listLectures(): Promise<LectureSummary[]> {
  return (await listStudy()).lectures;
}

export async function loadSession(id: string): Promise<Session> {
  return (await fetchWithAuth(`/api/tutor/lectures/${encodeURIComponent(id)}`, { method: "GET" })) as Session;
}

export async function sendStep(
  id: string,
  action: string,
  payload: Record<string, unknown>,
  version: number,
): Promise<{ state: TutorState; messages: TutorMessage[] }> {
  return fetchWithAuth(`/api/tutor/lectures/${encodeURIComponent(id)}/step`, {
    method: "POST",
    body: JSON.stringify({ action, payload, version }),
  });
}

export async function saveFocus(id: string, focus: FocusState): Promise<FocusState> {
  const body = { ...focus };
  delete body.serverNow;
  const data = await fetchWithAuth(`/api/tutor/lectures/${encodeURIComponent(id)}/focus`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return data.focus as FocusState;
}

export async function resetLecture(id: string): Promise<Session> {
  return (await fetchWithAuth(`/api/tutor/lectures/${encodeURIComponent(id)}/reset`, { method: "POST" })) as Session;
}

export async function deleteLecture(id: string): Promise<void> {
  await fetchWithAuth(`/api/tutor/lectures/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

// ── Labels ──────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<TopicStatus, string> = {
  not_started: "لم يبدأ",
  in_progress: "قيد الدراسة",
  needs_review: "يحتاج مراجعة",
  review_due: "حان وقت مراجعته",
  mastered: "متقن",
};

export const STATUS_TONE: Record<TopicStatus, string> = {
  not_started: "text-ink-muted border-line bg-surface-sunken",
  in_progress: "text-info-ink border-info-line bg-info-soft",
  needs_review: "text-warning-ink border-warning-line bg-warning-soft",
  review_due: "text-info-ink border-info-line bg-info-soft",
  mastered: "text-success-ink border-success-line bg-success-soft",
};

export const CONTEXT_LABEL: Record<QuestionBlock["context"], string> = {
  check: "سؤال للتأكد من الفهم",
  quiz: "اختبار الإتقان",
  review: "مراجعة متباعدة",
  final: "الاختبار الشامل",
  warmup: "استرجاع قبل الموضوع",
};

export function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`;
}

/** "1 من 5 متقن" — mastered share for the header bar. */
export function masteredCount(state: TutorState): { mastered: number; total: number } {
  const all = Object.values(state.topics);
  return { mastered: all.filter((t) => t.status === "mastered" || t.status === "review_due").length, total: all.length };
}

// ── Page references: «[ص 12]» in the tutor's text become slide links ──

const PAGE_REF = /\[ص\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\]/g;

/**
 * Rewrite page citations as markdown links "#slide-N" the renderer turns into
 * buttons. Code (fenced blocks and `inline`) is left exactly as written.
 */
export function linkPageRefs(md: string): string {
  const parts = (md || "").split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(PAGE_REF, (_m, a: string, b?: string) => {
            const label = b ? `ص ${a}–${b}` : `ص ${a}`;
            return `[📄 ${label}](#slide-${a})`;
          }),
    )
    .join("");
}

export function slideFromHref(href: string | undefined | null): number | null {
  const m = /^#slide-(\d{1,3})$/.exec(href ?? "");
  return m ? Number(m[1]) : null;
}

// ── Focus timer (absolute times — correct after the page was closed) ──

export function nowWithSkew(skewMs: number, now = Date.now()): number {
  return now + skewMs;
}

/** Server clock − device clock, from a response's serverNow. */
export function clockSkew(serverNow: string | undefined, deviceNow = Date.now()): number {
  const t = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(t) ? t - deviceNow : 0;
}

export function remainingSec(f: FocusState, nowMs: number): number {
  if (f.mode === "idle" || !f.startedAt) return 0;
  const start = Date.parse(f.startedAt);
  if (!Number.isFinite(start)) return 0;
  const end = f.pausedAt ? Date.parse(f.pausedAt) : nowMs;
  const elapsed = Math.max(0, (end - start) / 1000 - (f.pausedTotalSec || 0));
  return Math.max(0, Math.round(f.durationSec - elapsed));
}

export function startFocus(f: FocusState, nowMs: number, mode: "focus" | "break" = "focus"): FocusState {
  return {
    ...f,
    mode,
    startedAt: new Date(nowMs).toISOString(),
    durationSec: (mode === "focus" ? f.focusMin : f.breakMin) * 60,
    pausedAt: null,
    pausedTotalSec: 0,
  };
}

export function pauseFocus(f: FocusState, nowMs: number): FocusState {
  if (f.mode === "idle" || f.pausedAt) return f;
  return { ...f, pausedAt: new Date(nowMs).toISOString() };
}

export function resumeFocus(f: FocusState, nowMs: number): FocusState {
  if (!f.pausedAt) return f;
  const paused = Math.max(0, (nowMs - Date.parse(f.pausedAt)) / 1000);
  return { ...f, pausedAt: null, pausedTotalSec: Math.round((f.pausedTotalSec || 0) + paused) };
}

export function stopFocus(f: FocusState): FocusState {
  return { ...f, mode: "idle", startedAt: null, durationSec: 0, pausedAt: null, pausedTotalSec: 0 };
}

/** What happens when a running period reaches zero. */
export function finishPeriod(f: FocusState, nowMs: number): { next: FocusState; completedFocus: boolean } {
  if (f.mode === "focus") {
    const next = startFocus({ ...f, completedFocus: (f.completedFocus || 0) + 1 }, nowMs, "break");
    return { next, completedFocus: true };
  }
  return { next: stopFocus(f), completedFocus: false };
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const DEFAULT_FOCUS: FocusState = {
  mode: "idle",
  startedAt: null,
  durationSec: 0,
  pausedAt: null,
  pausedTotalSec: 0,
  focusMin: 25,
  breakMin: 5,
  completedFocus: 0,
};

// ── Review cards from the lecture's key terms (reuses studyStore + flashcards) ──

export function lectureTerms(lecture: Lecture, topicId?: string): { term: string; definition: string }[] {
  const topics = topicId ? lecture.topics.filter((t) => t.id === topicId) : lecture.topics;
  const seen = new Set<string>();
  const out: { term: string; definition: string }[] = [];
  for (const t of topics) {
    for (const k of t.key_terms ?? []) {
      const key = k.term.trim().toLowerCase();
      if (!key || seen.has(key) || !k.definition) continue;
      seen.add(key);
      out.push(k);
    }
  }
  return out;
}

/** Merge new terms into an existing list without duplicates (by term). */
export function mergeTerms(
  existing: { term: string; definition: string }[],
  incoming: { term: string; definition: string }[],
): { merged: { term: string; definition: string }[]; added: number } {
  const keys = new Set(existing.map((t) => t.term.trim().toLowerCase()));
  const add = incoming.filter((t) => !keys.has(t.term.trim().toLowerCase()));
  return { merged: [...existing, ...add], added: add.length };
}
