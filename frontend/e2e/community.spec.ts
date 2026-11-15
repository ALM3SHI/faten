import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// One worker at a time: the mock API keeps the student's review in memory.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page, request }) => {
  await request.post("http://localhost:8787/__reset");
  await signIn(page);
});

test("course reviews: browse, read a tip, then write and delete your own", async ({ page }) => {
  await page.goto("/community/");
  await expect(page.getByRole("heading", { name: "مجتمع فطن", level: 1 })).toBeVisible();
  await expect(page.getByText("100% ينصحون بها")).toBeVisible();

  // a course from the student's own record can be reviewed
  await page.getByRole("button", { name: /CS1101 مقدمة في البرمجة/ }).click();
  await expect(page.getByText("ركّز على حل التمارين كل أسبوع.")).toBeVisible();

  const four = page.getByRole("button", { name: "4 من 5" });
  await expect(four).toHaveCount(3); // difficulty, workload, usefulness
  for (let i = 0; i < 3; i++) await four.nth(i).click();
  await page.getByRole("button", { name: "نعم" }).click();
  await page.getByPlaceholder(/نصيحة لمن سيدرسها/).fill("ابدأ المشروع بدري.");
  await page.getByRole("button", { name: /تقييم/ }).last().click();
  await expect(page.getByText("شكرًا! تقييمك يفيد زملاءك")).toBeVisible();
  await expect(page.getByText("ابدأ المشروع بدري.").first()).toBeVisible();

  await page.getByRole("button", { name: "حذف" }).click();
  await expect(page.getByText("تم حذف تقييمك")).toBeVisible();
});
