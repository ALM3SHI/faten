import { describe, expect, it } from "vitest";
import { parseSse, toolStatusLabel } from "@/lib/sse";

describe("parseSse", () => {
  it("parses complete events and keeps the partial tail", () => {
    const buf = 'data: {"type":"status","tool":"search_regulations"}\n\ndata: {"type":"token","text":"مرح"}\n\ndata: {"type":"tok';
    const { events, rest } = parseSse(buf);
    expect(events).toEqual([
      { type: "status", tool: "search_regulations" },
      { type: "token", text: "مرح" },
    ]);
    expect(rest).toBe('data: {"type":"tok');
  });

  it("joins chunks split anywhere, including inside multi-byte text", () => {
    const full = 'data: {"type":"token","text":"بكرة عندك"}\n\ndata: {"type":"done","response":{"message":"ok"}}\n\n';
    let buffer = "";
    const out: unknown[] = [];
    for (let i = 0; i < full.length; i += 7) {
      buffer += full.slice(i, i + 7);
      const { events, rest } = parseSse(buffer);
      out.push(...events);
      buffer = rest;
    }
    expect(out).toEqual([
      { type: "token", text: "بكرة عندك" },
      { type: "done", response: { message: "ok" } },
    ]);
  });

  it("handles CRLF and ignores malformed data", () => {
    const { events } = parseSse('data: {"type":"token","text":"a"}\r\n\r\ndata: not-json\n\n');
    expect(events).toEqual([{ type: "token", text: "a" }]);
  });
});

describe("toolStatusLabel", () => {
  it("has Arabic labels and a safe default", () => {
    expect(toolStatusLabel("search_regulations")).toBe("أبحث في اللوائح…");
    expect(toolStatusLabel("unknown_tool")).toBe("أعمل على طلبك…");
  });
});
