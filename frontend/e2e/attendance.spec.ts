import { expect, test } from "@playwright/test";
import { readFirestore, seedFirestore, signIn, STUDENT } from "./helpers";

const DOC = `users/${STUDENT.uid}/academic_record/attendance`;

test("absences recorded on another device appear after sign-in", async ({ page }) => {
  await seedFirestore(page, {
    [DOC]: {
      courses: {
        CS3301: {
          entries: [
            { id: "a1", date: "2026-10-05", excused: false },
            { id: "a2", date: "2026-10-07", excused: true },
          ],
          totalOverride: null,
        },
      },
      lastUpdated: "2026-10-08T08:00:00.000Z",
    },
  });
  await signIn(page);
  await page.goto("/attendance/");

  // the workspace comes from the mock API, attendance from Firestore
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("uqu_attendance_v1");
        return raw ? JSON.parse(raw).state?.courses?.CS3301?.entries?.length ?? 0 : 0;
      }),
    )
    .toBe(2);
  // nothing newer on this device, so nothing is written back
  expect((await readFirestore(page))[DOC]?.lastUpdated).toBe("2026-10-08T08:00:00.000Z");
});
