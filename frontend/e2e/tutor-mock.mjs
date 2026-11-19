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
const FINAL_Q = { id: "t1-final1", topic_id: "t1", format: "choice", skill: "apply", skill_label: "تطبيق", difficulty: 2, prompt: "ما الذي يُرجعه `pop()` بعد `push(4)`؟", pages: [2], has_hint: false, options: ["لا شيء", "4", "خطأ", "0"] };

// The new formats (questions.py): shown as the backend's public_question shows them.
const QUIZ = [
  { q: { id: "t1-order", topic_id: "t1", format: "order", skill: "apply", skill_label: "تطبيق", difficulty: 2, prompt: "رتّب العمليات لتبقى `2` في القمة:", pages: [2], has_hint: false, items: ["pop()", "push(1)", "push(2)"] },
    right: (p) => JSON.stringify(p.order) === JSON.stringify([1, 2, 0]),
    reveal: { correctOrder: ["push(1)", "push(2)", "pop()"] },
    text: (p) => p.order.map((i) => ["pop()", "push(1)", "push(2)"][i]).join(" ← ") },
  { q: { id: "t1-match", topic_id: "t1", format: "match", skill: "recall", skill_label: "تذكّر", difficulty: 1, prompt: "وصّل كل عملية بما تفعله:", pages: [2], has_hint: false, lefts: ["push", "pop"], rights: ["يسحب من القمة", "يضيف للقمة"] },
    right: (p) => JSON.stringify(p.matches) === JSON.stringify([1, 0]),
    reveal: { correctPairs: [{ left: "push", right: "يضيف للقمة" }, { left: "pop", right: "يسحب من القمة" }] },
    text: (p) => p.matches.map((j, i) => `${["push", "pop"][i]} ← ${["يسحب من القمة", "يضيف للقمة"][j]}`).join("؛ ") },
  { q: { id: "t1-fill", topic_id: "t1", format: "fill", skill: "recall", skill_label: "تذكّر", difficulty: 1, prompt: "البنية التي تعمل بمبدأ LIFO اسمها ____", pages: [1], has_hint: false },
    right: (p) => /^(ال)?مكدس$|^stack$/i.test(String(p.text || "").trim()),
    reveal: { modelAnswer: "المكدس" },
    text: (p) => p.text },
];

const progress = (status) => ({ status, score: status === "mastered" ? 0.9 : null, confidence: status === "mastered" ? 0.8 : 0, mastered: status === "mastered", missing: [], met: [], attempts: 0, correct: 0, reviewDue: null, lastReviewedAt: null, activeMinutes: 0 });

function newSession() {
  return {
    lecture: LECTURE,
    focus: { mode: "idle", startedAt: null, durationSec: 0, pausedAt: null, pausedTotalSec: 0, focusMin: 25, breakMin: 5, completedFocus: 0 },
    state: { phase: "overview", currentTopicId: null, stage: null, segment: null, segments: 2, pending: null, topics: { t1: progress("not_started"), t2: progress("not_started") }, reviewDue: [], points: 0, final: null, version: 1 },
    messages: [],
    mistakes: [],
    seq: 0,
  };
}

// Which part of the lecture a message belongs to (engine.section_of).
const sectionOf = (st) => (st.phase === "topic" && st.currentTopicId ? `topic:${st.currentTopicId}` : ["final_ready", "final", "done"].includes(st.phase) ? "final" : st.phase);

function say(s, role, blocks, actions) {
  const m = { seq: ++s.seq, role, ts: new Date().toISOString(), section: sectionOf(s.state), blocks };
  if (actions) m.actions = actions;
  s.messages.push(m);
  return m;
}

// A lesson diagram as the backend sends it (services/tutor/visuals.py).
const DIAGRAM = {
  kind: "diagram",
  caption: "الدفع يضيف للأعلى والسحب يأخذ من الأعلى",
  diagram: {
    type: "flow",
    direction: "lr",
    nodes: [
      { id: "push", label: "push", shape: "box" },
      { id: "s", label: "المكدس", shape: "db" },
      { id: "pop", label: "pop", shape: "box" },
    ],
    edges: [
      { from: "push", to: "s", label: "يضيف للأعلى", reply: false },
      { from: "s", to: "pop", label: "يسحب الأعلى", reply: false },
    ],
  },
};

