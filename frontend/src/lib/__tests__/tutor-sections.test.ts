import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messagesOfSection, sectionOf, type TutorMessage } from "@/lib/tutor";
import { PDF_ASSET_OPTIONS } from "@/lib/pdf-assets";

const msg = (seq: number, section?: string): TutorMessage => ({ seq, role: "tutor", ts: "", blocks: [], ...(section ? { section } : {}) });

describe("one part of the lecture at a time", () => {
  it("names the part a state is in, with or without the server's key", () => {
    expect(sectionOf({ phase: "topic", currentTopicId: "t2", section: "topic:t2" })).toBe("topic:t2");
    expect(sectionOf({ phase: "topic", currentTopicId: "t2" })).toBe("topic:t2");
    expect(sectionOf({ phase: "overview", currentTopicId: null })).toBe("overview");
    expect(sectionOf({ phase: "review", currentTopicId: "t1" })).toBe("review");
    for (const phase of ["final_ready", "final", "done"] as const) expect(sectionOf({ phase, currentTopicId: null })).toBe("final");
  });

  it("shows only the messages of the part on screen", () => {
    const all = [msg(1, "overview"), msg(2, "topic:t1"), msg(3, "topic:t1"), msg(4, "topic:t2"), msg(5, "topic:t1")];
    expect(messagesOfSection(all, "topic:t1").map((m) => m.seq)).toEqual([2, 3, 5]);
    expect(messagesOfSection(all, "topic:t2").map((m) => m.seq)).toEqual([4]);
  });

  it("keeps an older session (no tags) as it was until the student moves on", () => {
    const old = [msg(1), msg(2), msg(3)];
    expect(messagesOfSection(old, "topic:t1").map((m) => m.seq)).toEqual([1, 2, 3]);
    const moved = [...old, msg(4, "topic:t2")];
    expect(messagesOfSection(moved, "topic:t2").map((m) => m.seq)).toEqual([4]);
  });
});

describe("pdf.js data files", () => {
  it("are copied by the build from the installed pdfjs-dist, and the viewer points at them", () => {
    const script = readFileSync(join(process.cwd(), "scripts/copy-pdfjs-assets.mjs"), "utf8");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts.prebuild).toContain("copy-pdfjs-assets");
    expect(pkg.scripts.predev).toContain("copy-pdfjs-assets");
    for (const url of [PDF_ASSET_OPTIONS.cMapUrl, PDF_ASSET_OPTIONS.standardFontDataUrl, PDF_ASSET_OPTIONS.wasmUrl, PDF_ASSET_OPTIONS.iccUrl]) {
      const dir = url.replace(/^\/pdfjs\//, "").replace(/\/$/, "");
      expect(script).toContain(`"${dir}"`);
      expect(existsSync(join(process.cwd(), "node_modules/pdfjs-dist", dir))).toBe(true);
    }
    expect(PDF_ASSET_OPTIONS.cMapPacked).toBe(true);
    expect(existsSync(join(process.cwd(), "node_modules/pdfjs-dist/cmaps/UniJIS-UCS2-H.bcmap"))).toBe(true);
  });
});
