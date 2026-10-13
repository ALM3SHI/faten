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
