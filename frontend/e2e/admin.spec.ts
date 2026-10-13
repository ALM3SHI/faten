import { expect, test } from "@playwright/test";
import { signIn, STUDENT } from "./helpers";

const ADMIN = { ...STUDENT, uid: "e2e-admin", email: "admin@test.local", displayName: "المشرف" };

test("students cannot open the admin page and see no link to it", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/");
  await expect(page.getByRole("heading", { name: "هذي الصفحة لمشرف فطن فقط." })).toBeVisible();
  await page.goto("/profile/");
  await expect(page.getByRole("button", { name: "عرض الجولة التعريفية مرة ثانية" })).toBeVisible();
  await expect(page.getByRole("link", { name: "لوحة الإدارة" })).toHaveCount(0);
});

test("the admin sees the numbers and can restore a reported review", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/profile/");
  await page.getByRole("link", { name: "لوحة الإدارة" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);

  await expect(page.getByText("128", { exact: true })).toBeVisible();
  await expect(page.getByText("85%")).toBeVisible();
  await expect(page.getByRole("cell", { name: "اللوائح" })).toBeVisible();
  await expect(page.getByText("ملاحظة الطالب: الجواب ناقص")).toBeVisible();

  const restored = page.waitForRequest((r) => r.url().endsWith(`/api/admin/reviews/CS1101/${"a".repeat(20)}/restore`) && r.method() === "POST");
  await page.getByRole("button", { name: "إظهار ومسح البلاغات" }).click();
  await restored;
  await expect(page.getByText("رجع التقييم ظاهر وانمسحت بلاغاته.")).toBeVisible();
});
