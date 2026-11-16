import { describe, expect, it } from "vitest";
import { COMMANDS, normalize, roomCommands, searchCommands } from "@/lib/commands";
import { ACCOUNT_LINKS, SECTIONS } from "@/lib/nav";

describe("command palette", () => {
  it("can reach every page of the app", () => {
    const hrefs = new Set(COMMANDS.map((c) => c.href));
    for (const section of SECTIONS) {
      for (const page of section.pages) {
        if (page.href !== "/plan") expect(hrefs, page.href).toContain(page.href);
      }
    }
    for (const link of ACCOUNT_LINKS) expect(hrefs, link.href).toContain(link.href);
  });

  it("lists pages and actions before anything is typed, without the admin page", () => {
    const shown = searchCommands("");
    expect(shown.some((c) => c.href === "/dashboard")).toBe(true);
    expect(shown.some((c) => c.group === "actions")).toBe(true);
    expect(shown.some((c) => c.href === "/admin")).toBe(false);
    expect(searchCommands("", { admin: true }).some((c) => c.href === "/admin")).toBe(true);
  });

  it("finds a page by its name, by a keyword, and in English", () => {
    expect(searchCommands("الغياب")[0].href).toBe("/attendance");
    expect(searchCommands("حرمان")[0].href).toBe("/attendance");
    expect(searchCommands("gpa").map((c) => c.href)).toContain("/gpa");
    expect(searchCommands("خريطة")[0].href).toBe("/locations");
  });

  it("forgives hamza, ta marbuta, alef maqsura and diacritics", () => {
    expect(normalize("الإختبَارات")).toBe(normalize("الاختبارات"));
    expect(searchCommands("الاختبارات")[0].href).toBe("/exams");
    expect(searchCommands("الإختبارات")[0].href).toBe("/exams");
    expect(searchCommands("خريطه")[0].href).toBe("/locations");
  });

  it("needs every typed word to match", () => {
    expect(searchCommands("جلسة تركيز").some((c) => c.href === "/pomodoro")).toBe(true);
    expect(searchCommands("جلسة بطيخ").filter((c) => c.group !== "ask")).toEqual([]);
  });

  it("finds rooms once the map has loaded and links to them on the map", () => {
    const rooms = roomCommands([{ id: "Room_Library", label: "المكتبة" }, { id: "Room_12", label: "قاعة 12" }]);
    const found = searchCommands("مكتبة", { rooms });
    expect(found.find((c) => c.group === "rooms")?.href).toBe("/locations?target=Room_Library");
    expect(searchCommands("مكتبة").some((c) => c.group === "rooms")).toBe(false);
  });

  it("always offers to ask Faten about what was typed", () => {
    const last = searchCommands("متى الانسحاب؟").at(-1)!;
    expect(last.group).toBe("ask");
    expect(last.href).toBe(`/chat?query=${encodeURIComponent("متى الانسحاب؟")}`);
  });
});
