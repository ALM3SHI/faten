/**
 * Wakes the backend as soon as the site opens.
 *
 * Render's free plan sleeps after ~15 min idle; the first request then
 * takes up to a minute. Pinging /health early hides most of that delay,
 * and the status lets the chat explain a slow first reply.
 */

import { create } from "zustand";
import { AGENT_BASE_URL, connectBackendStatus } from "@/lib/api";

export type BackendStatus = "unknown" | "waking" | "ready" | "down";

export const useBackendStatus = create<{ status: BackendStatus }>(() => ({ status: "unknown" }));

const SLOW_AFTER_MS = 2500;
const GIVE_UP_AFTER_MS = 90_000;

let started = false;
let polling = false;

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

const set = (status: BackendStatus) => useBackendStatus.setState({ status });

export function warmupBackend(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const slow = setTimeout(() => {
    if (useBackendStatus.getState().status === "unknown") set("waking");
  }, SLOW_AFTER_MS);
  poll(slow);
}

/** A request failed to reach the server: show "waking" and poll until it answers. */
export function markBackendUnreachable(): void {
  if (typeof window === "undefined") return;
  if (useBackendStatus.getState().status !== "waking") set("waking");
  poll();
}

// API requests get the longer timeout and report failures here.
connectBackendStatus(() => useBackendStatus.getState().status === "ready", markBackendUnreachable);

function poll(slow?: ReturnType<typeof setTimeout>): void {
  if (polling) return;
  polling = true;
  void (async () => {
    const deadline = Date.now() + GIVE_UP_AFTER_MS;
    while (Date.now() < deadline) {
      if (await ping(Math.min(30_000, deadline - Date.now()))) {
        clearTimeout(slow);
        polling = false;
        set("ready");
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    clearTimeout(slow);
    polling = false;
    set("down");
  })();
}

/** Test hook. */
export function __resetWarmupForTests(): void {
  started = false;
  polling = false;
  useBackendStatus.setState({ status: "unknown" });
}
