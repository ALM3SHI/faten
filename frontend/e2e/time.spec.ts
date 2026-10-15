import { expect, test } from "@playwright/test";
import { readFirestore, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("«وقتي» shows the week and records an absence from the lecture", async ({ page }) => {
  await page.goto("/time/");
  await expect(page.getByRole("heading", { name: "وقتي", exact: true })).toBeVisible();
  const days = page.getByRole("tablist", { name: "أيام الأسبوع" });
  await expect(days.getByRole("tab")).toHaveCount(7);

  // Sunday has the AI lecture in the mock timetable (and is never in the future)
  await days.getByRole("tab", { name: /^الأحد/ }).click();
  const lecture = page.getByText("الذكاء الاصطناعي");
  await expect(lecture).toBeVisible();
  await page.getByRole("button", { name: "غبت" }).click();
  await expect(page.getByRole("button", { name: "سُجّل غياب ✓" })).toBeVisible();
  await expect(page.getByText(/الغياب 1 من/)).toBeVisible();

  // the same record the attendance page reads
  await page.goto("/attendance/");
  await expect(page.getByText("الذكاء الاصطناعي").first()).toBeVisible();
  await expect.poll(async () => JSON.stringify(await readFirestore(page))).toContain("CS3301");
});

test("every tool of «وقتي» is one tap away", async ({ page }) => {
  await page.goto("/time/");
  const tools = page.getByRole("region", { name: "كل أدوات وقتي" });
  await tools.getByRole("link", { name: /خطة المذاكرة/ }).click();
  await expect(page).toHaveURL(/\/plan\/?$/);
});
