import { expect, test } from "@playwright/test";

test("privacy page is public and its sections are linked from the top", async ({ page }) => {
  await page.goto("/privacy/");
  await expect(page.getByRole("heading", { name: "الخصوصية وشروط الاستخدام", level: 1 })).toBeVisible();
  for (const section of ["الخلاصة", "البيانات التي نجمعها", "الذكاء الاصطناعي", "التخزين والنقل", "حقوقك", "شروط الاستخدام"]) {
    await expect(page.getByRole("link", { name: section, exact: true })).toBeVisible();
  }
  await expect(page.getByText("لا نبيع بياناتك ولا نشاركها لأغراض إعلانية.")).toBeVisible();
  await page.getByRole("link", { name: "حقوقك", exact: true }).click();
  await expect(page).toHaveURL(/#rights$/);
});

test("landing page shows the product, the FAQ, and structured data for search engines", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: /شاشة «اليوم» في فطن/ }).first()).toBeVisible();
  await page.getByText("هل فطن مجاني؟").click();
  await expect(page.getByText(/فطن مجاني لطلاب جامعة أم القرى/)).toBeVisible();
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) || "{}");
  const types = ld["@graph"].map((n: { "@type": string }) => n["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebSite", "WebApplication", "FAQPage"]));
});

test("landing content stays visible with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const tour = page.getByRole("heading", { name: "جواب من اللائحة، مع رقم المادة" });
  await tour.scrollIntoViewIfNeeded();
  await expect(tour).toBeVisible();
  await expect(tour.locator("xpath=ancestor::article")).toHaveCSS("opacity", "1");
});

test("forgot password: asks for the email first, then confirms without revealing accounts", async ({ page }) => {
  await page.goto("/login/");
  const forgot = page.getByRole("button", { name: "نسيت كلمة المرور؟" });
  await forgot.click();
  await expect(page.getByText(/اكتب بريدك الإلكتروني في الحقل أولًا/)).toBeVisible();

  await page.getByPlaceholder("البريد الإلكتروني").fill("omar@test.local");
  await forgot.click();
  await expect(page.getByText(/فقد أرسلنا إليه رابط إعادة تعيين كلمة المرور/).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("__e2e_password_reset__"))).toBe('"omar@test.local"');

  // an address with no account gets the same answer, and nothing is sent
  await page.getByPlaceholder("البريد الإلكتروني").fill("missing@test.local");
  await forgot.click();
  await expect(page.getByText(/فقد أرسلنا إليه رابط إعادة تعيين كلمة المرور/)).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem("__e2e_password_reset__"))).toBe('"omar@test.local"');

  // sign-up mode has no password to forget
  await page.getByRole("button", { name: "حساب جديد" }).click();
  await expect(forgot).toHaveCount(0);
});
