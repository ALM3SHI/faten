import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("desktop sidebar: the spaces, the pages of the current space, and the tools", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones use the bottom bar");
  await page.goto("/exams/");

  const spaces = page.getByRole("navigation", { name: "الأقسام" });
  await expect(spaces.getByRole("link")).toHaveText(["اليوم", "وقتي", "فطن", "معدّلي"]);

  // every page of «وقتي» is one click away, and the current one is marked
  const inSpace = page.getByRole("navigation", { name: "صفحات وقتي" });
  await expect(inSpace.getByRole("link")).toHaveText(["وقتي", "الجدول", "الاختبارات", "الغياب", "جلسة تركيز"]);
  await expect(inSpace.getByRole("link", { name: "الاختبارات" })).toHaveAttribute("aria-current", "page");
  await inSpace.getByRole("link", { name: "الغياب" }).click();
  await expect(page).toHaveURL(/\/attendance\/?$/);

  // the map and the reviews are no longer hidden in the account menu
  await page.getByRole("navigation", { name: "أدوات" }).getByRole("link", { name: "الخريطة والقاعات" }).click();
  await expect(page).toHaveURL(/\/locations\/?$/);
  await expect(page.getByRole("heading", { name: "الخريطة", level: 1 })).toBeVisible();
});

test("the sidebar does not cover the page or the top bar", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones use the bottom bar");
  await page.goto("/dashboard/");
  const sidebar = await page.getByRole("complementary").filter({ has: page.getByRole("navigation", { name: "الأقسام" }) }).boundingBox();
  const heading = await page.getByRole("heading", { name: /^أهلاً/ }).boundingBox();
  const account = await page.getByRole("button", { name: "حسابي والقائمة" }).boundingBox();
  // RTL: the sidebar is on the right; everything else must end before it starts
  expect(heading!.x + heading!.width).toBeLessThanOrEqual(sidebar!.x);
  expect(account!.x + account!.width).toBeLessThanOrEqual(sidebar!.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("phones keep the bottom bar and get no sidebar", async ({ page, isMobile }) => {
  test.skip(!isMobile, "desktop uses the sidebar");
  await page.goto("/dashboard/");
  await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "أدوات" })).toBeHidden();
});

test("command palette: find a page by typing and open it with Enter", async ({ page }) => {
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "ابحث أو انتقل" }).first().click();
  const box = page.getByRole("combobox");
  await expect(box).toBeFocused();
  // before typing: pages and quick actions are listed
  await expect(page.getByRole("option", { name: /سجّل غيابًا/ })).toBeVisible();

  await box.fill("حرمان");
  await expect(page.getByRole("option").first()).toContainText("الغياب");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/attendance\/?$/);
  await expect(page.getByRole("dialog", { name: "ابحث أو انتقل" })).toHaveCount(0);
});

test("command palette: opens with Ctrl+K, finds a room, and closes with Escape", async ({ page }) => {
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: /^أهلاً/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox");
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("المكتبة");
  const room = page.getByRole("option", { name: /المكتبة.*على الخريطة/ });
  await expect(room).toBeVisible();
  await room.click();
  await expect(page).toHaveURL(/\/locations\/\?target=/);
  // the link opens the map with the route from the main entrance already drawn
  await expect(page.getByRole("heading", { name: "المسار" })).toBeVisible();
  await expect(page.getByText(/إلى:s*المكتبة/)).toBeVisible();
});

test("command palette: arrow keys move, and any text can be sent to Faten", async ({ page }) => {
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: /^أهلاً/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox");
  await box.fill("متى يصير الحرمان؟");
  const ask = page.getByRole("option", { name: /اسأل فطن/ });
  await expect(ask).toBeVisible();
  // the question matches no page, so "ask Faten" is the only option
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(ask).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/chat\/\?query=/);
  await expect(page.getByRole("button", { name: /عرض المصدر: المادة 14/ })).toBeVisible();
});

test("command palette can switch the theme, and the toggle follows", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("uqu-theme", "dark"));
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: /^أهلاً/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("الفاتح");
  await page.getByRole("combobox").press("Enter");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await expect(page.getByRole("button", { name: "تفعيل الوضع الداكن" })).toBeVisible();
});

test("skip link is the first stop and jumps to the content", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard navigation");
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: /^أهلاً/ })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "تخطَّ إلى المحتوى" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();
});
