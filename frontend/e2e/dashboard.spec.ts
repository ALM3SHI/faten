import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("today keeps the day, and one strip of numbers that opens «معدّلي»", async ({ page }) => {
  await page.goto("/dashboard/");
  await expect(page.getByText("أهلاً بك مجدداً، عمر!")).toBeVisible();
  const strip = page.getByRole("link", { name: "افتح معدّلي" });
  await expect(strip.getByText("3.56")).toBeVisible();
  // the analysis moved out of the home page
  await expect(page.getByRole("tab", { name: "روافع المعدل" })).toHaveCount(0);
  await strip.click();
  await expect(page).toHaveURL(/\/record\/?$/);
});

test("«معدّلي» shows the student's numbers and the analysis", async ({ page }) => {
  await page.goto("/record/");
  await expect(page.getByText("3.56").first()).toBeVisible();
  await expect(page.getByText("3.75").first()).toBeVisible();
  await expect(page.getByText("معدلك مستقر بين الفصلين")).toBeVisible();
  await expect(page.getByText(/11% · باقي/)).toBeVisible();
  await page.getByRole("tab", { name: "روافع المعدل" }).click();
  await expect(page.getByText("أعلى أثر على معدلك")).toBeVisible();
});

test("earned-hours dialog uses the graduation summary", async ({ page }) => {
  await page.goto("/record/");
  await page.getByRole("button", { name: /^الساعات/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("تقدم الساعات")).toBeVisible();
  await expect(dialog.getByText("15 / 132 ساعة")).toBeVisible();
  await expect(dialog.getByText("مقدمة في البرمجة")).toBeVisible();
});

test("target dialog uses next-term hours from the analysis", async ({ page }) => {
  await page.goto("/record/");
  await page.getByRole("button", { name: /^المستهدف/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("15 ساعة", { exact: true })).toBeVisible();
  await expect(dialog.getByText("الحد الأقصى الممكن:")).toBeVisible();
});

test("today shows the next lecture and the ask box opens the chat", async ({ page }) => {
  await page.goto("/dashboard/");
  const today = page.getByRole("region", { name: "اليوم" });
  await expect(today.getByRole("link", { name: /الذكاء الاصطناعي|قواعد البيانات/ }).first()).toBeVisible();
  await expect(today.getByRole("link", { name: /أضف مواعيد اختباراتك/ })).toBeVisible();
  await expect(today.getByRole("link", { name: /غيابك بأمان|باقي لك/ })).toBeVisible();

  await page.getByRole("searchbox").or(page.getByLabel("اسأل فطن")).first().fill("كم أغيب قبل الحرمان؟");
  await page.getByRole("button", { name: "اسأل", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/?\?query=/);
});
