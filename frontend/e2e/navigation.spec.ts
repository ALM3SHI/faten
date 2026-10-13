import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("five sections, sub-tabs, and a section remembers its last page", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/exams/");
  const nav = page.getByRole("navigation", { name: info.project.name === "mobile" ? "التنقل الرئيسي" : "الأقسام" });
  await expect(nav.getByRole("link")).toHaveCount(5);
  await expect(nav.getByRole("link", { name: "دراستي" })).toHaveAttribute("aria-current", "page");

  const tabs = page.getByRole("navigation", { name: "صفحات دراستي" });
  await expect(tabs.getByRole("link")).toHaveText(["الخطة", "الاختبارات", "المذاكرة", "بومودورو"]);
  await expect(tabs.getByRole("link", { name: "الاختبارات" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "المذاكرة" }).click();
  await expect(page).toHaveURL(/\/study\/?$/);

  await nav.getByRole("link", { name: "الرئيسية" }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await expect(nav.getByRole("link", { name: "دراستي" })).toHaveAttribute("href", /\/study\/?$/);
  // pages that were only reachable from inside other pages are now in «سجلي»
  await nav.getByRole("link", { name: "سجلي" }).click();
  await expect(page.getByRole("navigation", { name: "صفحات سجلي" }).getByRole("link", { name: "الجدول" })).toBeVisible();
});
