import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

import { ApiError, NETWORK_ERROR_MESSAGE, api, errorMessageFromBody } from "@/lib/api";
import { classifyError } from "@/components/dashboard/analytics";

afterEach(() => vi.unstubAllGlobals());

describe("errorMessageFromBody", () => {
  it("uses the server's Arabic detail", () => {
    expect(errorMessageFromBody({ detail: "الملف ليس PDF." }, 400)).toBe("الملف ليس PDF.");
    expect(errorMessageFromBody({ detail: { message: "الخدمة متوقفة." } }, 410)).toBe("الخدمة متوقفة.");
  });
  it("falls back to an Arabic sentence with the status code", () => {
    expect(errorMessageFromBody({}, 503)).toContain("503");
    expect(errorMessageFromBody(null, 500)).toMatch(/[؀-ۿ]/);
  });
});

describe("api helper", () => {
  it("throws ApiError with status and detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "سجّل دخولك أولاً." }), { status: 401 })));
    const err = await api.get("/api/workspace").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("سجّل دخولك أولاً.");
  });
  it("turns network failures into status 0 with an Arabic message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await api.get("/api/workspace").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe(NETWORK_ERROR_MESSAGE);
  });
});

describe("dashboard classifyError", () => {
  it("routes by status code", () => {
    expect(classifyError(new ApiError("البيانات المرسلة غير صحيحة", 422)).kind).toBe("migration");
    expect(classifyError(new ApiError(NETWORK_ERROR_MESSAGE, 0)).kind).toBe("network");
    expect(classifyError(new ApiError("خطأ", 500)).kind).toBe("server");
  });
});
