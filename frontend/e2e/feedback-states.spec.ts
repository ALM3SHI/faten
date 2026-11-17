import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// How the app talks to a student when something is missing or goes wrong.

test("a required field says what is missing in Arabic, whatever the browser's language", async ({ page }) => {
  await signIn(page);
  await page.goto("/exams/");
  await page.getByRole("button", { name: "إضافة اختبار" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "إضافة الاختبار" }).click();
  const date = dialog.locator('input[type="date"]');
  await expect.poll(() => date.evaluate((el: HTMLInputElement) => el.validationMessage)).toBe("اختر التاريخ.");
  // once filled, the field is valid again
  await date.fill("2026-12-27");
  expect(await date.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(true);
});

test("offline, the app says the device is offline — not that the server is waking", async ({ page, context }) => {
  await signIn(page);
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "أهلاً عمر" })).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const status = page.getByRole("status").filter({ hasText: "أنت غير متصل بالإنترنت" });
  await expect(status).toBeVisible();
  await expect(page.getByText("الخادم يستيقظ")).toHaveCount(0);
  // it sits below the top bar, not over its buttons
  const box = await status.boundingBox();
  expect(box?.y ?? 0).toBeGreaterThan(60);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(status).toHaveCount(0);
});

test("when فطن cannot answer, the student can ask again in one tap", async ({ page }) => {
  await signIn(page);
  let fail = true;
  await page.route("**/localhost:8787/api/chat**", (route) => (fail ? route.fulfill({ status: 503, body: "{}" }) : route.fallback()));
  await page.goto("/chat/");
  await page.getByRole("button", { name: "كم باقي لي غياب قبل الحرمان؟" }).click();
  await expect(page.getByText("فطن مشغول شوي الحين")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/رمز الخطأ/)).toHaveCount(0);

  fail = false;
  await page.getByRole("button", { name: "أعد السؤال" }).click();
  await expect(page.getByText("فطن مشغول شوي الحين")).toHaveCount(0);
  // asked once, not twice
  await expect(page.getByText("كم باقي لي غياب قبل الحرمان؟", { exact: true })).toHaveCount(1);
  await expect(page.getByText("15%").first()).toBeVisible({ timeout: 15000 });
});
