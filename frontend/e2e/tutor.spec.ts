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
  // one progress line for the course, in the course bar
  await expect(page.getByRole("progressbar", { name: "تقدّم الدورة: أتقنت 1 من 2" })).toHaveAttribute("aria-valuenow", "50");

  // key terms go to the existing flashcards (studyStore)
  await page.getByRole("button", { name: "أضف مصطلحاته لبطاقات المراجعة" }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("uqu_study_v1") || "{}")?.state?.packs?.[0]?.key_terms?.length ?? 0)).toBe(2);

  // the course menu explains each unit's status: beside the lesson on wide
  // screens, as a drawer on phones
  if (test.info().project.name.includes("mobile")) {
    await page.getByRole("button", { name: "محتوى الدورة والإتقان" }).click();
    const panel = page.getByRole("dialog", { name: "موضوعات المحاضرة" });
    await expect(panel.getByText("متقن", { exact: true })).toBeVisible();
    await expect(panel.getByText("لم يبدأ")).toBeVisible();
    await panel.getByRole("button", { name: "إغلاق" }).first().click();
  } else {
    const outline = page.getByRole("complementary", { name: "محتوى الدورة" });
    await expect(outline.getByText(/متقن · ~/)).toBeVisible();
    await expect(outline.getByText(/لم يبدأ · ~/)).toBeVisible();
  }

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

test("the lecture reads as a course: units beside the lesson, and a diagram drawn from the lecture", async ({ page }) => {
  await asNewStudent(page, "course");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await expect(page.getByText("خريطة المحاضرة: هياكل البيانات: المكدس والطابور")).toBeVisible();

  // focus mode: the app's own navigation steps aside — one bar, never a nav inside a nav
  await expect(page.getByRole("navigation", { name: "الأقسام" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "رجوع إلى محاضراتي" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /تقدّم الدورة/ })).toHaveCount(1);

  const outline = page.getByRole("complementary", { name: "محتوى الدورة" });
  if (test.info().project.name.includes("mobile")) {
    // phones keep the topics drawer instead of a side column
    await expect(outline).toBeHidden();
  } else {
    await expect(outline.getByText("دورة من محاضرتك")).toBeVisible();
    // two units, then the final exam
    await expect(outline.getByRole("navigation", { name: "وحدات الدورة" }).getByRole("button")).toHaveCount(3);
    await expect(outline.getByText("وحدتان · 30 دقيقة · 6 صفحات")).toBeVisible();
    // the course menu folds away for a wider lesson, and stays folded
    await page.getByRole("button", { name: "إخفاء محتوى الدورة" }).click();
    await expect(outline).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "إظهار محتوى الدورة" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "إظهار محتوى الدورة" }).click();
    await expect(outline).toBeVisible();
  }

  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  await page.getByRole("button", { name: "ابدأ الشرح" }).click();
  await expect(page.getByText("آخر داخل أول خارج")).toBeVisible();

  const figure = page.locator("figure").filter({ has: page.locator("[data-diagram]") });
  await expect(figure).toBeVisible();
  await expect(figure.getByText("مخطط من محاضرتك")).toBeVisible();
  await expect(figure.getByText("الدفع يضيف للأعلى والسحب يأخذ من الأعلى").first()).toBeVisible();
  // the diagram's content is readable without seeing it
  await expect(figure.locator(".sr-only li")).toHaveText(["push إلى المكدس: يضيف للأعلى", "المكدس إلى pop: يسحب الأعلى"]);
  const at = await figure.locator("svg text").evaluateAll((els) =>
    Object.fromEntries(els.map((e) => [e.textContent, e.getBoundingClientRect().toJSON()])),
  );
  if (test.info().project.name.includes("mobile")) {
    // too wide for a phone: the flow is stacked top to bottom instead of cut off
    expect(at["push"].y).toBeLessThan(at["المكدس"].y);
    expect(at["المكدس"].y).toBeLessThan(at["pop"].y);
  } else {
    // drawn right to left: the first step is to the right of the next one
    expect(at["push"].x).toBeGreaterThan(at["المكدس"].x);
    expect(at["المكدس"].x).toBeGreaterThan(at["pop"].x);
  }
  // nothing is cut off: the whole drawing fits its box
  const fits = await figure.locator("[data-diagram]").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);

  if (!test.info().project.name.includes("mobile")) {
    await expect(outline.getByRole("button", { name: /المكدس/ })).toHaveAttribute("aria-current", "step");
  }
});

