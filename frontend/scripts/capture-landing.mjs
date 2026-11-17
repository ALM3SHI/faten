// Captures the product screenshots and the short demo clip shown on the
// landing page, straight from the real app (the Playwright build with fake
// Firebase and the mock API — the same one the e2e suite uses).
//
//   npm run build:e2e
//   node e2e/mock-server.mjs &  node e2e/static-server.mjs out-e2e 3100 &
//   npm run capture:landing
//
// Output: public/landing/*.webp, public/landing/demo.webm, public/og.png.
// The student shown is the synthetic demo account below — never real data.

import { chromium } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const WEB = process.env.WEB_URL || "http://localhost:3100";
const OUT = path.resolve("public/landing");
fs.mkdirSync(OUT, { recursive: true });

const USER = { uid: "e2e-omar", email: "omar@test.local", displayName: "عمر", emailVerified: true };

// ── A fuller synthetic semester than the e2e fixture, so the shots look lived-in ──
const done = (code, nameAr, nameEn, creditHours, grade, gradePoints, semester) => ({
  code, nameAr, nameEn, creditHours, grade, gradePoints, semester, semesterStatus: "completed",
});
const now = (code, nameAr, nameEn, creditHours) => ({
  code, nameAr, nameEn, creditHours, grade: null, gradePoints: null, semester: "الفصل الأول 1448", semesterStatus: "in_progress",
});
const COMPLETED = [
  done("CS1101", "مقدمة في البرمجة", "Intro to Programming", 4, "A+", 4, "الفصل الأول 1446"),
  done("MATH1101", "تفاضل وتكامل (1)", "Calculus I", 4, "B+", 3.5, "الفصل الأول 1446"),
  done("ENG1101", "اللغة الإنجليزية", "English", 3, "A", 3.75, "الفصل الأول 1446"),
  done("CS1102", "برمجة متقدمة", "Advanced Programming", 4, "A", 3.75, "الفصل الثاني 1446"),
  done("MATH1102", "تفاضل وتكامل (2)", "Calculus II", 4, "B", 3, "الفصل الثاني 1446"),
  done("PHYS1101", "فيزياء عامة", "General Physics", 4, "B+", 3.5, "الفصل الثاني 1446"),
  done("CS2201", "هياكل البيانات", "Data Structures", 3, "A", 3.75, "الفصل الأول 1447"),
  done("CS2202", "تنظيم الحاسب", "Computer Organization", 3, "B+", 3.5, "الفصل الأول 1447"),
  done("STAT2101", "الاحتمالات والإحصاء", "Probability & Statistics", 3, "A", 3.75, "الفصل الأول 1447"),
  done("CS2203", "الخوارزميات", "Algorithms", 3, "A+", 4, "الفصل الثاني 1447"),
  done("CS2204", "نظم التشغيل", "Operating Systems", 3, "B+", 3.5, "الفصل الثاني 1447"),
  done("CS2205", "هندسة البرمجيات", "Software Engineering", 3, "A", 3.75, "الفصل الثاني 1447"),
];
const CURRENT = [
  now("CS3301", "الذكاء الاصطناعي", "Artificial Intelligence", 3),
  now("CS3302", "قواعد البيانات", "Databases", 3),
  now("CS3303", "شبكات الحاسب", "Computer Networks", 3),
  now("CS3304", "أمن المعلومات", "Information Security", 3),
  now("CS3305", "تفاعل الإنسان والحاسب", "Human-Computer Interaction", 3),
];
const slot = (course_code, course_name, day, start_time, end_time, room, type = "نظري") => ({
  course_code, course_name, day, start_time, end_time, type, room,
});
const SCHEDULE = [
  slot("CS3301", "الذكاء الاصطناعي", "الأحد", "08:00", "09:40", "A-101"),
  slot("CS3303", "شبكات الحاسب", "الأحد", "10:00", "11:40", "B-112"),
  slot("CS3304", "أمن المعلومات", "الإثنين", "09:00", "10:40", "A-210"),
  slot("CS3305", "تفاعل الإنسان والحاسب", "الإثنين", "13:00", "14:40", "C-015"),
  slot("CS3302", "قواعد البيانات", "الثلاثاء", "10:00", "11:40", "B-204"),
  slot("CS3301", "الذكاء الاصطناعي", "الثلاثاء", "13:00", "14:40", "A-101"),
  slot("CS3303", "شبكات الحاسب", "الأربعاء", "08:00", "09:40", "معمل 3", "عملي"),
  slot("CS3304", "أمن المعلومات", "الأربعاء", "10:00", "11:40", "A-210"),
  slot("CS3302", "قواعد البيانات", "الخميس", "09:00", "10:40", "معمل 1", "عملي"),
];
const earned = COMPLETED.reduce((s, c) => s + c.creditHours, 0);
const WORKSPACE = {
  success: true,
  profile: {
    basic: { name: "عمر", major: "علوم الحاسب", studentId: "441000000", totalPlanHours: 132 },
    goals: { currentGpa: 3.62, targetGpa: 3.75 },
    preferences: {},
    lastUpdated: "2026-10-01T08:00:00.000Z",
  },
  transcript: {
    name: "عمر", nameEn: "Omar", studentId: "441000000", university: "جامعة أم القرى", major: "علوم الحاسب",
    faculty: "الحاسبات", degree: "بكالوريوس", gpa: 3.62, earnedHours: earned, attemptedHours: earned,
    completedCourses: COMPLETED, currentCourses: CURRENT, confidence: 95, lastUpdated: "2026-10-01T08:00:00.000Z",
  },
  schedule: { schedule: SCHEDULE, lastUpdated: "2026-10-01T08:00:00.000Z" },
  plan: { plan: null, model: null, generatedAt: null, completed: [] },
  chats: { threads: [] },
  achievements: {},
  notifications: [],
};
const ANALYTICS = {
  target_analysis: { required: 3.9, status: "feasible", message: "", next_hours: 15 },
  chart_data: [
    { semester: "الفصل الأول 1446", term_gpa: 3.75, cumulative_gpa: 3.75 },
    { semester: "الفصل الثاني 1446", term_gpa: 3.42, cumulative_gpa: 3.58 },
    { semester: "الفصل الأول 1447", term_gpa: 3.67, cumulative_gpa: 3.6 },
    { semester: "الفصل الثاني 1447", term_gpa: 3.75, cumulative_gpa: 3.62 },
  ],
  advisor_recommendation: { hours: "15", tone: "steady", headline: "", body: "" },
  strengths_radar: [],
  high_roi_courses: [
    { code: "CS3301", name: "الذكاء الاصطناعي", credits: 3, max_point_contribution: 12, projected_delta: 0.06, label: "أعلى أثر على معدلك" },
    { code: "CS3302", name: "قواعد البيانات", credits: 3, max_point_contribution: 12, projected_delta: 0.05, label: "أثر مرتفع" },
    { code: "CS3303", name: "شبكات الحاسب", credits: 3, max_point_contribution: 12, projected_delta: 0.05, label: "أثر مرتفع" },
  ],
  agentic_action: { active: false, intervention_id: "", trigger: "none", severity: "low", headline: "", body: "", scheduled_tasks: [], reasoning: [] },
  gpa_trend_analysis: "معدلك في صعود منذ ثلاثة فصول، وأقوى نتائجك في مواد البرمجة والخوارزميات.",
};

