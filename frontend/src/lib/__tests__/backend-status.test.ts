import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ AGENT_BASE_URL: "http://api.test" }));

import { __resetWarmupForTests, useBackendStatus, warmupBackend } from "@/lib/backend-status";

const g = globalThis as unknown as { window?: unknown; fetch: typeof fetch };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  __resetWarmupForTests();
  delete g.window;
});

describe("warmupBackend", () => {
  it("goes ready immediately when the server is awake", async () => {
    g.window = {};
    g.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;
    warmupBackend();
    await vi.waitFor(() => expect(useBackendStatus.getState().status).toBe("ready"));
  });

  it("reports 'waking' while a sleeping server boots, then 'ready'", async () => {
    vi.useFakeTimers();
    g.window = {};
    let calls = 0;
    g.fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("cold");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    warmupBackend();
    await vi.advanceTimersByTimeAsync(2600);
    expect(useBackendStatus.getState().status).toBe("waking");
    await vi.advanceTimersByTimeAsync(7000);
    expect(useBackendStatus.getState().status).toBe("ready");
    expect(calls).toBe(3);
  });

  it("only starts once", async () => {
    g.window = {};
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    g.fetch = f as typeof fetch;
    warmupBackend();
    warmupBackend();
    await vi.waitFor(() => expect(useBackendStatus.getState().status).toBe("ready"));
    expect(f).toHaveBeenCalledTimes(1);
  });
});
