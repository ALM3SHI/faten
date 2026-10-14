import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("advisor: set goals, get a grounded plan, compare paths, check a schedule", async ({ page }) => {
  await signIn(page);
  await page.goto("/advisor/");
  await expect(page.getByRole("heading", { name: "المرشد الأكاديمي" })).toBeVisible();

  // Saved settings exist but no run yet → the student starts the analysis.
  await page.getByRole("button", { name: "حلّل وضعي" }).click();
  await expect(page.getByText("المسار المقترح: التعافي")).toBeVisible();
  // GPA 1.62 with no published program threshold → warning status is not claimed either way.
  await expect(page.getByText("الإنذار الأكاديمي: غير محسوم")).toBeVisible();
  await expect(page.getByText("شرط التخرج")).toBeVisible();
  await expect(page.getByText("علوم الحاسب الآلي").first()).toBeVisible();

  // Next term: the failed gatekeeper course comes first, with its reasons.
  await expect(page.getByRole("heading", { name: /سجّل في الفصل الثاني 1448/ })).toBeVisible();
  const first = page.getByRole("listitem").filter({ hasText: "CS1701" }).first();
  await expect(first).toContainText("إعادة مقرر لم تجتزه بعد");
  await expect(page.getByRole("table")).toBeVisible(); // exact GPA what-if

  // Graduation paths and the impossible target.
  await page.getByRole("tab", { name: "مسارات التخرج" }).click();
  await expect(page.getByRole("radio", { name: /الأسرع تخرجاً/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "مستحيل رياضياً" })).toBeVisible();

  // Risks are labelled fact vs estimate; sources are linked.
  await page.getByRole("tab", { name: "المخاطر والبيانات" }).click();
  await expect(page.getByText("حقيقة من سجلك").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "صفحة الخطة الرسمية" })).toHaveAttribute("href", "https://uqu.edu.sa/App/Degrees/478");
  await expect(page.getByRole("heading", { name: "ما لا نعرفه وأثره على التوصية" })).toBeVisible();
  await page.getByText(/الوثائق الرسمية المستخدمة/).click();
  await expect(page.getByRole("link", { name: /CS3809 Software Implementation Systems/ })).toBeVisible();
  await expect(page.getByText(/لا تنطبق على الخطة الحالية/).first()).toBeVisible();

  // Schedule check rejects a same-term prerequisite.
  await page.getByRole("tab", { name: "فحص جدول" }).click();
  await page.getByLabel("رموز المقررات").fill("cs1704, cs2105");
  await page.getByRole("button", { name: /افحص/ }).click();
  await expect(page.getByText("الجدول يخالف قواعد التسجيل")).toBeVisible();

  // Instructors: no data → no recommendation, and why Qaym is not used.
  await page.getByRole("tab", { name: "المحاضرون" }).click();
  await page.getByRole("button", { name: "اعرض الأدلة" }).click();
  await expect(page.getByText("لا نرشّح أحداً").first()).toBeVisible();

  // Follow-up question falls back to the computed summary when the AI strays.
  await page.getByRole("tab", { name: "اسأل المرشد" }).click();
  await page.getByLabel("سؤالك").fill("ليش أعيد CS1701 أول؟");
  await page.getByRole("button", { name: "أرسل السؤال" }).click();
  await expect(page.getByText(/هذا الملخص المحسوب/)).toBeVisible();
});

test("advisor appears under «سجلي» and requires sign-in", async ({ page }) => {
  await page.goto("/advisor/");
  await expect(page).toHaveURL(/login/);
});
