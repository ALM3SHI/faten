// Fake Faten backend for the Playwright suite — answers the endpoints the
// pages call with fixed fixtures. Nothing reaches Gemini or Firestore.
//
//   node e2e/mock-server.mjs            (port 8787, or MOCK_PORT)
//
// Requests are logged in memory; GET /__requests returns them so a test
// can assert what the app sent.

import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8787);
const requests = [];
const prefs = { lectures: true, attendance: true, exams: true };

const COMPLETED = [
  { code: "CS1101", nameAr: "مقدمة في البرمجة", nameEn: "Intro to Programming", creditHours: 4, grade: "A+", gradePoints: 4, semester: "الفصل الأول 1444", semesterStatus: "completed" },
  { code: "MATH1101", nameAr: "تفاضل وتكامل", nameEn: "Calculus", creditHours: 4, grade: "B+", gradePoints: 3.5, semester: "الفصل الأول 1444", semesterStatus: "completed" },
  { code: "CS1102", nameAr: "برمجة متقدمة", nameEn: "Advanced Programming", creditHours: 4, grade: "A", gradePoints: 3.75, semester: "الفصل الثاني 1444", semesterStatus: "completed" },
  { code: "CS2201", nameAr: "هياكل البيانات", nameEn: "Data Structures", creditHours: 3, grade: "B", gradePoints: 3, semester: "الفصل الثاني 1444", semesterStatus: "completed" },
];
const CURRENT = [
  { code: "CS3301", nameAr: "الذكاء الاصطناعي", nameEn: "Artificial Intelligence", creditHours: 3, grade: null, gradePoints: null, semester: "الفصل الأول 1448", semesterStatus: "in_progress" },
  { code: "CS3302", nameAr: "قواعد البيانات", nameEn: "Databases", creditHours: 3, grade: null, gradePoints: null, semester: "الفصل الأول 1448", semesterStatus: "in_progress" },
];

export const WORKSPACE = {
  success: true,
  profile: {
    basic: { name: "عمر", major: "علوم الحاسب", studentId: "441000000", totalPlanHours: 132 },
    goals: { currentGpa: 3.56, targetGpa: 3.75 },
    preferences: {},
    lastUpdated: "2026-10-01T08:00:00.000Z",
  },
  transcript: {
    name: "عمر", nameEn: "Omar", studentId: "441000000", university: "جامعة أم القرى", major: "علوم الحاسب",
    faculty: "الحاسبات", degree: "بكالوريوس", gpa: 3.56, earnedHours: 15, planHours: 132,
    completedCourses: COMPLETED, currentCourses: CURRENT, confidence: 95, lastUpdated: "2026-10-01T08:00:00.000Z",
  },
  schedule: {
    schedule: [
      { id: "s1", courseCode: "CS3301", courseName: "الذكاء الاصطناعي", day: "الأحد", startTime: "08:00", endTime: "09:40", room: "A-101" },
      { id: "s2", courseCode: "CS3302", courseName: "قواعد البيانات", day: "الثلاثاء", startTime: "10:00", endTime: "11:40", room: "B-204" },
    ],
    lastUpdated: "2026-10-01T08:00:00.000Z",
  },
  plan: { plan: null, model: null, generatedAt: null, completed: [] },
  chats: { threads: [] },
  achievements: {},
  notifications: [],
};

const ANALYTICS = {
  target_analysis: { required: 3.78, status: "feasible", message: "", next_hours: 15 },
  chart_data: [
    { semester: "الفصل الأول 1444", term_gpa: 3.75, cumulative_gpa: 3.75 },
    { semester: "الفصل الثاني 1444", term_gpa: 3.43, cumulative_gpa: 3.6 },
  ],
  advisor_recommendation: { hours: "15", tone: "steady", headline: "", body: "" },
  strengths_radar: [],
  high_roi_courses: [
    { code: "CS3301", name: "الذكاء الاصطناعي", credits: 3, max_point_contribution: 12, projected_delta: 0.06, label: "أعلى أثر على معدلك" },
  ],
  agentic_action: { active: false, intervention_id: "", trigger: "none", severity: "low", headline: "", body: "", scheduled_tasks: [], reasoning: [] },
  gpa_trend_analysis: "معدلك مستقر بين الفصلين مع تحسن في مواد البرمجة.",
};