const jobs = new Map();

function step(s, action, payload) {
  const out = [];
  const st = s.state;
  if (action === "next" && st.phase === "overview") {
    st.phase = "topic";
    st.currentTopicId = "t1";
    st.stage = "goal";
    st.topics.t1 = progress("in_progress");
    // concepts with how the student does on each and when its memory is due (engine._concept_chips)
    const concepts = [
      { id: "t1c1", name: "مبدأ LIFO", level: "unknown", attempts: 0, due: null, recall: null },
      { id: "t1c2", name: "عمليتا push و pop", level: "unknown", attempts: 0, due: null, recall: null },
    ];
    out.push(say(s, "tutor", [{ type: "goal", topicId: "t1", index: 1, total: 2, title: "المكدس (Stack)", why: "أساس لفهم استدعاء الدوال.", objectives: ["يطبّق عمليات push و pop"], prerequisites: "لا يحتاج إلى معرفة سابقة من هذه المحاضرة", weakPrerequisites: [], pages: [1, 3], estMinutes: 15, concepts }], [{ id: "next", label: "ابدأ الشرح" }, { id: "test_out", label: "أعرف هذا الموضوع — اختبرني مباشرة" }]));
  } else if (action === "next" && st.stage === "goal" && st.currentTopicId === "t2") {
    // a one-part lesson with a step-by-step simulation and the lesson's video (visuals.py)
    st.stage = "explain";
    st.segment = 0;
    const steps = { kind: "steps", caption: "الطابور بعد كل عملية", layout: "row", steps: [
      { caption: "enqueue(1)", items: ["1"] },
      { caption: "enqueue(2)", items: ["1", "2"] },
      { caption: "dequeue()", items: ["2"] },
    ] };
    out.push(say(s, "tutor", [{ type: "lesson", topicId: "t2", segment: 0, total: 1, title: "الطابور", md: "يدخل العنصر من الخلف ويخرج من الأمام [ص 4].", pages: [4], visual: steps,
      video: { id: "abc123XYZ00", title: "شرح الطابور Queue", channel: "قناة تعليمية", seconds: 420 } }], [{ id: "next", label: "التالي" }]));
  } else if (action === "next" && st.stage === "goal") {
    st.stage = "check";
    st.segment = 0;
    st.pending = { type: "question", context: "check", question: QUESTION, index: null, total: null, attempts: 0, hints: 0 };
    // a lesson part in teaching pieces, each saying where it comes from (engine.show_segment)
    const parts = [
      { role: "idea", origin: "lecture", md: "المكدس يعمل بمبدأ **آخر داخل أول خارج** [ص 2].", pages: [2] },
      { role: "code", origin: "lecture", md: "```python\nstack.append(1)\n```", pages: [2] },
      { role: "real_world", origin: "added", md: "مثل كومة الأطباق: آخر طبق يوضع هو أول طبق يُرفع.", pages: [] },
      { role: "summary", origin: "lecture", md: "آخر عنصر يدخل هو أول عنصر يخرج.", pages: [2] },
    ];
    out.push(say(s, "tutor", [{ type: "lesson", topicId: "t1", segment: 0, total: 2, title: "الفكرة", md: parts.map((p) => p.md).join("\n\n"), parts, reviewed: true, pages: [2], visual: DIAGRAM }]));
    out.push(say(s, "tutor", [{ type: "question", context: "check", question: QUESTION }], [{ id: "hint", label: "تلميح" }, { id: "reexplain", label: "اشرحه بطريقة ثانية" }]));
  } else if (action === "test_out" && st.stage === "goal") {
    // "I know this, test me": the mastery quiz, one question of each new format
    st.stage = "quiz";
    s.quiz = 0;
    st.pending = { type: "question", context: "quiz", question: QUIZ[0].q, index: 1, total: QUIZ.length, attempts: 0, hints: 0 };
    out.push(say(s, "tutor", [{ type: "question", context: "quiz", index: 1, total: QUIZ.length, question: QUIZ[0].q }]));
  } else if (action === "answer" && st.stage === "quiz") {
    const item = QUIZ[s.quiz];
    if (!st.pending || payload.questionId !== item.q.id) return { error: [409, "هذا السؤال لم يعد مفتوحاً."] };
    const ok = item.right(payload);
    st.pending = null;
    out.push(say(s, "student", [{ type: "answer", questionId: item.q.id, text: item.text(payload), confidence: payload.confidence ?? null }]));
    out.push(say(s, "tutor", [{ type: "feedback", questionId: item.q.id, correct: ok, verdict: ok ? "correct" : "incorrect", md: "", misconception: "", explanation: "", ...item.reveal }], [{ id: "next", label: "السؤال التالي" }]));
  } else if (action === "next" && st.stage === "quiz" && !st.pending && s.quiz < QUIZ.length - 1) {
    s.quiz += 1;
    const q = QUIZ[s.quiz].q;
    st.pending = { type: "question", context: "quiz", question: q, index: s.quiz + 1, total: QUIZ.length, attempts: 0, hints: 0 };
    out.push(say(s, "tutor", [{ type: "question", context: "quiz", index: s.quiz + 1, total: QUIZ.length, question: q }]));
  } else if (action === "answer" && st.phase === "final") {
    // the final exam: one question here, then the report
    out.push(say(s, "student", [{ type: "answer", questionId: FINAL_Q.id, text: FINAL_Q.options[payload.choice], confidence: payload.confidence ?? null }]));
    finishFinal(s, out, payload.choice === RIGHT ? 1 : 0);
  } else if (action === "answer" && st.phase === "review") {
    // practising a mistake: a right answer closes it in the notebook
    out.push(say(s, "student", [{ type: "answer", questionId: QUESTION.id, text: QUESTION.options[payload.choice], confidence: payload.confidence ?? null }]));
    const ok = payload.choice === RIGHT;
    if (ok) s.mistakes.forEach((m) => (m.fixed = true));
    st.pending = null;
    st.phase = "topic";
    out.push(say(s, "tutor", [{ type: "feedback", questionId: QUESTION.id, correct: ok, verdict: ok ? "correct" : "incorrect", md: "", misconception: "", correctIndex: RIGHT, correctText: QUESTION.options[RIGHT] }], [{ id: "next", label: "التالي" }]));
  } else if (action === "answer") {
    if (!st.pending || payload.questionId !== QUESTION.id) return { error: [409, "هذا السؤال لم يعد مفتوحاً."] };
    out.push(say(s, "student", [{ type: "answer", questionId: QUESTION.id, text: QUESTION.options[payload.choice], choice: payload.choice, confidence: payload.confidence ?? null }]));
    st.pending.attempts += 1;
    if (st.pending.attempts === 1 && payload.choice !== RIGHT) {
      s.mistakes.push({ qid: QUESTION.id, topicId: "t1", topicTitle: "المكدس (Stack)", kind: "check", prompt: QUESTION.prompt, format: "choice", answer: QUESTION.options[payload.choice], misconception: "خلط المكدس بالطابور", concepts: ["مبدأ LIFO"], ts: new Date().toISOString(), fixed: false, correctIndex: RIGHT, correctText: QUESTION.options[RIGHT], explanation: "آخر عنصر دخل هو أول من يخرج [ص 2]." });
    }
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
    out.push(say(s, "tutor", [{ type: "topic_summary", topicId: "t1", title: "المكدس (Stack)", mastered: true, score: 0.9, confidence: 0.8, met: [], missing: [], strengths: ["push", "pop"], toReview: [], reviewDue: "2026-10-15", note: "", keyTerms: LECTURE.topics[0].key_terms }], [{ id: "next", label: "الموضوع التالي" }, { id: "save_cards", label: "أضف مصطلحاته لبطاقات المراجعة" }, { id: "final", label: "ابدأ الاختبار الشامل" }, { id: "final", label: "محاكاة اختبار حقيقي بوقت محدد", payload: { timed: true } }]));
  } else if (action === "goto" && payload.topicId === "t2") {
    // the move happens first, so the request is filed with the topic it opens
    st.phase = "topic";
    st.currentTopicId = "t2";
    st.stage = "goal";
    st.segment = null;
    st.pending = null;
    st.topics.t2 = progress("in_progress");
    out.push(say(s, "student", [{ type: "request", text: "انتقل إلى «الطابور (Queue)»" }]));
    out.push(say(s, "tutor", [{ type: "goal", topicId: "t2", index: 2, total: 2, title: "الطابور (Queue)", why: "يرتّب المهام بالدور.", objectives: ["يميّز بين الطابور والمكدس"], prerequisites: "المكدس", weakPrerequisites: [], pages: [4, 6], estMinutes: 15 }], [{ id: "next", label: "ابدأ الشرح" }]));
  } else if (action === "deep_dive") {
    // engine.handle_deep_dive: one concept, its own page in teaching pieces
    if (st.pending && st.pending.context !== "check") return { error: [400, "أكمل السؤال الحالي أولاً، ثم تعمّق في المفهوم."] };
    const name = payload.conceptId === "t1c1" ? "مبدأ LIFO" : "عمليتا push و pop";
    out.push(say(s, "student", [{ type: "request", text: `تعمّق في: ${name}` }]));
    out.push(say(s, "tutor", [{
      type: "deep_dive", conceptId: payload.conceptId, topicId: "t1", topicTitle: "المكدس (Stack)", name, definition: "آخر عنصر يدخل هو أول عنصر يخرج.",
      parts: [
        { role: "how", origin: "lecture", md: "كل push يضع عنصراً في القمة، وكل pop يأخذ من القمة [ص 2].", pages: [2] },
        { role: "real_world", origin: "added", md: "زر التراجع في المحرر: آخر تعديل يُلغى أولاً.", pages: [] },
        { role: "summary", origin: "lecture", md: "القمة مكان الإضافة والسحب.", pages: [2] },
      ],
      reviewed: true,
      related: [{ id: "t1c2", name: "عمليتا push و pop" }],
    }]));
  } else if (action === "practice_mistakes") {
    if (!s.mistakes.some((m) => !m.fixed)) return { error: [400, "ما عندك أخطاء مفتوحة الآن — كل ما أخطأت فيه صحّحته بعدها."] };
    out.push(say(s, "student", [{ type: "request", text: "تدرّب على أخطائي" }]));
    s.returnPending = st.pending;
    st.phase = "review";
    st.pending = { type: "question", context: "review", question: QUESTION, index: null, total: null, attempts: 0, hints: 0 };
    out.push(say(s, "tutor", [{ type: "text", md: "**تدريب على أخطائك (1)**" }, { type: "question", context: "review", question: QUESTION }]));
  } else if (action === "final") {
    // the timed exam ends in 3 seconds here, so the time running out can be seen
    out.push(say(s, "student", [{ type: "request", text: payload.timed ? "ابدأ محاكاة اختبار بوقت" : "ابدأ الاختبار الشامل" }]));
    st.phase = "final";
    st.currentTopicId = null;
    st.final = { status: "running", index: 0, total: 2, attempt: 1, timed: !!payload.timed, minutes: payload.timed ? 10 : undefined, deadline: payload.timed ? new Date(Date.now() + 3000).toISOString() : null };
    st.pending = { type: "question", context: "final", question: FINAL_Q, index: 1, total: 2, attempts: 0, hints: 0 };
    out.push(say(s, "tutor", [{ type: "text", md: payload.timed ? "**محاكاة اختبار حقيقي** · سؤالان في 10 دقائق." : "**الاختبار الشامل** · سؤالان." }, { type: "question", context: "final", index: 1, total: 2, question: FINAL_Q }]));
  } else if (action === "finish_final") {
    if (st.phase !== "final" || !st.final?.deadline || Date.parse(st.final.deadline) > Date.now()) return { error: [400, "ما زال في وقت الاختبار بقية — أكمل الإجابة."] };
    out.push(say(s, "tutor", [{ type: "notice", tone: "warn", md: "انتهى وقت الاختبار. 2 سؤال لم تُجب عنه يُحسب بدون درجة — مثل الاختبار الحقيقي." }]));
    finishFinal(s, out, 0);
  } else if (action === "ask") {
    // engine.handle_ask: the passages the student selected travel with the question
    const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
    out.push(say(s, "student", [{ type: "text", md: payload.text, ...(quotes.length ? { quotes } : {}) }]));
    const md = st.pending
      ? "ما راح أعطيك الجواب عشان تجرّبه بنفسك — ركّز على أي عنصر دخل آخراً [ص 2]."
      : `سألت عن ${quotes.length} مقطع من الدرس: المكدس يُخرج آخر عنصر دخل [ص 2].`;
    out.push(say(s, "tutor", [{ type: "answer_text", md, pages: [2], inLecture: true }]));
  } else if (action === "next" && st.pending) {
    return { error: [400, "أجب عن السؤال أولاً، أو اطلب تلميحاً."] };
  } else {
    return { error: [400, "إجراء غير مدعوم في الخادم الوهمي."] };
  }
  st.version += 1;
  st.section = sectionOf(st);
  st.mistakesOpen = s.mistakes.filter((m) => !m.fixed).length;
  return { state: st, messages: out };
}

