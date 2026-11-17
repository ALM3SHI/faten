import { expect, test, type Page } from "@playwright/test";
import { STUDENT, TINY_PDF, signIn } from "./helpers";

// Phase 6 motion: every mark and number is real content first, motion second.
// With reduced motion nothing may stay hidden; without it, the strokes draw.

async function strokesState(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("svg.sketch")].map((svg) => ({
      state: svg.getAttribute("data-sketch"),
      offsets: [...svg.querySelectorAll("path")].map((p) => getComputedStyle(p).strokeDashoffset),
    })),
  );
}

test("reduced motion: the landing page and its chalkboard are fully drawn and readable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("اللائحة");

  // every section heading is visible once scrolled to
  for (const h of await page.getByRole("heading", { level: 2 }).all()) {
    await h.scrollIntoViewIfNeeded();
    await expect(h).toBeVisible();
  }
  const board = page.getByRole("region", { name: "سؤال، وجواب من اللائحة" });
  await board.scrollIntoViewIfNeeded();
  await expect(board.getByText("كم مرة أقدر أغيب قبل الحرمان؟")).toBeVisible();
  await expect(board.getByText("15%")).toBeVisible();

  // no stroke was ever hidden: JS left them alone, and every path is fully drawn
  const strokes = await strokesState(page);
  expect(strokes.length).toBeGreaterThan(2);
  for (const s of strokes) {
    expect(s.state).toBeNull();
    for (const o of s.offsets) expect(parseFloat(o)).toBe(0);
  }
});

test("with motion, the chalk marks draw themselves when the board scrolls into view", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const board = page.getByRole("region", { name: "سؤال، وجواب من اللائحة" });
  // below the fold: waiting to be drawn
  await expect.poll(async () => (await strokesState(page)).some((s) => s.state === "wait")).toBe(true);
  await board.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const svgs = board.locator("svg.sketch");
      // marks hidden at this width (the desktop-only arrow) never draw, and needn't
      return svgs.evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).every((e) => e.getAttribute("data-sketch") === "draw"));
    })
    .toBe(true);
  // and they finish fully drawn
  await expect
    .poll(async () =>
      board
        .locator("svg.sketch path")
        .evaluateAll((ps) => ps.filter((p) => p.getClientRects().length > 0).every((p) => parseFloat(getComputedStyle(p).strokeDashoffset) === 0)),
    )
    .toBe(true);
});

test("the GPA counts up and lands on the exact value", async ({ page }) => {
  await signIn(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/record/");
  await expect(page.getByText("3.56").first()).toBeVisible();
});

test("«وضع السبورة» puts the lesson on a chalkboard and is remembered", async ({ page }) => {
  await signIn(page, { ...STUDENT, uid: `e2e-board-${test.info().project.name}` });
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await expect(page.getByText("خريطة المحاضرة: هياكل البيانات: المكدس والطابور")).toBeVisible();

  const toggle = page.getByRole("button", { name: /السبورة/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".board-mode")).toBeVisible();
  // the lesson text is still there, now in chalk
  await expect(page.locator(".board-mode").getByText("خريطة المحاضرة: هياكل البيانات: المكدس والطابور")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /السبورة/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".board-mode")).toBeVisible();
});
