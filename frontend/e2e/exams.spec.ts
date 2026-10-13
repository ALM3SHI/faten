import { expect, test } from "@playwright/test";
import { readFirestore, seedFirestore, signIn, STUDENT } from "./helpers";

const COL = `users/${STUDENT.uid}/exams`;

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test("add exams, see the countdown, the clash and the study plan", async ({ page }) => {
  await signIn(page);
  await page.goto("/exams/");
  await expect(page.getByRole("heading", { name: "ما في اختبارات قادمة" })).toBeVisible();

  // first exam: a current course from the transcript
  await page.getByRole("button", { name: "إضافة اختبار" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("المادة").selectOption("CS3301");
  await dialog.getByLabel("التاريخ").fill(inDays(5));
  await dialog.getByLabel("الوقت").fill("09:00");
  await dialog.getByRole("button", { name: "إضافة الاختبار" }).click();

  await expect(page.getByText("اختبارك القادم")).toBeVisible();
  await expect(page.getByRole("heading", { name: "الذكاء الاصطناعي", level: 2 })).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();

  // second exam at an overlapping time → clash warning before and after saving
  await page.getByRole("button", { name: "إضافة اختبار" }).first().click();
  await dialog.getByLabel("المادة").selectOption("CS3302");
  await dialog.getByLabel("التاريخ").fill(inDays(5));
  await dialog.getByLabel("الوقت").fill("10:00");
  await expect(dialog.getByRole("alert")).toContainText("يتعارض في الوقت");
  await dialog.getByRole("button", { name: "إضافة الاختبار" }).click();
  await expect(page.getByText(/تعارض: .* في نفس الوقت/)).toBeVisible();

  // study plan with final reviews
  await expect(page.getByRole("heading", { name: "خطة المذاكرة قبل الاختبارات" })).toBeVisible();
  await page.getByRole("button", { name: /عرض كل الأيام/ }).click();
  await expect(page.getByText(/مراجعة نهائية: /).first()).toBeVisible();

  // saved as one Firestore doc per exam, in the agent's shape
  await expect
    .poll(async () => Object.keys(await readFirestore(page)).filter((k) => k.startsWith(COL)).length)
    .toBe(2);
  const docs = Object.entries(await readFirestore(page)).filter(([k]) => k.startsWith(COL)).map(([, v]) => v);
  expect(docs[0]).toMatchObject({ date: inDays(5), done: false, exam_type: "final" });
  expect(docs.map((d) => d.course_code).sort()).toEqual(["CS3301", "CS3302"]);
});

test("exams the agent saved show up, and deleting removes the doc", async ({ page }) => {
  await seedFirestore(page, {
    [`${COL}/agent1`]: { subject: "قواعد البيانات", date: inDays(2), time: "13:00", done: false, exam_type: "final", source: "agent" },
  });
  await signIn(page);
  await page.goto("/exams/");
  await expect(page.getByRole("heading", { name: "قواعد البيانات", level: 2 })).toBeVisible();
  await expect(page.getByText("بعد يومين").first()).toBeVisible();

  await page.getByRole("button", { name: "حذف قواعد البيانات" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف" }).click();
  await expect(page.getByRole("heading", { name: "ما في اختبارات قادمة" })).toBeVisible();
  await expect.poll(async () => (await readFirestore(page))[`${COL}/agent1`]).toBeUndefined();
});

test("dashboard shows the next exam", async ({ page }) => {
  await seedFirestore(page, {
    [`${COL}/e1`]: { subject: "الذكاء الاصطناعي", date: inDays(1), done: false },
  });
  await signIn(page);
  await page.goto("/dashboard/");
  const row = page.getByRole("link", { name: /اختبار الذكاء الاصطناعي/ });
  await expect(row).toContainText("غداً");
  await expect(row).toHaveAttribute("href", /\/exams\/?$/);
});
