import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

import { ApiError, TIMEOUT_MESSAGE, api, connectBackendStatus } from "@/lib/api";

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

let unreachable = 0;
beforeEach(() => {
  vi.useFakeTimers();
  unreachable = 0;
  connectBackendStatus(() => true, () => unreachable++);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("api retries", () => {
  it("retries a GET after a network failure and reports the server as unreachable", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetch);
    const pending = api.get("/api/workspace");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(unreachable).toBe(1);
  });

  it("retries a GET on 503 while the server restarts", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetch);
    const pending = api.get("/api/workspace");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("never retries a POST (it may have been applied)", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    const pending = api.post("/api/chat", { q: "x" }).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await pending).toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry client errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "x" }), { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const pending = api.get("/api/missing").catch((e) => e);
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(unreachable).toBe(0);
  });
});

describe("api timeout", () => {
  it("gives up on a hung POST with an Arabic timeout message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })),
    );
    const pending = api.post("/api/chat", {}).catch((e) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(408);
    expect(err.message).toBe(TIMEOUT_MESSAGE);
  });

  it("passes the caller's own abort through untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        if (init.signal?.aborted) abort();
        init.signal?.addEventListener("abort", abort);
      })),
    );
    const ctrl = new AbortController();
    const pending = api.get("/api/workspace", { signal: ctrl.signal }).catch((e) => e);
    ctrl.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe("AbortError");
  });
});
