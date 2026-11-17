import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn with design-system tokens", () => {
  it("keeps a colour next to a design-system font size", () => {
    expect(cn("text-on-brand", "text-body")).toBe("text-on-brand text-body");
    expect(cn("text-ink-muted text-caption")).toBe("text-ink-muted text-caption");
  });

  it("lets a later size, radius or shadow replace an earlier one", () => {
    expect(cn("text-body", "text-small")).toBe("text-small");
    expect(cn("text-sm", "text-body")).toBe("text-body");
    expect(cn("rounded-card", "rounded-control")).toBe("rounded-control");
    expect(cn("rounded-xl", "rounded-card")).toBe("rounded-card");
    expect(cn("shadow-card", "shadow-dialog")).toBe("shadow-dialog");
  });

  it("still merges ordinary Tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-ink")).toBe("text-ink");
  });
});
