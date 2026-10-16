import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("chat streams an answer from the agent", async ({ page }) => {
  await signIn(page);
  await page.goto("/chat/");
  const input = page.getByRole("textbox").last();
  await input.fill("متى اختباري الجاي؟");
  await input.press("Enter");
  await expect(page.getByText("متى اختباري الجاي؟").first()).toBeVisible();
  await expect(page.getByText(/موعد اختبارك القادم في مادة الذكاء الاصطناعي/)).toBeVisible();
});

test("a regulation answer shows its source, and tapping it shows the article text", async ({ page }) => {
  await signIn(page);
  await page.goto("/chat/");
  const input = page.getByRole("textbox").last();
  await input.fill("متى يصير الحرمان؟");
  await input.press("Enter");

  const source = page.getByRole("button", { name: /عرض المصدر: المادة 14/ });
  await expect(source).toBeVisible();
  await source.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "المادة 14" })).toBeVisible();
  await expect(dialog.getByText(/يحرم من دخول الاختبار النهائي/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "المصدر الرسمي في موقع الجامعة" })).toHaveAttribute("href", "https://uqu.edu.sa/dadregis/151795");
});

test("a date answer cites the academic calendar", async ({ page }) => {
  await signIn(page);
  await page.goto("/chat/");
  const input = page.getByRole("textbox").last();
  await input.fill("متى الاختبارات النهائية؟");
  await input.press("Enter");

  const source = page.getByRole("button", { name: /عرض المصدر: الاختبارات النهائية — التقويم الأكاديمي/ });
  await expect(source).toBeVisible();
  await source.click();
  await expect(page.getByRole("dialog").getByText("الاختبارات النهائية: 27 Dec 2026 - 07 Jan 2027 (18/07 - 29/07/1448هـ)")).toBeVisible();
});

test("a planning question gets a way into «المرشد»", async ({ page }) => {
  await signIn(page);
  await page.goto("/chat/");
  const input = page.getByRole("textbox").last();
  await input.fill("وش أسجّل الفصل الجاي؟");
  await input.press("Enter");
  const handoff = page.getByRole("link", { name: /فتح المرشد الأكاديمي/ });
  await expect(handoff).toBeVisible();
  await handoff.click();
  await expect(page).toHaveURL(/\/advisor\/?$/);
});
