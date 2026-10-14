import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The e2e build fakes firebase/messaging as "not supported", so this checks
// the card renders, explains why push is unavailable and still saves prefs.
test("profile shows the notifications card and saves preferences", async ({ page }) => {
  await signIn(page);
  await page.goto("/profile/#notifications");
  const card = page.getByRole("heading", { name: "الإشعارات على الجوال" }).locator("xpath=ancestor::*[@data-slot='card'][1]");
  await expect(card).toBeVisible();
  await expect(card).toContainText("متصفحك لا يدعم الإشعارات");

  const exams = card.getByRole("checkbox", { name: /الاختبارات/ });
  await expect(exams).toBeChecked();
  const saved = page.waitForRequest((r) => r.url().endsWith("/api/notifications/prefs") && r.method() === "PUT");
  await exams.uncheck();
  expect((await saved).postDataJSON()).toEqual({ lectures: true, attendance: true, exams: false, reviews: true });
});
