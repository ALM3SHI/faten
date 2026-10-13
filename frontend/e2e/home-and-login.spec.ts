import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("home page introduces Faten and links to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page).toHaveTitle(/فطن/);
  const start = page.getByText("ابدأ مجانًا").first();
  await expect(start).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/login\//);
});

test("protected pages send signed-out visitors to /login and back", async ({ page }) => {
  await page.goto("/dashboard/");
  await expect(page).toHaveURL(/\/login\/\?next=%2Fdashboard%2F/);

  await page.getByPlaceholder("البريد الإلكتروني").fill("omar@test.local");
  await page.getByPlaceholder("كلمة المرور").fill("correct-horse-1");
  await page.locator("form").getByRole("button", { name: /دخول/ }).click();

  await expect(page).toHaveURL(/\/dashboard\/$/);
  // first sign-in on this account → the welcome tour opens over the dashboard
  await page.getByRole("dialog").getByRole("button", { name: "تخطي الجولة" }).click();
  await expect(page.getByRole("heading", { name: "لوحة المعلومات" })).toBeVisible();
});

test("wrong credentials show an Arabic error and stay on /login", async ({ page }) => {
  await page.goto("/login/");
  await page.getByPlaceholder("البريد الإلكتروني").fill("wrong@test.local");
  await page.getByPlaceholder("كلمة المرور").fill("whatever-123");
  await page.locator("form").getByRole("button", { name: /دخول/ }).click();
  await expect(page.getByText(/البريد الإلكتروني أو كلمة المرور/)).toBeVisible();
  await expect(page).toHaveURL(/\/login\//);
});

test("signed-in students skip the login page", async ({ page }) => {
  await signIn(page);
  await page.goto("/login/");
  await expect(page).toHaveURL(/\/dashboard\/$/);
});