function finishFinal(s, out, right) {
  const st = s.state;
  st.phase = "done";
  st.pending = null;
  st.final = { ...st.final, status: "done", index: 2, result: { score: right / 2 } };
  out.push(say(s, "tutor", [{ type: "final_report", score: right / 2, attempt: 1, topics: [{ topicId: "t1", title: "المكدس (Stack)", score: right / 2, questions: 2, correct: right, why: [], missedConcepts: [], misconceptions: [] }], plan: [], blooms: {} }], [{ id: "final", label: "اختبار شامل جديد" }]));
}

function publicSession(s) {
  return { lecture: s.lecture, state: { ...s.state, section: sectionOf(s.state) }, messages: s.messages, focus: { ...s.focus, serverNow: new Date().toISOString() } };
}

/** Returns true when the request was handled. */
export function handleTutor(req, p, body, send, res, raw) {
  if (!p.startsWith("/api/tutor/")) return false;
  const key = String(req.headers.authorization);
  let s = sessions.get(key);
  // A file named "new-lecture.pdf" is prepared in the background (202 + job),
  // like a lecture nobody uploaded before; its job is ready after 2 polls.
  const isNew = raw && raw.toString("latin1").includes('filename="new-lecture.pdf"');
  if (p === "/api/tutor/lectures" && req.method === "POST" && isNew && !jobs.get(key)?.done) {
    const job = jobs.get(key) ?? { polls: 0, done: false };
    jobs.set(key, job);
    send(res, 202, { job: { id: LECTURE.id, fileName: "new-lecture.pdf", status: "working", stage: "reading", done: 0, total: 1, error: null, stalled: false } });
    return true;
  }
  if (p.endsWith("/job") && req.method === "GET" && jobs.has(key)) {
    const job = jobs.get(key);
    job.polls += 1;
    if (job.polls >= 3) {
      job.done = true;
      if (!sessions.has(key)) {
        s = newSession();
        sessions.set(key, s);
        say(s, "tutor", [{ type: "map", title: LECTURE.title, overview: LECTURE.overview, estMinutes: 30, topics: LECTURE.topics.map(({ id, title, pages, est_minutes, importance }) => ({ id, title, pages, est_minutes, importance })) }], [{ id: "next", label: "ابدأ الموضوع الأول" }]);
      }
      send(res, 200, { job: { id: LECTURE.id, status: "ready", stalled: false } });
    } else {
      const stage = job.polls === 1 ? "structure" : "lesson";
      send(res, 200, { job: { id: LECTURE.id, fileName: "new-lecture.pdf", status: "working", stage, done: 0, total: 2, error: null, stalled: false } });
    }
    return true;
  }
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
  if (p.endsWith("/mistakes") && req.method === "GET") {
    const open = s.mistakes.filter((m) => !m.fixed);
    send(res, 200, { mistakes: [...open, ...s.mistakes.filter((m) => m.fixed)], open: open.length });
    return true;
  }
  if (p.endsWith("/visual") && req.method === "GET") {
    send(res, 200, { visual: DIAGRAM });
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
