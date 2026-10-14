// Scripted stand-in for /api/tutor/* (the dynamic study mode) in the Playwright
// suite. The real state machine lives in backend/services/tutor and is covered
// by backend/tests/test_tutor_flow.py; this only answers in the same shapes so
// the UI can be driven: upload → map → goal → lesson + check → feedback →
// topic summary, with versions, restore and the topic list.

const sessions = new Map(); // auth header → session

const LECTURE = {
  id: "Le2e000000000000000001",
  title: "هياكل البيانات: المكدس والطابور",
  fileName: "ds.pdf",
  fileHash: "e2e-hash",
  overview: "محاضرة عن المكدس والطابور وتطبيقاتهما.",
  pageCount: 6,
  estMinutes: 30,
  extraction: { textPages: 5, visionPages: [4], unreadablePages: [], visionSkipped: [], tables: 0, imagePages: 1 },
  topics: [
    { id: "t1", title: "المكدس (Stack)", summary: "بنية آخر داخل أول خارج", pages: [1, 3], objectives: ["يطبّق عمليات push و pop"], concepts: [], prerequisites: [], importance: 3, est_minutes: 15, key_terms: [{ term: "Stack", definition: "بنية LIFO" }, { term: "Push", definition: "إضافة عنصر في القمة" }] },
    { id: "t2", title: "الطابور (Queue)", summary: "بنية أول داخل أول خارج", pages: [4, 6], objectives: ["يميّز بين الطابور والمكدس"], concepts: [], prerequisites: ["t1"], importance: 2, est_minutes: 15, key_terms: [{ term: "Queue", definition: "بنية FIFO" }] },
  ],
};

const QUESTION = {
  id: "t1-q1",
  topic_id: "t1",
  format: "choice",
  skill: "predict",
  skill_label: "توقّع النتيجة",
  difficulty: 2,
  prompt: "بعد `push(1)` ثم `push(2)` ثم `pop()`، ما العنصر في القمة؟",
  pages: [2],
  has_hint: true,
  options: ["2", "1", "المكدس فارغ", "خطأ"],
};
const RIGHT = 1;

const progress = (status) => ({ status, score: status === "mastered" ? 0.9 : null, confidence: status === "mastered" ? 0.8 : 0, mastered: status === "mastered", missing: [], met: [], attempts: 0, correct: 0, reviewDue: null, lastReviewedAt: null, activeMinutes: 0 });

function newSession() {
  return {
    lecture: LECTURE,
    focus: { mode: "idle", startedAt: null, durationSec: 0, pausedAt: null, pausedTotalSec: 0, focusMin: 25, breakMin: 5, completedFocus: 0 },
    state: { phase: "overview", currentTopicId: null, stage: null, segment: null, segments: 2, pending: null, topics: { t1: progress("not_started"), t2: progress("not_started") }, reviewDue: [], points: 0, final: null, version: 1 },
    messages: [],
    seq: 0,
  };
}

function say(s, role, blocks, actions) {
  const m = { seq: ++s.seq, role, ts: new Date().toISOString(), blocks };
  if (actions) m.actions = actions;
  s.messages.push(m);
  return m;
}