test("a new lecture is prepared in the background with live progress, then opens by itself", async ({ page }) => {
  await asNewStudent(page, "prepare");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "new-lecture.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();

  const card = page.getByRole("region", { name: "نجهّز محاضرتك" });
  await expect(card).toBeVisible();
  await expect(card.getByText("new-lecture")).toBeVisible();
  await expect(card.getByRole("progressbar", { name: "تقدّم التجهيز" })).toBeVisible();
  await expect(card.getByText("تقدر تطلع من الصفحة")).toBeVisible();
  // the stages move on as the server reports them
  await expect(card.getByText("نرتّب المحاضرة في وحدات (الجزء 1 من 2)")).toBeVisible({ timeout: 8000 });
  // the first unit's lesson is written before the course opens
  await expect(card.getByRole("listitem").filter({ hasText: "نكتب درس الوحدة الأولى لتبدأ فوراً" })).toContainText("الآن", { timeout: 8000 });
  await expect(card.getByText("والوحدات التالية تُجهَّز وأنت تذاكر", { exact: false })).toBeVisible();

  // ready → the course opens without another click
  await expect(page).toHaveURL(/\/tutor\/\?lecture=/, { timeout: 15000 });
  await expect(page.getByText("خريطة المحاضرة: هياكل البيانات: المكدس والطابور")).toBeVisible();
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

test("each topic opens on its own page: the last topic's lesson does not run on into the next", async ({ page }) => {
  await asNewStudent(page, "sections");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await expect(page.getByText("خريطة المحاضرة: هياكل البيانات: المكدس والطابور")).toBeVisible();

  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  // the lecture map belongs to the overview, not to the first topic
  await expect(page.getByText("الموضوع 1 من 2")).toBeVisible();
  await expect(page.getByText("خريطة المحاضرة: هياكل البيانات: المكدس والطابور")).toHaveCount(0);
  await page.getByRole("button", { name: "ابدأ الشرح" }).click();
  await expect(page.getByText("آخر داخل أول خارج")).toBeVisible();

  // jump to the second topic before finishing the first
  if (test.info().project.name.includes("mobile")) {
    await page.getByRole("button", { name: "محتوى الدورة والإتقان" }).click();
    await page.getByRole("dialog", { name: "موضوعات المحاضرة" }).getByRole("button", { name: "ابدأه" }).click();
  } else {
    await page.getByRole("complementary", { name: "محتوى الدورة" }).getByRole("button", { name: /الطابور/ }).click();
  }
  await expect(page.getByText("الموضوع 2 من 2")).toBeVisible();
  await expect(page.getByText("يرتّب المهام بالدور.")).toBeVisible();
  // nothing of topic 1 is left on the page
  await expect(page.getByText("آخر داخل أول خارج")).toHaveCount(0);
  await expect(page.getByText("الموضوع 1 من 2")).toHaveCount(0);

  // the same after a reload
  await page.reload();
  await expect(page.getByText("الموضوع 2 من 2")).toBeVisible();
  await expect(page.getByText("آخر داخل أول خارج")).toHaveCount(0);
});

test("the slides get pdf.js's character maps and standard fonts, so Arabic and symbols draw right", async ({ page }) => {
  for (const path of ["/pdfjs/cmaps/UniJIS-UCS2-H.bcmap", "/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap", "/pdfjs/standard_fonts/LiberationSans-Regular.ttf", "/pdfjs/wasm/openjpeg.wasm"]) {
    const r = await page.request.get(path);
    expect(r.status(), path).toBe(200);
    expect((await r.body()).length, path).toBeGreaterThan(100);
  }
});

test("a lesson says what each piece is for and whether it comes from the student's file", async ({ page }) => {
  await asNewStudent(page, "parts");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  await page.getByRole("button", { name: "ابدأ الشرح" }).click();

  const idea = page.getByRole("region", { name: "الفكرة" }).last();
  await expect(idea).toContainText("آخر داخل أول خارج");
  await expect(idea).toContainText("من ملفك");
  await expect(idea.getByRole("button", { name: "افتح الشريحة 2" })).toBeVisible();
  const life = page.getByRole("region", { name: "من الواقع" });
  await expect(life).toContainText("إضافة توضيحية");
  await expect(life).not.toContainText("من ملفك");
  await expect(page.getByRole("region", { name: "الكود خطوة بخطوة" }).locator("pre code")).toContainText("stack.append(1)");
  await expect(page.getByRole("region", { name: "الخلاصة" })).toBeVisible();
  await expect(page.getByText("راجعنا كل ما وُسم «من ملفك» مقابل صفحاتك.")).toBeVisible();

  // the page chip opens that slide
  await idea.getByRole("button", { name: "افتح الشريحة 2" }).click();
  await expect(page.getByRole("dialog").getByText("الشريحة 2 من 6")).toBeVisible();
});

test("each lesson has its own link: the address follows the topic and opens it", async ({ page }) => {
  await asNewStudent(page, "link");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  await expect(page).toHaveURL(/[?&]topic=t1(&|$)/);
  const id = new URL(page.url()).searchParams.get("lecture");

  // a link to the second topic opens it
  await page.goto(`/tutor/?lecture=${id}&topic=t2`);
  await expect(page.getByText("الموضوع 2 من 2")).toBeVisible();
  await expect(page).toHaveURL(/[?&]topic=t2(&|$)/);
});

/** Selects the first occurrence of `text` inside the lesson, as a student would with the mouse or a long press. */
async function selectInLesson(page: Page, text: string) {
  await page.evaluate((t) => {
    const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent?.indexOf(t) ?? -1;
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
    }
    throw new Error("text not found: " + t);
  }, text);
}

test("ask about several selected passages together; with a question open, the tutor guides instead of answering", async ({ page }) => {
  await asNewStudent(page, "ask");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  await page.getByRole("button", { name: "ابدأ الشرح" }).click();
  await expect(page.getByText("آخر داخل أول خارج")).toBeVisible();

  await selectInLesson(page, "آخر داخل أول خارج");
  await page.getByRole("button", { name: /أضف «آخر داخل أول خارج» لسؤالك/ }).click();
  await selectInLesson(page, "مثل كومة الأطباق");
  await page.getByRole("button", { name: /أضف «مثل كومة الأطباق» لسؤالك/ }).click();
  const chips = page.getByRole("list", { name: "المقاطع التي تسأل عنها" });
  await expect(chips.getByRole("listitem")).toHaveCount(2);
  // a chip can be taken back
  await selectInLesson(page, "آخر عنصر يدخل");
  await page.getByRole("button", { name: /أضف «آخر عنصر يدخل» لسؤالك/ }).click();
  await chips.getByRole("button", { name: /احذف «آخر عنصر يدخل»/ }).click();
  await expect(chips.getByRole("listitem")).toHaveCount(2);

  await page.getByRole("textbox", { name: "اسأل المعلم" }).fill("وش العلاقة بينهم؟");
  await page.getByRole("button", { name: "إرسال السؤال" }).click();
  const asked = page.getByRole("list", { name: "عن هذه المقاطع" });
  await expect(asked.getByRole("listitem")).toHaveText(["«آخر داخل أول خارج»", "«مثل كومة الأطباق»"]);
  await expect(page.getByText("وش العلاقة بينهم؟")).toBeVisible();
  await expect(chips).toHaveCount(0); // sent: the chips are cleared
  // the check question is still open: no answer given away
  await expect(page.getByText("ما راح أعطيك الجواب عشان تجرّبه بنفسك")).toBeVisible();
  await expect(page.getByRole("radio", { name: "1", exact: true })).toBeVisible();
});

test("new question types: put steps in order, match pairs, fill the blank — each graded with its answer shown", async ({ page }) => {
  await asNewStudent(page, "formats");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  await page.getByRole("button", { name: "أعرف هذا الموضوع — اختبرني مباشرة" }).click();

  // order: shown shuffled; moved with buttons (fingers, mouse, keyboard, screen readers alike)
  const steps = page.getByRole("list", { name: "رتّب الخطوات من الأولى إلى الأخيرة" });
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps.getByRole("listitem").first()).toContainText("pop()");
  await steps.getByRole("button", { name: "انقل «pop()» لأسفل" }).click();
  await steps.getByRole("button", { name: "انقل «pop()» لأسفل" }).click();
  await expect(steps.getByRole("listitem").nth(2)).toContainText("pop()");
  await expect(steps.getByRole("button", { name: "انقل «pop()» لأسفل" })).toBeDisabled(); // already last
  await page.getByRole("button", { name: "متأكد", exact: true }).click();
  await expect(page.getByText("push(1) ← push(2) ← pop()")).toBeVisible();
  await expect(page.getByText("إجابة صحيحة")).toBeVisible();

  // match: every item paired, each answer used once, before it can be sent
  await page.getByRole("button", { name: "السؤال التالي" }).click();
  const send = page.getByRole("button", { name: "متأكد", exact: true });
  await page.getByRole("combobox", { name: "ما يناسب «push»" }).selectOption({ label: "يسحب من القمة" });
  await expect(send).toBeDisabled();
  await page.getByRole("combobox", { name: "ما يناسب «pop»" }).selectOption({ label: "يسحب من القمة" });
  await expect(send).toBeDisabled(); // the same answer twice
  await page.getByRole("combobox", { name: "ما يناسب «pop»" }).selectOption({ label: "يضيف للقمة" });
  await send.click();
  await expect(page.getByText("إجابة غير صحيحة")).toBeVisible();
  await expect(page.getByText("التوصيل الصحيح:")).toBeVisible();

  // fill the blank
  await page.getByRole("button", { name: "السؤال التالي" }).click();
  await page.getByRole("textbox", { name: "الكلمة الناقصة" }).fill("المكدس");
  await page.getByRole("textbox", { name: "الكلمة الناقصة" }).press("Enter");
  await expect(page.getByText("إجابة صحيحة").last()).toBeVisible();
});

