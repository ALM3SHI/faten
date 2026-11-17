import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The service worker keeps the core screens once a student is signed in:
// with the network gone, «وقتي», the timetable and the map still open from
// what is saved on the device. Pages never opened get a clear offline page.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("core screens open offline after a signed-in visit", async ({ page, context }) => {
  test.slow(); // the worker fetches and stores the core screens first
  await page.goto("/time/");
  await expect(page.getByRole("heading", { name: "وقتي", exact: true })).toBeVisible();

  // The worker is active and has stored the offline screens.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const pages = await caches.open((await caches.keys()).find((k) => k.startsWith("faten-pages-")) ?? "none");
          return (await pages.keys()).map((r) => new URL(r.url).pathname);
        }),
      { timeout: 20_000 },
    )
    .toEqual(expect.arrayContaining(["/time/", "/schedule/", "/locations/"]));

  await context.setOffline(true);

  await page.goto("/schedule/");
  await expect(page.locator("main, #main").first()).toBeVisible();
  await expect(page).toHaveTitle(/فطن/);

  await page.goto("/time/");
  await expect(page.getByRole("heading", { name: "وقتي", exact: true })).toBeVisible();

  // A page never opened before: the offline page, in Arabic, with links that work offline.
  await page.goto("/pomodoro/");
  await expect(page.getByRole("heading", { name: "أنت غير متصل" })).toBeVisible();
  await expect(page.getByRole("link", { name: "الجدول" })).toBeVisible();

  await context.setOffline(false);
});