function step(s, action, payload) {
  const out = [];
  const st = s.state;
  if (action === "next" && st.phase === "overview") {
    st.phase = "topic";
    st.currentTopicId = "t1";
    st.stage = "goal";
    st.topics.t1 = progress("in_progress");
    out.push(say(s, "tutor", [{ type: "goal", topicId: "t1", index: 1, total: 2, title: "المكدس (Stack)", why: "أساس لفهم استدعاء الدوال.", objectives: ["يطبّق عمليات push و pop"], prerequisites: "لا يحتاج إلى معرفة سابقة من هذه المحاضرة", weakPrerequisites: [], pages: [1, 3], estMinutes: 15 }], [{ id: "next", label: "ابدأ الشرح" }, { id: "test_out", label: "أعرف هذا الموضوع — اختبرني مباشرة" }]));
  } else if (action === "next" && st.stage === "goal") {
    st.stage = "check";
    st.segment = 0;
    st.pending = { type: "question", context: "check", question: QUESTION, index: null, total: null, attempts: 0, hints: 0 };
    out.push(say(s, "tutor", [{ type: "lesson", topicId: "t1", segment: 0, total: 2, title: "الفكرة", md: "المكدس يعمل بمبدأ **آخر داخل أول خارج** [ص 2].\n\n```python\nstack.append(1)\n```", pages: [2] }]));
    out.push(say(s, "tutor", [{ type: "question", context: "check", question: QUESTION }], [{ id: "hint", label: "تلميح" }, { id: "reexplain", label: "اشرحه بطريقة ثانية" }]));
  } else if (action === "answer") {
    if (!st.pending || payload.questionId !== QUESTION.id) return { error: [409, "هذا السؤال لم يعد مفتوحاً."] };
    out.push(say(s, "student", [{ type: "answer", questionId: QUESTION.id, text: QUESTION.options[payload.choice], choice: payload.choice, confidence: payload.confidence ?? null }]));
    st.pending.attempts += 1;
    if (payload.choice === RIGHT) {
      st.pending = null;
      out.push(say(s, "tutor", [{ type: "feedback", questionId: QUESTION.id, correct: true, verdict: "correct", md: "لأن آخر عنصر دخل هو أول من يخرج [ص 2].", misconception: "" }], [{ id: "next", label: "التالي" }]));
    } else {
      out.push(say(s, "tutor", [{ type: "feedback", questionId: QUESTION.id, correct: false, verdict: "incorrect", retry: true, md: "هذا يحدث لو كان طابوراً لا مكدساً.", misconception: "خلط المكدس بالطابور", confidence: payload.confidence ?? null, confidentError: payload.confidence === "sure" }, { type: "text", md: "فكّر فيها مرة ثانية وجرّب." }], [{ id: "hint", label: "تلميح" }, { id: "reveal", label: "أظهر الإجابة" }]));
    }
  } else if (action === "report") {
    if (payload.questionId !== QUESTION.id) return { error: [400, "لا يمكن الإبلاغ عن سؤال لم يُعرض عليك."] };
    s.reported = payload.reason;
    out.push(say(s, "student", [{ type: "request", text: "إبلاغ عن السؤال" }]));
    st.pending = null;
    out.push(say(s, "tutor", [{ type: "text", md: "شكراً — استبعدت هذا السؤال." }], [{ id: "next", label: "التالي" }]));
  } else if (action === "hint") {
    out.push(say(s, "student", [{ type: "request", text: "تلميح من فضلك" }]));
    out.push(say(s, "tutor", [{ type: "hint", md: "أي عنصر دخل آخراً؟", index: 1, total: 2 }]));
  } else if (action === "next" && st.stage === "check" && !st.pending) {
    st.stage = "closed";
    st.topics.t1 = { ...progress("mastered"), attempts: 4, correct: 4, reviewDue: "2026-10-15" };
    out.push(say(s, "tutor", [{ type: "topic_summary", topicId: "t1", title: "المكدس (Stack)", mastered: true, score: 0.9, confidence: 0.8, met: [], missing: [], strengths: ["push", "pop"], toReview: [], reviewDue: "2026-10-15", note: "", keyTerms: LECTURE.topics[0].key_terms }], [{ id: "next", label: "الموضوع التالي" }, { id: "save_cards", label: "أضف مصطلحاته لبطاقات المراجعة" }]));
  } else if (action === "next" && st.pending) {
    return { error: [400, "أجب عن السؤال أولاً، أو اطلب تلميحاً."] };
  } else {
    return { error: [400, "إجراء غير مدعوم في الخادم الوهمي."] };
  }
  st.version += 1;
  return { state: st, messages: out };
}

function publicSession(s) {
  return { lecture: s.lecture, state: s.state, messages: s.messages, focus: { ...s.focus, serverNow: new Date().toISOString() } };
}

/** Returns true when the request was handled. */
export function handleTutor(req, p, body, send, res) {
  if (!p.startsWith("/api/tutor/")) return false;
  const key = String(req.headers.authorization);
  let s = sessions.get(key);
  if (p === "/api/tutor/lectures" && req.method === "POST") {
    s = s ?? newSession();
    if (!sessions.has(key)) {
      sessions.set(key, s);
      say(s, "tutor", [{ type: "text", md: "أهلاً 👋 قرأت المحاضرة ورتّبتها في موضوعات." }]);
      say(s, "tutor", [{ type: "map", title: LECTURE.title, overview: LECTURE.overview, estMinutes: 30, topics: LECTURE.topics.map(({ id, title, pages, est_minutes, importance }) => ({ id, title, pages, est_minutes, importance })) }, { type: "notice", tone: "info", md: "قرأتُ 1 صفحة مصوّرة بتحليل الصور (ص 4)." }], [{ id: "next", label: "ابدأ الموضوع الأول" }]);
      send(res, 200, { ...publicSession(s), reused: null });
    } else send(res, 200, { ...publicSession(s), reused: "mine" });
    return true;
  }
  if (p === "/api/tutor/lectures" && req.method === "GET") {
    const list = s ? [{ id: LECTURE.id, title: LECTURE.title, fileName: LECTURE.fileName, fileHash: LECTURE.fileHash, pageCount: 6, topics: 2, estMinutes: 30, phase: s.state.phase, counts: { mastered: s.state.topics.t1.status === "mastered" ? 1 : 0, review_due: 0, not_started: 1, in_progress: 0, needs_review: 0 }, reviewDue: 0, finalScore: null, updatedAt: null }] : [];
    send(res, 200, { lectures: list });
    return true;
  }
  if (!s) {
    send(res, 404, { detail: "المحاضرة غير موجودة." });
    return true;
  }
  if (p.endsWith("/focus") && req.method === "PUT") {
    s.focus = { ...body };
    send(res, 200, { focus: { ...s.focus, serverNow: new Date().toISOString() } });
    return true;
  }
  if (p.endsWith("/step") && req.method === "POST") {
    if (body?.version !== s.state.version) {
      send(res, 409, { detail: "تقدّمت الجلسة من نافذة أو جهاز آخر — حدّثنا الصفحة لتكمل من آخر نقطة." });
      return true;
    }
    const r = step(s, body.action, body.payload ?? {});
    if (r.error) send(res, r.error[0], { detail: r.error[1] });
    else send(res, 200, r);
    return true;
  }
  if (req.method === "GET") {
    send(res, 200, publicSession(s));
    return true;
  }
  if (req.method === "DELETE") {
    sessions.delete(key);
    send(res, 200, { success: true });
    return true;
  }
  return false;
}
