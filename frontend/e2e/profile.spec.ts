import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("profile tabs keep their place in the URL and one save bar covers the edits", async ({ page }) => {
  await signIn(page);
  await page.goto("/profile/");
  const tabs = page.getByRole("tablist", { name: "أقسام الملف الشخصي" });
  await expect(tabs.getByRole("tab")).toHaveText(["بياناتي", "الإعدادات", "الخصوصية"]);
  await expect(page.getByRole("heading", { name: "البيانات الأساسية" })).toBeVisible();
  await expect(page.getByText("عندك تغييرات غير محفوظة")).toHaveCount(0);

  await page.getByPlaceholder("أدخل اسمك...").fill("عمر المعاشي");
  await expect(page.getByText("عندك تغييرات غير محفوظة")).toBeVisible();
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByText("تم حفظ الملف الشخصي بنجاح")).toBeVisible();
  await expect(page.getByText("عندك تغييرات غير محفوظة")).toHaveCount(0);

  await tabs.getByRole("tab", { name: "الخصوصية" }).click();
  await expect(page).toHaveURL(/#account$/);
  await expect(page.getByRole("button", { name: "عرض الجولة التعريفية مرة ثانية" })).toBeVisible();

  await page.goto("/profile/#notifications");
  await expect(page.getByRole("heading", { name: "الإشعارات على الجوال" })).toBeVisible();
});
