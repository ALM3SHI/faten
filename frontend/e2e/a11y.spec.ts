import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { signIn } from "./helpers";

/**
 * Accessibility ratchet (axe-core, WCAG 2.2 A + AA) over every page, in both
 * themes, on desktop and phone.
 *
 * The app has known violations today, so the suite does not demand zero yet.
 * `a11y-baseline.json` records how many elements break each rule on each
 * page; a run fails when a page gets WORSE than its baseline or breaks a
 * rule it did not break before. Fixing things never fails the suite.
 *
 *   npm run test:e2e -- a11y                  check against the baseline
 *   A11Y_UPDATE=1 npm run test:e2e -- a11y    re-record after fixing violations
 *
 * The target is an empty baseline.
 */
const BASELINE_FILE = "e2e/a11y-baseline.json";
const PARTS_DIR = "test-results/a11y-parts";
const UPDATE = process.env.A11Y_UPDATE === "1";

const PUBLIC = ["/", "/login/", "/privacy/", "/locations/"];
const SIGNED_IN = [
  "/dashboard/", "/time/", "/schedule/", "/exams/", "/attendance/", "/pomodoro/",
  "/chat/", "/advisor/", "/study/", "/tutor/",
  "/record/", "/gpa/", "/transcript/",
  "/profile/", "/community/", "/admin/", "/admin/design/",
];

type Counts = Record<string, number>;
type Baseline = Record<string, Counts>;

const baseline: Baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : {};

for (const theme of ["dark", "light"] as const) {
  for (const path of [...PUBLIC, ...SIGNED_IN]) {
    test(`a11y ${theme} ${path}`, async ({ page }, testInfo) => {
      if (SIGNED_IN.includes(path)) await signIn(page);
      await page.addInitScript((t) => localStorage.setItem("uqu-theme", t), theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      // not every page has a heading yet (that is one of the findings), so wait on the page body
      await expect(page.locator("main, form").first()).toBeVisible();
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const found: Counts = {};
      for (const v of results.violations) found[v.id] = v.nodes.length;

      const key = `${testInfo.project.name} ${theme} ${path}`;
      if (UPDATE) {
        // One file per test: workers run in parallel and must not share a file.
        mkdirSync(PARTS_DIR, { recursive: true });
        writeFileSync(`${PARTS_DIR}/${key.replace(/[^a-z0-9]+/gi, "_")}.json`, JSON.stringify({ key, found }));
        return;
      }

      const allowed = baseline[key] ?? {};
      const worse = Object.entries(found)
        .filter(([rule, n]) => n > (allowed[rule] ?? 0))
        .map(([rule, n]) => {
          const v = results.violations.find((x) => x.id === rule)!;
          return `${rule}: ${n} (baseline ${allowed[rule] ?? 0}) — ${v.help}\n    e.g. ${v.nodes[0].target.join(" ")}`;
        });
      expect(worse, `New accessibility violations on ${key}:\n  ${worse.join("\n  ")}`).toEqual([]);
    });
  }
}
