import { expect, test, type Page } from "@playwright/test";
import { STUDENT, TINY_PDF, signIn } from "./helpers";

// Each test is its own student so the scripted tutor sessions never collide.
async function asNewStudent(page: Page, name: string) {
  const uid = `e2e-tutor-${name}-${test.info().project.name}`;
  await signIn(page, { ...STUDENT, uid });
}

test("study mode: upload → lecture map → goal → lesson → check with retry → topic mastered, then restored", async ({ page }) => {
  await asNewStudent(page, "journey");
  // the tutor's old address now opens «ذاكر محاضرة», where the file is picked once
  await page.goto("/tutor/");
  await expect(page).toHaveURL(/\/study\/$/);
  await expect(page.getByRole("heading", { name: "ذاكر محاضرة" })).toBeVisible();
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();

  await expect(page.getByText("خريطة المحاضرة: هياكل البيانات: المكدس والطابور")).toBeVisible();
  await expect(page.getByText("قرأتُ 1 صفحة مصوّرة")).toBeVisible();
  await expect(page).toHaveURL(/\/tutor\/\?lecture=/);

  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  await expect(page.getByText("الموضوع 1 من 2")).toBeVisible();
  await page.getByRole("button", { name: "ابدأ الشرح" }).click();
  await expect(page.getByText("آخر داخل أول خارج")).toBeVisible();
  // page citations become slide buttons; code is shown as written
  await expect(page.getByRole("button", { name: /ص 2/ }).first()).toBeVisible();
  await expect(page.locator("pre code")).toContainText("stack.append(1)");

  // wrong first ("2" — as if it were a queue): reason + retry, answer not revealed
  await page.getByRole("radio", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "متأكد", exact: true }).click();
  await expect(page.getByText("ليست بعد")).toBeVisible();
  // wrong while "sure": flagged as a belief to correct, not just a slip
  await expect(page.getByText("كنت متأكداً من هذه الإجابة")).toBeVisible();
  await expect(page.getByText("خلط المكدس بالطابور")).toBeVisible();
  await expect(page.getByText("الإجابة الصحيحة:")).toHaveCount(0);

  await page.getByRole("button", { name: "تلميح", exact: true }).click();
  await expect(page.getByText("أي عنصر دخل آخراً؟")).toBeVisible();

  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "أظن", exact: true }).click();
  await expect(page.getByText("إجابة صحيحة")).toBeVisible();

  await page.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.getByText("أتقنت: المكدس (Stack)")).toBeVisible();
  await expect(page.getByRole("button", { name: "الموضوعات والإتقان" })).toContainText("1/2 متقن");

  // key terms go to the existing flashcards (studyStore)
  await page.getByRole("button", { name: "أضف مصطلحاته لبطاقات المراجعة" }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("uqu_study_v1") || "{}")?.state?.packs?.[0]?.key_terms?.length ?? 0)).toBe(2);

  // topics panel explains the status
  await page.getByRole("button", { name: "الموضوعات والإتقان" }).click();
  const panel = page.getByRole("dialog", { name: "موضوعات المحاضرة" });
  await expect(panel.getByText("متقن", { exact: true })).toBeVisible();
  await expect(panel.getByText("لم يبدأ")).toBeVisible();
  await panel.getByRole("button", { name: "إغلاق" }).first().click();

  // leaving and coming back restores the session
  await page.reload();
  await expect(page.getByText("أتقنت: المكدس (Stack)")).toBeVisible();
  await expect(page.getByRole("button", { name: "الموضوع التالي" })).toBeVisible();

  // back in «ذاكر محاضرة», the lesson sits in the one list of files
  await page.goto("/study/");
  const files = page.getByRole("region", { name: "ملفاتك" });
  const lesson = files.getByRole("listitem").filter({ has: page.getByText("درس", { exact: true }) });
  await expect(lesson.getByText("هياكل البيانات: المكدس والطابور")).toBeVisible();
  // the cards saved during the lesson sit next to it, labelled as cards
  await expect(files.getByRole("listitem").filter({ has: page.getByText("بطاقات", { exact: true }) })).toHaveCount(1);
});

test("asking and studying are the two separate modes of فطن", async ({ page }) => {
  await asNewStudent(page, "modes");
  await page.goto("/chat/");
  const modes = page.getByRole("navigation", { name: "وضع فطن" });
  await expect(modes.getByRole("link", { name: "اسأل" })).toHaveAttribute("aria-current", "page");
  await modes.getByRole("link", { name: "ذاكر محاضرة" }).click();
  await expect(page).toHaveURL(/\/study\/$/);
  await expect(page.getByRole("navigation", { name: "وضع فطن" }).getByRole("link", { name: "ذاكر محاضرة" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("لم ترفع محاضرة بعد")).toBeVisible();
  // the study mode never writes into the chat history
  const chats = await page.evaluate(() => localStorage.getItem("uqu_chat_history_v1"));
  expect(chats === null || !chats.includes("خريطة المحاضرة")).toBe(true);
});

test("a student can report a wrong question and it is skipped", async ({ page }) => {
  await asNewStudent(page, "report");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  await page.getByRole("button", { name: "ابدأ الشرح" }).click();
  // the answer buttons need a choice first
  await expect(page.getByRole("button", { name: "متأكد", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "أبلغ عن خطأ في السؤال" }).click();
  await page.getByRole("button", { name: "الإجابة المعتمدة خاطئة" }).click();
  await expect(page.getByText("شكراً — استبعدت هذا السؤال.")).toBeVisible();
  await expect(page.locator('[role="radiogroup"] button:not([disabled])')).toHaveCount(0);
});
