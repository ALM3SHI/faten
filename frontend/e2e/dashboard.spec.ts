import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("dashboard shows the student's numbers from the workspace", async ({ page }) => {
  await page.goto("/dashboard/");
  await expect(page.getByText("أهلاً بك مجدداً، عمر!")).toBeVisible();
  await expect(page.getByText("3.56").first()).toBeVisible();
  await expect(page.getByText("3.75").first()).toBeVisible();
  // analytics from the mock API
  await expect(page.getByText("معدلك مستقر بين الفصلين")).toBeVisible();
  await expect(page.getByText("طريقك للتخرج")).toBeVisible();
});

test("earned-hours dialog uses the graduation summary", async ({ page }) => {
  await page.goto("/dashboard/");
  await page.getByText("الساعات المنجزة").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("تقدم الساعات")).toBeVisible();
  await expect(dialog.getByText("15 / 132 ساعة")).toBeVisible();
  await expect(dialog.getByText("مقدمة في البرمجة")).toBeVisible();
});

test("target dialog uses next-term hours from the analysis", async ({ page }) => {
  await page.goto("/dashboard/");
  await page.getByText("المعدل المستهدف").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("15 ساعة", { exact: true })).toBeVisible();
  await expect(dialog.getByText("الحد الأقصى الممكن:")).toBeVisible();
});
