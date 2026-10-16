import { expect, test } from "@playwright/test";
import { readFirestore, seedFirestore, signIn, STUDENT } from "./helpers";

const DOC = `users/${STUDENT.uid}/settings/tour`;

test("a new student gets the welcome tour once, saved to the account", async ({ page }) => {
  await signIn(page, STUDENT, { tour: true });
  await page.goto("/dashboard/");

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "أهلاً بك في فطن" })).toBeVisible();
  await expect(dialog.getByText("1 من 6")).toBeVisible();
  await dialog.getByRole("button", { name: "التالي" }).click();
  // the mock workspace has a transcript, so the setup step says it is ready
  await expect(dialog.getByRole("heading", { name: "ملفك الأكاديمي جاهز" })).toBeVisible();
  await dialog.getByRole("button", { name: "السابق" }).click();
  await expect(dialog.getByText("1 من 6")).toBeVisible();
  for (let i = 0; i < 5; i++) await dialog.getByRole("button", { name: "التالي" }).click();
  await expect(dialog.getByRole("heading", { name: "خلّك على اطلاع" })).toBeVisible();
  await dialog.getByRole("button", { name: "يلا نبدأ" }).click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(async () => (await readFirestore(page))[DOC]?.version).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "أهلاً عمر" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("skipping counts as done, and another device does not show it again", async ({ page, browser }) => {
  await signIn(page, STUDENT, { tour: true });
  await page.goto("/dashboard/");
  await page.getByRole("dialog").getByRole("button", { name: "تخطي الجولة" }).click();
  await expect.poll(async () => (await readFirestore(page))[DOC]?.version).toBe(1);

  // a second browser with the same account: only the Firestore flag is shared
  const other = await (await browser.newContext()).newPage();
  await seedFirestore(other, { [DOC]: { version: 1, doneAt: "2026-10-13T10:00:00.000Z" } });
  await signIn(other, STUDENT, { tour: true });
  await other.goto("/dashboard/");
  await expect(other.getByRole("heading", { name: "أهلاً عمر" })).toBeVisible();
  await other.waitForTimeout(500);
  await expect(other.getByRole("dialog")).toHaveCount(0);
});

test("the profile page can replay the tour", async ({ page }) => {
  await signIn(page);
  await page.goto("/profile/#account");
  await page.getByRole("button", { name: "عرض الجولة التعريفية مرة ثانية" }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "أهلاً بك في فطن" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "تخطي الجولة" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
