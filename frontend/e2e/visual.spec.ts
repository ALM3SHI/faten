import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Visual regression: one screenshot of every page, in both themes, on desktop
 * and phone (20 pages × 2 × 2 = 80).
 *
 * Screenshots depend on the machine's font rendering, so the reference images
 * are NOT committed and this suite is skipped unless VISUAL=1. Use it around
 * a redesign on your own machine:
 *
 *   git switch main && npm run build:e2e && npm run visual:baseline   record "before"
 *   git switch my-branch && npm run build:e2e && npm run visual:check  compare "after"
 *
 * A difference is not a failure by itself: open the report
 * (`npx playwright show-report`), look at each diff, and confirm it is a
 * change you meant to make.
 */
test.skip(process.env.VISUAL !== "1", "visual suite runs only with VISUAL=1");

const PUBLIC = ["/", "/login/", "/privacy/", "/locations/"];
const SIGNED_IN = [
  "/dashboard/", "/time/", "/schedule/", "/exams/", "/attendance/", "/pomodoro/",
  "/chat/", "/advisor/", "/study/", "/tutor/",
  "/record/", "/gpa/", "/transcript/",
  "/profile/", "/community/", "/admin/", "/admin/design/",
];

for (const theme of ["dark", "light"] as const) {
  for (const path of [...PUBLIC, ...SIGNED_IN]) {
    test(`visual ${theme} ${path}`, async ({ page }) => {
      // A fixed clock: the pages print today's date, the week and countdowns.
      await page.clock.setFixedTime(new Date("2026-11-15T09:00:00+03:00"));
      if (SIGNED_IN.includes(path)) await signIn(page);
      await page.addInitScript((t) => localStorage.setItem("uqu-theme", t), theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      await expect(page.locator("main, form").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);

      const name = `${path === "/" ? "home" : path.replaceAll("/", "")}-${theme}.png`;
      await expect(page).toHaveScreenshot(name, { animations: "disabled", maxDiffPixelRatio: 0.002 });
    });
  }
}
