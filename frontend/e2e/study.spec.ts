import { expect, test } from "@playwright/test";
import { readFirestore, seedFirestore, signIn, STUDENT, TINY_PDF } from "./helpers";

const DOC = `users/${STUDENT.uid}/study/packs`;

test("a lecture PDF becomes a study pack saved to the account", async ({ page }) => {
  await signIn(page);
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "lecture.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "جهّز لي المذاكرة" }).click();

  await expect(page.getByRole("heading", { name: "مقدمة في الشبكات العصبية" })).toBeVisible();
  await page.getByRole("tab", { name: /المصطلحات/ }).click();
  await expect(page.getByText("Backpropagation")).toBeVisible();

  // pushed to users/{uid}/study/packs (debounced)
  await expect.poll(async () => ((await readFirestore(page))[DOC]?.packs as unknown[] | undefined)?.length ?? 0).toBe(1);
});

test("packs saved on another device appear after sign-in", async ({ page }) => {
  await seedFirestore(page, {
    [DOC]: {
      packs: [
        {
          id: "from-laptop",
          fileName: "os.pdf",
          createdAt: "2026-10-10T10:00:00.000Z",
          title: "إدارة الذاكرة في أنظمة التشغيل",
          summary: ["الذاكرة الافتراضية"],
          key_terms: [{ term: "Paging", definition: "تقسيم الذاكرة لصفحات" }],
          quiz: [],
        },
      ],
      deletedIds: [],
      lastUpdated: "2026-10-10T10:00:00.000Z",
    },
  });
  await signIn(page);
  await page.goto("/study/");
  await expect(page.getByText("إدارة الذاكرة في أنظمة التشغيل")).toBeVisible();
});

test("deleting a pack reaches the account, and logout clears the device", async ({ page }) => {
  await seedFirestore(page, {
    [DOC]: {
      packs: [
        { id: "p1", fileName: "a.pdf", createdAt: "2026-10-10T10:00:00.000Z", title: "حزمة للحذف", summary: [], key_terms: [], quiz: [] },
      ],
      deletedIds: [],
      lastUpdated: "2026-10-10T10:00:00.000Z",
    },
  });
  await signIn(page);
  await page.goto("/study/");
  await expect(page.getByText("حزمة للحذف")).toBeVisible();
  await page.getByRole("button", { name: "حذف", exact: true }).click();
  await expect(page.getByText("حزمة للحذف")).toHaveCount(0);
  await expect
    .poll(async () => (await readFirestore(page))[DOC]?.deletedIds)
    .toEqual(["p1"]);

  // Logout purges the device copy (studyStore is in the purge list).
  await page.goto("/profile/");
  await page.getByRole("button", { name: "خروج" }).first().click();
  await expect(page).toHaveURL(/\/login\//);
  const local = await page.evaluate(() => localStorage.getItem("uqu_study_v1"));
  expect(local).toBeNull();
});
