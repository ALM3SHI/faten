import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("four spaces; a detail page links back to its hub", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/exams/");
  const nav = page.getByRole("navigation", { name: info.project.name === "mobile" ? "التنقل الرئيسي" : "الأقسام" });
  await expect(nav.getByRole("link")).toHaveText(["اليوم", "وقتي", "فطن", "معدّلي"]);
  await expect(nav.getByRole("link", { name: "وقتي" })).toHaveAttribute("aria-current", "page");

  // no sub-tabs: a back link to the space instead
  const crumb = page.getByRole("navigation", { name: "مسار الصفحة" });
  await expect(crumb.getByText("الاختبارات")).toBeVisible();
  await crumb.getByRole("link", { name: "وقتي" }).click();
  await expect(page).toHaveURL(/\/time\/?$/);

  await nav.getByRole("link", { name: "معدّلي" }).click();
  await expect(page).toHaveURL(/\/record\/?$/);
  await nav.getByRole("link", { name: "اليوم" }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
});

test("فطن has two modes: ask and study", async ({ page }) => {
  await signIn(page);
  await page.goto("/study/");
  const modes = page.getByRole("navigation", { name: "وضع فطن" });
  await expect(modes.getByRole("link", { name: "ذاكر محاضرة" })).toHaveAttribute("aria-current", "page");
  await modes.getByRole("link", { name: "اسأل" }).click();
  await expect(page).toHaveURL(/\/chat\/?$/);
});

test("the account menu holds the pages outside the spaces", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "حسابي والقائمة" }).click();
  await expect(page.getByRole("menuitem", { name: "الملف الشخصي والأهداف" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "تقييمات المواد" })).toBeVisible();
  await page.getByRole("menuitem", { name: "القاعات والخريطة" }).click();
  await expect(page).toHaveURL(/\/locations\/?$/);
});
