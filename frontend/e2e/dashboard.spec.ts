import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";
import { readFileSync } from "node:fs";

// Playwright runs from the frontend folder (playwright.config.ts).
const FIXTURE = JSON.parse(readFileSync("e2e/advisor-fixture.json", "utf8"));

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("one strip of numbers on the home page opens «معدّلي»", async ({ page }) => {
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "أهلاً عمر" })).toBeVisible();
  const strip = page.getByRole("link", { name: "افتح معدّلي" });
  await expect(strip.getByText("3.56")).toBeVisible();
  // the analysis moved out of the home page
  await expect(page.getByRole("tab", { name: "روافع المعدل" })).toHaveCount(0);
  await strip.click();
  await expect(page).toHaveURL(/\/record\/?$/);
});

test("«معدّلي» shows the student's numbers and the analysis", async ({ page }) => {
  await page.goto("/record/");
  await expect(page.getByText("3.56").first()).toBeVisible();
  await expect(page.getByText("3.75").first()).toBeVisible();
  await expect(page.getByText("معدلك مستقر بين الفصلين")).toBeVisible();
  await expect(page.getByText(/11% · باقي/)).toBeVisible();
  await page.getByRole("tab", { name: "روافع المعدل" }).click();
  await expect(page.getByText("أعلى أثر على معدلك")).toBeVisible();
});

test("earned-hours dialog uses the graduation summary", async ({ page }) => {
  await page.goto("/record/");
  await page.getByRole("button", { name: /^الساعات/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("تقدم الساعات")).toBeVisible();
  await expect(dialog.getByText("15 / 132 ساعة")).toBeVisible();
  await expect(dialog.getByText("مقدمة في البرمجة")).toBeVisible();
});

test("target dialog uses next-term hours from the analysis", async ({ page }) => {
  await page.goto("/record/");
  await page.getByRole("button", { name: /^المستهدف/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("15 ساعة", { exact: true })).toBeVisible();
  await expect(dialog.getByText("الحد الأقصى الممكن:")).toBeVisible();
});

test("today: what's next, the week at a glance, and the ask box", async ({ page }) => {
  await page.goto("/dashboard/");
  // the mock timetable always has a lecture within the coming week
  const next = page.getByRole("region", { name: /^التالي/ });
  await expect(next.getByText(/الذكاء الاصطناعي|قواعد البيانات/)).toBeVisible();
  await expect(next.getByRole("link", { name: "وين القاعة؟" })).toBeVisible();
  await expect(page.getByRole("region", { name: "اليوم", exact: true })).toBeVisible();

  // a day of the small week strip opens «وقتي» on that day
  await page.getByRole("group", { name: "أيام الأسبوع" }).getByRole("button", { name: /^الثلاثاء/ }).click();
  await expect(page).toHaveURL(/\/time\/?\?day=2$/);
  await expect(page.getByRole("tablist", { name: "أيام الأسبوع" }).getByRole("tab", { name: /^الثلاثاء/ })).toHaveAttribute("aria-selected", "true");

  await page.goto("/dashboard/");
  await page.getByRole("searchbox").or(page.getByLabel("اسأل فطن")).first().fill("كم أغيب قبل الحرمان؟");
  await page.getByRole("button", { name: "اسأل", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/?\?query=/);
});

test("the university calendar and news open from the home page", async ({ page }) => {
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "التقويم والأخبار" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("tab", { name: "أخبار الجامعة" })).toBeVisible();
});

test("«معدّلي» shows the advisor's latest advice without re-running it", async ({ page }) => {
  await page.route("**/api/advisor/latest", (route) => route.fulfill({ json: { run: FIXTURE.run } }));
  await page.goto("/record/");
  const advice = page.getByRole("region", { name: "المرشد يقترح" });
  await expect(advice.getByText("الفصل الثاني 1448")).toBeVisible();
  await expect(advice.getByText("5 مقررات · 12 ساعة")).toBeVisible();
  await expect(advice.getByText("برمجة الحاسب بلغة جافا")).toBeVisible();
  await expect(advice.getByText(/رسبت في CS1701 مرتين/)).toBeVisible();
  await advice.getByRole("link", { name: /لماذا؟/ }).click();
  await expect(page).toHaveURL(/\/advisor\/?$/);
});

test("«معدّلي» invites a first analysis when there is none", async ({ page }) => {
  await page.goto("/record/");
  await expect(page.getByRole("link", { name: /وش أسجّل الفصل القادم؟/ })).toBeVisible();
});
