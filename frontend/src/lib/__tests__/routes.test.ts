import { describe, expect, it } from "vitest";
import { isActivePath, isProtectedPath, normalizePath, safeNextPath } from "@/lib/routes";

describe("normalizePath", () => {
  it("strips trailing slashes produced by trailingSlash export", () => {
    expect(normalizePath("/chat/")).toBe("/chat");
    expect(normalizePath("/chat///")).toBe("/chat");
  });
  it("keeps the root and handles empty input", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath(null)).toBe("/");
    expect(normalizePath(undefined)).toBe("/");
  });
});

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/chat/", "/gpa", "/plan", "/profile", "/schedule", "/transcript", "/community/", "/attendance/"])(
    "%s needs a signed-in user",
    (p) => expect(isProtectedPath(p)).toBe(true),
  );
  it.each(["/", "/login", "/locations", "/chatroom", "/gpa-info"])("%s is public", (p) =>
    expect(isProtectedPath(p)).toBe(false),
  );
});

describe("isActivePath", () => {
  it("matches with and without trailing slash", () => {
    expect(isActivePath("/chat/", "/chat")).toBe(true);
    expect(isActivePath("/chat", "/chat/")).toBe(true);
  });
  it("matches nested pages but not prefixes of other words", () => {
    expect(isActivePath("/plan/edit/", "/plan")).toBe(true);
    expect(isActivePath("/planner", "/plan")).toBe(false);
  });
  it("root is only active on the root", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/chat", "/")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("accepts same-site paths", () => {
    expect(safeNextPath("/gpa")).toBe("/gpa");
  });
  it("rejects open redirects", () => {
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeNextPath(null, "/chat")).toBe("/chat");
  });
});
