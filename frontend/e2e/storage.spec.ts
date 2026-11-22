import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedFirestore, signIn } from "./helpers";

/**
 * Saved-data compatibility. `storage-fixture.json` is what a student's browser
 * holds today (every `uqu_*` localStorage key, as the stores wrote it). A new
 * build must still read it: students open the site with months of saved data,
 * and a renamed key or a reshaped store would silently wipe it.
 *
 * If a store's shape changes on purpose, add a `migrate` to that store, keep
 * this fixture as the OLD shape, and extend the assertions — do not re-record
 * the fixture to make the test pass.
 */
const FIXTURE: Record<string, unknown> = JSON.parse(readFileSync("e2e/storage-fixture.json", "utf8"));

async function seed(page: Page) {
  await signIn(page);
  await page.addInitScript((data) => {
    if (window.name.includes("e2e-storage")) return;
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    window.name += " e2e-storage";
  }, FIXTURE);
  // The account document, as Firestore holds it for this student. With the API
  // down the app falls back to reading Firestore directly (auth-provider.tsx),
  // and that copy wins over the browser's — so it must agree with the fixture.
  const profile = (FIXTURE.uqu_profile_v3 as { state: Record<string, unknown> }).state;
  await seedFirestore(page, {
    "users/e2e-omar": { uid: "e2e-omar", email: "omar@test.local", basic: profile.basic, goals: profile.goals, preferences: profile.preferences },
  });
  // The server is unreachable: whatever the pages show comes from saved data.
  await page.route("**/api/workspace", (route) => route.abort());
  await page.route("**/api/analytics/dashboard", (route) => route.abort());
}

test("saved data from an earlier version is still shown when the server is down", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The fixture was recorded in the week of 2026-11-15 (its absence is on that
  // Sunday). Without a fixed clock, "Sunday" (?day=0) moved to the next week
  // and the absence was no longer on screen — the test broke on 2026-11-22.
  await page.clock.setFixedTime(new Date("2026-11-15T09:00:00+03:00"));
  await seed(page);

  await page.goto("/record/");
  await expect(page.getByText("3.56").first()).toBeVisible();
  await expect(page.getByText("3.75").first()).toBeVisible();

  await page.goto("/time/?day=0");
  await expect(page.getByText(/^محاضرة\s*الذكاء الاصطناعي/)).toBeVisible();
  await expect(page.getByRole("button", { name: "سُجّل غياب ✓" })).toBeVisible();

  await page.goto("/chat/");
  await page.getByRole("button", { name: "سجل الدردشات" }).click();
  await expect(page.getByRole("dialog", { name: "سجل الدردشات" }).getByRole("button", { name: /^متى اختباري الجاي؟/ })).toBeVisible();

  expect(errors).toEqual([]);
});

test("every saved key keeps its name, version and fields", async ({ page }) => {
  await seed(page);
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: /^أهلاً/ })).toBeVisible();

  const now = await page.evaluate(() => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith("uqu")) continue;
      const raw = localStorage.getItem(key)!;
      try { out[key] = JSON.parse(raw); } catch { out[key] = raw; }
    }
    return out;
  });

  const shape = (all: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(all)
        // the theme is a device preference, not student data
        .filter(([key]) => key !== "uqu-theme")
        .map(([key, value]) => {
          if (typeof value === "string") return [key, "string"];
          const v = value as { version?: number; state?: Record<string, unknown> };
          return [key, { version: v.version, fields: Object.keys(v.state ?? {}).sort() }];
        })
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );

  expect(shape(now)).toEqual(shape(FIXTURE));
});
