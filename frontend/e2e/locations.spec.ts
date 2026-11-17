import { expect, test } from "@playwright/test";

// The map is public: no sign-in, so a visitor can find a room from a shared link.
test("search finds a room, and picking it draws a route from the main entrance", async ({ page }) => {
  await page.goto("/locations/");
  await expect(page.getByRole("heading", { name: "الخريطة", level: 1 })).toBeVisible();

  await page.getByRole("textbox", { name: "بحث", exact: true }).fill("المكتبة");
  const library = page.getByRole("button", { name: /^المكتبة/ });
  await expect(library).toBeVisible();
  // the search narrows the list
  await expect(page.getByRole("button", { name: /^قاعة 1 / })).toHaveCount(0);

  await library.click();
  await expect(page.getByRole("heading", { name: "المكتبة", level: 3 })).toBeVisible();
  await expect(page.getByText("المدخل الرئيسي")).toBeVisible();
  await page.getByRole("button", { name: "ابدأ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "المسار" })).toBeVisible();
  await expect(page.getByText("المسافة")).toBeVisible();
  await expect(page.getByText(/^\d+ م$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /تغيير نقطة البداية/ })).toBeVisible();
});

test("the map can be zoomed and reset", async ({ page, isMobile }) => {
  // Known gap, tracked for the map redesign: on phones the room list is drawn
  // over the map, so the zoom buttons cannot be tapped until a room is picked.
  test.fixme(isMobile, "room list covers the zoom buttons on phones");
  await page.goto("/locations/");
  await page.getByRole("button", { name: "تكبير" }).click();
  await page.getByRole("button", { name: "تصغير" }).click();
  await page.getByRole("button", { name: "إعادة الضبط" }).click();
  await expect(page.getByRole("heading", { name: "الخريطة", level: 1 })).toBeVisible();
});
