import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the focus timer starts, pauses and resets, and shows today's sessions", async ({ page }) => {
  await page.goto("/pomodoro/");
  await expect(page.getByRole("heading", { name: "بومودورو", level: 1 })).toBeVisible();
  await expect(page.getByText("أكملت 2 جلسات تركيز اليوم!")).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "المدة بالدقائق" })).toHaveValue("25");

  await page.getByRole("button", { name: "تشغيل" }).click();
  const pause = page.getByRole("button", { name: /إيقاف/ });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole("button", { name: /تشغيل|متابعة|استئناف/ })).toBeVisible();

  await page.getByRole("button", { name: "إعادة الضبط" }).click();
  await expect(page.getByRole("button", { name: "تشغيل" })).toBeVisible();
});

test("break modes are one tap away, and the page links back to «وقتي»", async ({ page }) => {
  await page.goto("/pomodoro/");
  await page.getByRole("button", { name: "استراحة", exact: true }).click();
  await page.getByRole("button", { name: "استراحة طويلة" }).click();
  await page.getByRole("button", { name: "تركيز", exact: true }).click();
  await page.getByRole("navigation", { name: "مسار الصفحة" }).getByRole("link", { name: "وقتي" }).click();
  await expect(page).toHaveURL(/\/time\/?$/);
});