test("a topic's concepts each open a deep-dive page, and lead to related concepts", async ({ page }) => {
  await asNewStudent(page, "deep");
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();

  const concepts = page.getByRole("list", { name: "مفاهيم الموضوع — اضغط أي مفهوم لتتعمّق فيه" });
  await expect(concepts.getByRole("listitem")).toHaveCount(2);
  await concepts.getByRole("button", { name: /تعمّق في «مبدأ LIFO» — لم يُقَس بعد/ }).click();

  await expect(page.getByText("تعمّق في: مبدأ LIFO")).toBeVisible();
  const how = page.getByRole("region", { name: "كيف يعمل؟" });
  await expect(how).toContainText("كل push يضع عنصراً في القمة");
  await expect(how).toContainText("من ملفك");
  await expect(page.getByRole("region", { name: "من الواقع" })).toContainText("إضافة توضيحية");
  // a related concept opens its own page
  await page.getByRole("list", { name: "مفاهيم مرتبطة به" }).getByRole("button", { name: /عمليتا push و pop/ }).click();
  await expect(page.getByText("تعمّق في: عمليتا push و pop")).toBeVisible();
});

async function toTheCheckQuestion(page: Page, who: string) {
  await asNewStudent(page, who);
  await page.goto("/study/");
  await page.locator("#study-file").setInputFiles({ name: "ds.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
  await page.getByRole("button", { name: "ابدأ الدرس" }).click();
  await page.getByRole("button", { name: "ابدأ الموضوع الأول" }).click();
  await page.getByRole("button", { name: "ابدأ الشرح" }).click();
}

test("a first wrong answer goes to the mistakes notebook, and practising it closes it", async ({ page }) => {
  await toTheCheckQuestion(page, "notebook");
  await page.getByRole("radio", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "متأكد", exact: true }).click();
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "أظن", exact: true }).click();
  await expect(page.getByText("إجابة صحيحة")).toBeVisible();

  await page.getByRole("button", { name: /دفتر أخطائي — 1 مفتوحة/ }).click();
  const book = page.getByRole("dialog", { name: "دفتر أخطائي" });
  const item = book.getByRole("listitem").first();
  await expect(item).toContainText("مفتوح");
  await expect(item).toContainText("إجابتك: 2");
  await expect(item).toContainText("الصحيح: 1");
  await expect(item).toContainText("خلط المكدس بالطابور");

  await book.getByRole("button", { name: "تدرّب على أخطائك المفتوحة (1)" }).click();
  await expect(page.getByText("تدريب على أخطائك (1)")).toBeVisible();
  await page.getByRole("radio", { name: "1", exact: true }).last().click();
  await page.getByRole("button", { name: "متأكد", exact: true }).click();
  await page.getByRole("button", { name: /^دفتر أخطائي$|أخطائي دفتر أخطائي$/ }).click();
  await expect(page.getByRole("dialog", { name: "دفتر أخطائي" }).getByRole("listitem").first()).toContainText("تجاوزته");
});

test("a timed final exam shows its clock and ends by itself when the time runs out", async ({ page }) => {
  await toTheCheckQuestion(page, "timed");
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "أظن", exact: true }).click();
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  await page.getByRole("button", { name: "محاكاة اختبار حقيقي بوقت محدد" }).click();

  await expect(page.getByText("محاكاة اختبار حقيقي")).toBeVisible();
  await expect(page.getByRole("timer", { name: /الوقت المتبقي في الاختبار/ })).toBeVisible();
  // the mock's exam lasts 3 seconds: the page closes it when the clock reaches zero
  await expect(page.getByText(/انتهى وقت الاختبار/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/نتيجة الاختبار الشامل/)).toBeVisible();
  await expect(page.getByRole("timer", { name: /الوقت المتبقي في الاختبار/ })).toHaveCount(0);
});
