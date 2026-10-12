/**
 * Wakes the backend as soon as the site opens.
 *
 * Render's free plan sleeps after ~15 min idle; the first request then
 * takes up to a minute. Pinging /health early hides most of that delay,
 * and the status lets the chat explain a slow first reply.
 */

import { create } from "zustand";
import { AGENT_BASE_URL } from "@/lib/api";

export type BackendStatus = "unknown" | "waking" | "ready" | "down";

export const useBackendStatus = create<{ status: BackendStatus }>(() => ({ status: "unknown" }));

const SLOW_AFTER_MS = 2500;
const GIVE_UP_AFTER_MS = 90_000;

let started = false;

async function ping(timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${AGENT_BASE_URL}/health`, { signal: ctrl.signal, cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function warmupBackend(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const set = (status: BackendStatus) => useBackendStatus.setState({ status });
  const slow = setTimeout(() => {
    if (useBackendStatus.getState().status === "unknown") set("waking");
  }, SLOW_AFTER_MS);

  void (async () => {
    const deadline = Date.now() + GIVE_UP_AFTER_MS;
    while (Date.now() < deadline) {
      if (await ping(Math.min(30_000, deadline - Date.now()))) {
        clearTimeout(slow);
        set("ready");
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    clearTimeout(slow);
    set("down");
  })();
}

/** Test hook. */
export function __resetWarmupForTests(): void {
  started = false;
  useBackendStatus.setState({ status: "unknown" });
}