const STUDY_PACK = {
  title: "مقدمة في الشبكات العصبية",
  summary: ["الشبكة العصبية تتكون من طبقات من العصبونات.", "دالة التنشيط تضيف اللاخطية."],
  key_terms: [
    { term: "Neuron", definition: "وحدة حسابية تجمع المدخلات الموزونة وتمررها لدالة تنشيط." },
    { term: "Activation function", definition: "دالة تحدد خرج العصبون مثل ReLU." },
    { term: "Backpropagation", definition: "خوارزمية لحساب المشتقات وتحديث الأوزان." },
  ],
  quiz: [
    { question: "ما وظيفة دالة التنشيط؟", options: ["إضافة اللاخطية", "تخزين البيانات", "قراءة الملف", "لا شيء"], answer_index: 0, explanation: "تضيف اللاخطية للشبكة." },
  ],
};

const CHAT_REPLY = "موعد اختبارك القادم في مادة الذكاء الاصطناعي يوم الأحد. بالتوفيق!";

// Questions with a canned sourced answer: [match, reply, actions].
const STUDY_REG = "لائحة الدراسة والاختبارات للمرحلة الجامعية (القواعد التنفيذية لجامعة أم القرى)";
const SOURCED_REPLIES = [
  [
    "الحرمان",
    "يُحرم الطالب إذا زاد غيابه بدون عذر عن 15% من المحاضرات.\n📄 المرجع: المادة (14) — لائحة الدراسة والاختبارات",
    [{ tool: "search_regulations", args: { query: "الحرمان" }, result: { success: true, found: true, results: [
      { document: STUDY_REG, article: "المادة 14", heading: "الفصل الخامس: الإجراءات الأكاديمية — المادة 14", issued: "الإصدار الأول — 1444هـ", source_url: "https://uqu.edu.sa/dadregis/151795",
        text: "يلتزم الطالب بحضور الوحدة الدراسية – حضورياً أو افتراضياً – ويحرم من دخول الاختبار النهائي إذا زادت نسبة غيابه بدون عذر عن (15%)." },
    ] } }],
  ],
  [
    "النهائية",
    "الاختبارات النهائية للفصل الأول من 27 ديسمبر 2026 إلى 7 يناير 2027.",
    [{ tool: "get_calendar_info", args: { query_type: "search", query: "الاختبارات النهائية" }, result: { success: true, message: "", data: [
      { title: "الاختبارات النهائية", date: "27 Dec 2026 - 07 Jan 2027", hijri: "18/07 - 29/07/1448", type: "exam" },
    ], source: { document: "التقويم الأكاديمي لجامعة أم القرى 1448هـ", url: "https://uqu.edu.sa/App/AcademicCalendar" } } }],
  ],
];

const ADMIN_OVERVIEW = {
  users: { total: 128, new_7d: 9, new_30d: 31 },
  usage: { active_today: 17, active_7d: 54, requests_today: 96 },
  devices: 23,
  feedback: {
    days: 30, total: 40, up: 34, down: 6, satisfaction: 85,
    by_tool: { search_regulations: { up: 12, down: 4 }, get_upcoming_exams: { up: 9, down: 1 }, "(بدون أداة)": { up: 13, down: 1 } },
    recent_down: [{ createdAt: "2026-10-12T09:30:00+00:00", question: "كم مرة اقدر اأجل؟", answer: "تقدر تأجل فصلين متتاليين…", comment: "الجواب ناقص", tools: ["search_regulations"] }],
  },
  reported_reviews: [{ code: "CS1101", course: "مقدمة في البرمجة", id: "a".repeat(20), tip: "الدكتور ما يشرح", reports: 3, hidden: true, updatedAt: "2026-10-01" }],
};

