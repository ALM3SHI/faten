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
  if (p.startsWith("/api/notifications/")) return send(res, 200, { success: true });
  if (p === "/api/chat/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
    res.write(`data: ${JSON.stringify({ type: "status", tool: "get_upcoming_exams" })}\n\n`);
    for (const word of CHAT_REPLY.split(" ")) res.write(`data: ${JSON.stringify({ type: "token", text: word + " " })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done", response: { success: true, message: CHAT_REPLY, conversationId: "conv-e2e", actions: [], client_actions: [] } })}\n\n`);
    return res.end();
  }
  if (p === "/api/chat") return send(res, 200, { success: true, message: CHAT_REPLY, conversationId: "conv-e2e", actions: [], client_actions: [] });
  return send(res, 404, { detail: "غير موجود في الخادم الوهمي." });
});

server.listen(PORT, () => console.log(`[mock-server] listening on http://localhost:${PORT}`));
