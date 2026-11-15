import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.goto("/chat/");
});

async function ask(page: Page, question: string) {
  const input = page.getByRole("textbox", { name: /اكتب استفسارك/ });
  await input.fill(question);
  await input.press("Enter");
}

test("a conversation is saved to the history, can be searched, reopened and deleted", async ({ page, request }) => {
  const answer = page.getByRole("main").getByText(/موعد اختبارك القادم/);
  await ask(page, "متى اختباري الجاي؟");
  await expect(answer).toBeVisible();

  await page.getByRole("button", { name: "سجل الدردشات" }).click();
  const history = page.getByRole("dialog", { name: "سجل الدردشات" });
  await expect(history.getByText("1 محادثة محفوظة")).toBeVisible();
  // synced to the account, not just this device
  await expect
    .poll(async () => JSON.stringify(await (await request.get("http://localhost:8787/__requests")).json()))
    .toContain("/api/workspace/chats/");

  const search = history.getByPlaceholder("ابحث في المحادثات...");
  const saved = history.getByRole("button", { name: /^متى اختباري الجاي؟/ });
  await search.fill("لا يوجد شيء كهذا");
  await expect(saved).toHaveCount(0);
  await search.fill("اختباري");
  await expect(saved).toBeVisible();

  await history.getByRole("button", { name: "محادثة جديدة" }).click();
  await expect(answer).toHaveCount(0);

  await page.getByRole("button", { name: "سجل الدردشات" }).click();
  await saved.click();
  await expect(answer).toBeVisible();

  await page.getByRole("button", { name: "سجل الدردشات" }).click();
  await history.getByRole("button", { name: "حذف المحادثة" }).click();
  await expect(saved).toHaveCount(0);
});

test("an answer can be rated, and voice input is offered", async ({ page }) => {
  await ask(page, "متى اختباري الجاي؟");
  const rate = page.getByRole("group", { name: "قيّم الرد" });
  await rate.getByRole("button", { name: "رد مفيد" }).click();
  await expect(rate.getByRole("button", { name: "رد مفيد" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "إدخال صوتي" })).toBeVisible();
});

test("the agent can change the app: a new target GPA is saved to the profile", async ({ page }) => {
  await ask(page, "خل هدفي 3.9");
  await expect(page.getByText("تم. جعلت معدلك المستهدف 3.90.")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("uqu_profile_v3") || "{}")?.state?.goals?.targetGpa))
    .toBe(3.9);
});
