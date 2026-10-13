import type { Page } from "@playwright/test";

export const STUDENT = { uid: "e2e-omar", email: "omar@test.local", displayName: "عمر", emailVerified: true };

/** Start the page already signed in (fake Firebase reads this key). */
export async function signIn(page: Page, user = STUDENT): Promise<void> {
  await page.addInitScript((u) => {
    if (!sessionStorage.getItem("__e2e_seeded__")) {
      localStorage.setItem("__e2e_auth_user__", JSON.stringify(u));
      sessionStorage.setItem("__e2e_seeded__", "1");
    }
  }, user);
}

/** Put documents into the fake Firestore before the app loads. */
export async function seedFirestore(page: Page, docs: Record<string, unknown>): Promise<void> {
  await page.addInitScript((d) => {
    if (sessionStorage.getItem("__e2e_fs_seeded__")) return;
    const all = JSON.parse(localStorage.getItem("__e2e_firestore__") || "{}");
    localStorage.setItem("__e2e_firestore__", JSON.stringify({ ...all, ...d }));
    sessionStorage.setItem("__e2e_fs_seeded__", "1");
  }, docs);
}

/** Read the fake Firestore as the app left it. */
export async function readFirestore(page: Page): Promise<Record<string, Record<string, unknown>>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("__e2e_firestore__") || "{}"));
}

/** Minimal valid PDF bytes — the mock API never parses it. */
export const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  "utf8",
);