async function newContext(browser, { theme, viewport, scale = 2, video = null }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    reducedMotion: video ? "no-preference" : "reduce",
    ...(video && { recordVideo: { dir: video.dir, size: video.size } }),
  });
  await context.addInitScript(
    ({ u, theme }) => {
      localStorage.setItem("__e2e_auth_user__", JSON.stringify(u));
      localStorage.setItem("uqu_tour_done_v1", `${u.uid}:1`);
      localStorage.setItem("uqu-theme", theme);
    },
    { u: USER, theme },
  );
  const json = (body) => ({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*" } });
  await context.route("**/api/workspace", (route) => (route.request().method() === "GET" ? route.fulfill(json(WORKSPACE)) : route.continue()));
  await context.route("**/api/analytics/dashboard", (route) => route.fulfill(json(ANALYTICS)));
  return context;
}

async function settle(page, ms = 900) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

async function save(page, name, width) {
  const png = await page.screenshot({ type: "png" });
  const file = path.join(OUT, `${name}.webp`);
  await sharp(png).resize({ width }).webp({ quality: 82, effort: 6 }).toFile(file);
  console.log("  ✓", path.relative(process.cwd(), file), `${Math.round(fs.statSync(file).size / 1024)} KB`);
}

async function askChat(page, question, waitFor) {
  const input = page.getByRole("textbox").last();
  await input.fill(question);
  await input.press("Enter");
  await page.getByText(waitFor).first().waitFor();
}

/** Desktop + phone stills of each screen, in both themes. */
async function stills(browser) {
  for (const theme of ["dark", "light"]) {
    console.log(`stills · ${theme}`);
    const desktop = await newContext(browser, { theme, viewport: { width: 1280, height: 800 } });
    const page = await desktop.newPage();

    await page.goto(`${WEB}/dashboard/`);
    await page.getByRole("heading", { name: /^أهلاً/ }).waitFor();
    await settle(page);
    await save(page, `dashboard-${theme}`, 1920);

    await page.goto(`${WEB}/chat/`);
    await settle(page, 400);
    await askChat(page, "متى يصير الحرمان؟", /عرض المصدر|المادة \(14\)/);
    await settle(page);
    await save(page, `chat-${theme}`, 1920);

    await page.goto(`${WEB}/record/`);
    await page.getByText("3.62").first().waitFor();
    await settle(page, 1500);
    await save(page, `record-${theme}`, 1920);

    await page.goto(`${WEB}/time/`);
    await page.getByRole("heading", { name: "وقتي", exact: true }).waitFor();
    await settle(page);
    await save(page, `time-${theme}`, 1920);

    await page.goto(`${WEB}/locations/`);
    await settle(page, 1800);
    await save(page, `map-${theme}`, 1920);

    await desktop.close();

    const phone = await newContext(browser, { theme, viewport: { width: 390, height: 844 }, scale: 3 });
    const m = await phone.newPage();
    await m.goto(`${WEB}/dashboard/`);
    await m.getByRole("heading", { name: /^أهلاً/ }).waitFor();
    await settle(m);
    await save(m, `phone-dashboard-${theme}`, 780);
    await m.goto(`${WEB}/chat/`);
    await settle(m, 400);
    await askChat(m, "متى يصير الحرمان؟", /عرض المصدر|المادة \(14\)/);
    await settle(m);
    await save(m, `phone-chat-${theme}`, 780);
    await phone.close();
  }
}

/** A short silent walkthrough: today → ask a regulation question → GPA → week. */
async function clip(browser) {
  console.log("clip");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faten-clip-"));
  const size = { width: 1280, height: 720 };
  const context = await newContext(browser, { theme: "dark", viewport: size, scale: 1, video: { dir, size } });
  const page = await context.newPage();

  await page.goto(`${WEB}/dashboard/`);
  await page.getByRole("heading", { name: /^أهلاً/ }).waitFor();
  await page.waitForTimeout(2600);

  await page.goto(`${WEB}/chat/`);
  await page.waitForTimeout(900);
  const input = page.getByRole("textbox").last();
  await input.pressSequentially("متى يصير الحرمان؟", { delay: 85 });
  await page.waitForTimeout(400);
  await input.press("Enter");
  await page.getByText(/المادة \(14\)/).first().waitFor();
  await page.waitForTimeout(2800);

  await page.goto(`${WEB}/record/`);
  await page.getByText("3.62").first().waitFor();
  await page.waitForTimeout(3000);

  await page.goto(`${WEB}/time/`);
  await page.getByRole("heading", { name: "وقتي", exact: true }).waitFor();
  await page.waitForTimeout(2600);

  const video = page.video();
  await context.close();
  const file = path.join(OUT, "demo.webm");
  fs.copyFileSync(await video.path(), file);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("  ✓", path.relative(process.cwd(), file), `${Math.round(fs.statSync(file).size / 1024)} KB`);
}

/** 1200×630 share card (Open Graph / X), composed from the real dashboard shot. */
async function shareCard(browser) {
  console.log("share card");
  const shot = fs.readFileSync(path.join(OUT, "dashboard-dark.webp")).toString("base64");
  const font = fs.readFileSync(path.resolve("src/app/fonts/cairo-arabic-wght-normal.woff2")).toString("base64");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    @font-face { font-family: Cairo; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 200 1000; }
    * { box-sizing: border-box; margin: 0; }
    html { overflow: hidden; }
    body { position: relative; width: 1200px; height: 630px; overflow: hidden; font-family: Cairo, sans-serif; color: #fff;
      background: radial-gradient(900px 500px at 85% 0%, hsla(245,78%,62%,.55), transparent 60%),
                  radial-gradient(700px 500px at 0% 100%, hsla(187,80%,48%,.35), transparent 60%), #0a0a0f; }
    .text { position: absolute; right: 64px; top: 70px; width: 520px; }
    .brand { display: flex; align-items: center; gap: 14px; font-size: 34px; font-weight: 800; }
    .mark { width: 60px; height: 60px; border-radius: 16px; display: grid; place-items: center;
      background: linear-gradient(135deg, hsl(245,78%,62%), hsl(187,80%,48%)); }
    h1 { font-size: 58px; line-height: 1.25; font-weight: 900; margin-top: 44px; }
    p { font-size: 25px; line-height: 1.7; color: rgba(255,255,255,.78); margin-top: 22px; }
    .url { position: absolute; right: 64px; bottom: 54px; font-size: 22px; font-weight: 700; color: rgba(255,255,255,.7); direction: ltr; }
    .shot { position: absolute; left: -150px; top: 110px; width: 720px; border-radius: 18px; overflow: hidden;
      border: 1px solid rgba(255,255,255,.16); box-shadow: 0 40px 90px rgba(0,0,0,.6); transform: rotate(-3deg); }
    .shot img { display: block; width: 100%; }
  </style></head><body>
    <div class="text">
      <div class="brand"><span class="mark"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg></span>فطن</div>
      <h1>اسأل عن جامعتك، وخذ الجواب من اللائحة.</h1>
      <p>المساعد الأكاديمي لطلاب جامعة أم القرى: اللوائح، المعدل، الجدول والمذاكرة في مكان واحد.</p>
    </div>
    <div class="url">fatenai.web.app</div>
    <div class="shot"><img src="data:image/webp;base64,${shot}"></div>
  </body></html>`;
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const png = await page.screenshot({ type: "png" });
  await sharp(png).png({ compressionLevel: 9, palette: false }).toFile(path.resolve("public/og.png"));
  await context.close();
  console.log("  ✓ public/og.png", `${Math.round(fs.statSync("public/og.png").size / 1024)} KB`);
}

const only = process.argv[2];
// CHANNEL=chrome uses the installed Google Chrome instead of Playwright's Chromium.
const browser = await chromium.launch(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {});
try {
  if (!only || only === "stills") await stills(browser);
  if (!only || only === "clip") await clip(browser);
  if (!only || only === "og") await shareCard(browser);
} finally {
  await browser.close();
}
