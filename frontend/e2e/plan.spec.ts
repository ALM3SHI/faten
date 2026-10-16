import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("build the week, then tick a session done and see it on the strip", async ({ page }) => {
  await page.goto("/plan/");
  await expect(page.getByRole("heading", { name: "خطة المذاكرة" })).toBeVisible();
  const build = page.getByRole("region", { name: "ابنِ أسبوعك" });
  await expect(build.getByText(/مواد? من سجلك هذا الفصل/)).toBeVisible();
  await build.getByRole("button", { name: "ابنِ خطة الأسبوع" }).click();

  await expect(page.getByText(/أنجزت 0 من 4 جلسات هذا الأسبوع/)).toBeVisible();
  const strip = page.getByRole("tablist", { name: "أيام الأسبوع" });
  await strip.getByRole("tab", { name: /^الأحد/ }).click();
  const day = page.getByRole("region", { name: /الأحد/ });
  await expect(day.getByText("بداية الأسبوع: مراجعة خفيفة بعد المحاضرة.")).toBeVisible();
  // the lecture is context, the session is the card
  await expect(day.getByText(/^محاضرة\s*الذكاء الاصطناعي\s*حتى/)).toBeVisible();
  await day.getByRole("button", { name: "ليش هذي الجلسة؟" }).click();
  await expect(day.getByText(/بعد محاضرة الذكاء الاصطناعي بيوم/)).toBeVisible();

  await day.getByRole("button", { name: /^تم: مراجعة الذكاء الاصطناعي/ }).click();
  await expect(page.getByText(/أنجزت 1 من 4 جلسات/)).toBeVisible();
  await expect(strip.getByRole("tab", { name: /^الأحد/ })).toHaveAttribute("aria-label", /أنجزت 50 د/);

  // every current course appears in the balance
  const balance = page.getByRole("region", { name: "وقتك على المواد" });
  await expect(balance.getByText("50 د من 1.6 س").first()).toBeVisible();
});

test("a session starts a focus timer, and a dated appointment shows on its day", async ({ page }) => {
  await page.goto("/plan/");
  await page.getByRole("button", { name: "ابنِ خطة الأسبوع" }).click();
  await page.getByRole("tablist", { name: "أيام الأسبوع" }).getByRole("tab", { name: /^الأحد/ }).click();
  await page.getByRole("button", { name: "ابدأ" }).first().click();
  await expect(page).toHaveURL(/\/pomodoro\/?$/);
  await expect(page.getByText("مراجعة الذكاء الاصطناعي")).toBeVisible();
});

test("rebuilding asks first, and keeps the week", async ({ page }) => {
  await page.goto("/plan/");
  await page.getByRole("button", { name: "ابنِ خطة الأسبوع" }).click();
  await expect(page.getByText(/من 4 جلسات/)).toBeVisible();
  await page.getByRole("button", { name: "أعد بناء الأسبوع" }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog.getByText(/مواعيدك المسجّلة تبقى كما هي/)).toBeVisible();
  await dialog.getByRole("button", { name: "أعد البناء" }).click();
  await expect(page.getByText(/أنجزت 0 من 4 جلسات/)).toBeVisible();
});