function chatReply(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const q = String(body?.message ?? msgs.filter((m) => m?.role === "user").at(-1)?.content ?? "");
  const hit = SOURCED_REPLIES.find(([m]) => q.includes(m));
  return hit ? { message: hit[1], actions: hit[2] } : { message: CHAT_REPLY, actions: [] };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": req.headers.origin || "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  };
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const raw = await readBody(req);
  const isJson = (req.headers["content-type"] || "").includes("application/json");
  let body = null;
  if (isJson && raw.length) {
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      body = null;
    }
  }
  if (url.pathname !== "/__requests") {
    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization || null, body });
  }

  const p = url.pathname;
  if (p === "/__requests") return send(res, 200, requests);
  if (p === "/__reset") {
    requests.length = 0;
    return send(res, 200, { ok: true });
  }
  if (p === "/health") return send(res, 200, { status: "ok" });
  if (!req.headers.authorization && p.startsWith("/api/")) {
    return send(res, 401, { detail: "سجّل دخولك أولاً." });
  }
  if (p === "/api/workspace" && req.method === "GET") return send(res, 200, WORKSPACE);
  if (p.startsWith("/api/workspace/")) return send(res, 200, { success: true });
  if (p === "/api/analytics/dashboard") return send(res, 200, ANALYTICS);
  if (p === "/api/news") return send(res, 200, { items: [{ title: "بدء التسجيل في المقررات الصيفية", url: "https://uqu.edu.sa/", date: "2026-10-10" }] });
  if (p === "/api/pomodoro/stats") return send(res, 200, { todaySessions: 2, totalSessions: 40, totalFocusMinutes: 1000, currentStreak: 4, longestStreak: 9 });
  if (p === "/api/pomodoro/log") return send(res, 200, { success: true });
  if (p === "/api/memory") return send(res, 200, { items: [] });
  if (p === "/api/study/pdf") return send(res, 200, STUDY_PACK);
  if (p === "/api/notifications/prefs") {
    // Echo the saved prefs without keeping them, so parallel tests stay independent.
    return send(res, 200, { success: true, prefs: req.method === "PUT" && body ? { ...prefs, ...body } : prefs });
  }
  if (p.startsWith("/api/notifications/")) return send(res, 200, { success: true, id: "device1", sent: 1 });
  if (p.startsWith("/api/admin/")) {
    // Only the e2e admin account (uid e2e-admin) passes, like ADMIN_EMAILS on the server.
    if (!String(req.headers.authorization).endsWith("e2e-admin")) return send(res, 403, { detail: "هذي الصفحة لمشرف فطن فقط." });
    if (p === "/api/admin/me") return send(res, 200, { admin: true });
    if (p === "/api/admin/overview") return send(res, 200, ADMIN_OVERVIEW);
    return send(res, 200, { success: true });
  }
  if (p === "/api/chat/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
    const reply = chatReply(body);
    res.write(`data: ${JSON.stringify({ type: "status", tool: reply.actions[0]?.tool ?? "get_upcoming_exams" })}\n\n`);
    for (const word of reply.message.split(" ")) res.write(`data: ${JSON.stringify({ type: "token", text: word + " " })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done", response: { success: true, message: reply.message, conversationId: "conv-e2e", actions: reply.actions, client_actions: [] } })}\n\n`);
    return res.end();
  }
  if (p === "/api/chat") return send(res, 200, { success: true, ...chatReply(body), conversationId: "conv-e2e", client_actions: [] });
  return send(res, 404, { detail: "غير موجود في الخادم الوهمي." });
});

server.listen(PORT, () => console.log(`[mock-server] listening on http://localhost:${PORT}`));
