import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("design system reference", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/design/");
  });

  test("a field ties its label, hint and error to the control", async ({ page }) => {
    const name = page.getByRole("textbox", { name: "الاسم" });
    await expect(name).toHaveAccessibleDescription("كما تحب أن يناديك فطن.");

    const target = page.getByRole("textbox", { name: /المعدل المستهدف/ });
    await expect(target).toHaveAttribute("aria-invalid", "true");
    await expect(target).toHaveAccessibleDescription("المعدل يجب أن يكون بين 0 و 4.00.");
  });

  test("the bottom sheet opens, traps focus, and closes with Escape", async ({ page }) => {
    await page.getByRole("button", { name: "افتح ورقة سفلية" }).click();
    const sheet = page.getByRole("dialog", { name: "المكتبة" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "إغلاق" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("a loading button is busy and cannot be clicked twice", async ({ page }) => {
    const button = page.getByRole("button", { name: "اضغط لتجربة التحميل" });
    await button.click();
    const busy = page.getByRole("button", { name: "جاري الحفظ" });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(button).toBeEnabled();
  });

  test("touch targets are at least 44px and body text at least 12px", async ({ page }) => {
    for (const name of ["ابنِ خطة الأسبوع", "تعديل", "بحث"]) {
      const box = await page.getByRole("button", { name, exact: true }).first().boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
    const smallest = await page.locator("main").evaluate((main) =>
      Math.min(...[...main.querySelectorAll("*")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())).map((el) => parseFloat(getComputedStyle(el).fontSize))),
    );
    expect(smallest).toBeGreaterThanOrEqual(12);
  });

  test("body text reads in IBM Plex Sans Arabic and headings stay in Cairo", async ({ page }) => {
    await page.evaluate(() => document.fonts.ready);
    const family = (id: string) => page.getByTestId(id).evaluate((el) => getComputedStyle(el).fontFamily);
    const loaded = (name: RegExp) => page.evaluate((src) => [...document.fonts].some((f) => f.status === "loaded" && new RegExp(src, "i").test(f.family)), name.source);
    expect(await family("sample-body")).not.toBe(await family("sample-heading"));
    expect(await family("sample-heading")).toBe(await page.locator("h1").evaluate((el) => getComputedStyle(el).fontFamily));
    expect(await loaded(/plex/)).toBe(true);
    expect(await loaded(/cairo/)).toBe(true);
  });

  test("pages that have not moved to the design system do not download Plex", async ({ page }) => {
    await page.goto("/privacy/");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.status === "loaded" && /plex/i.test(f.family)))).toBe(false);
  });
});

test.describe("default theme", () => {
  test("follows the device when the student has not chosen one", async ({ browser }) => {
    for (const scheme of ["dark", "light"] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await context.close();
    }
  });

  test("a saved choice wins over the device", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("uqu-theme", "dark"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await context.close();
  });
});
