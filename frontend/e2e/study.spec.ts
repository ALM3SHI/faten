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
  await expect(page.getByRole("heading", { name: "مرحباً بعودتك" })).toBeVisible();
  const local = await page.evaluate(() => localStorage.getItem("uqu_study_v1"));
  expect(local).toBeNull();
  // signed out: the fake auth record was wiped with the rest of the device data
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("__e2e_auth_user__") ?? "null"))).toBeNull();
});

test("flashcards: hard cards come back, progress is saved with the pack", async ({ page }) => {
  const terms = [
    { term: "Neuron", definition: "وحدة حسابية" },
    { term: "ReLU", definition: "دالة تنشيط" },
    { term: "Epoch", definition: "مرور كامل على البيانات" },
  ];
  await seedFirestore(page, {
    [DOC]: {
      packs: [{ id: "fc", fileName: "nn.pdf", createdAt: "2026-10-10T10:00:00.000Z", title: "بطاقات الشبكات", summary: [], key_terms: terms, quiz: [] }],
      deletedIds: [],
      lastUpdated: "2026-10-10T10:00:00.000Z",
    },
  });
  await signIn(page);
  await page.goto("/study/");
  await expect(page.getByText("3 بطاقات للمراجعة")).toBeVisible();
  await page.getByText("بطاقات الشبكات").click();
  await page.getByRole("tab", { name: "البطاقات" }).click();
  await expect(page.getByText("باقي اليوم: 3 من 3 بطاقة")).toBeVisible();

  // Neuron is hard → it comes back after two cards
  await expect(page.getByText("Neuron")).toBeVisible();
  await page.getByRole("button", { name: "أظهر الإجابة" }).click();
  await expect(page.getByText("وحدة حسابية")).toBeVisible();
  await page.getByRole("button", { name: /^صعبة/ }).click();
  await expect(page.getByText("باقي اليوم: 3 من 3 بطاقة")).toBeVisible();
  for (const term of ["ReLU", "Epoch"]) {
    await expect(page.getByText(term, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "أظهر الإجابة" }).click();
    await page.getByRole("button", { name: /^سهلة/ }).click();
  }
  await expect(page.getByText("Neuron")).toBeVisible();
  await page.getByRole("button", { name: "أظهر الإجابة" }).click();
  await page.getByRole("button", { name: /^متوسطة/ }).click();
  await expect(page.getByRole("heading", { name: "خلصت مراجعة اليوم" })).toBeVisible();

  await expect
    .poll(async () => {
      const packs = (await readFirestore(page))[DOC]?.packs as { reviews?: Record<string, { box: number }> }[] | undefined;
      return packs?.[0]?.reviews;
    })
    .toMatchObject({ neuron: { box: 1 }, relu: { box: 2 }, epoch: { box: 2 } });
});
