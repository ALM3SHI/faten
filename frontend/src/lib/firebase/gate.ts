/**
 * Sync gating, kept apart from sync.ts so that code which only pauses or
 * resumes Firestore pushes (workspace hydration, agent results) does not
 * pull the Firestore SDK into its bundle.
 */

let syncEnabled = false;

/** Gate outbound Firestore pushes during hydration (API or direct pull). */
export function setStoreSyncEnabled(enabled: boolean): void {
  syncEnabled = enabled;
}

export function isStoreSyncEnabled(): boolean {
  return syncEnabled;
}

// Per-key debouncer so bursts of state changes (e.g. typing in the
// preferences hub) coalesce into a single write.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedPush(key: string, fn: () => void, delayMs = 600) {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(key);
    fn();
  }, delayMs);
  timers.set(key, t);
}

/** Cancel all pending debounced Firestore pushes. Safe to call at
 *  any time — a no-op when no timers are pending. */
export function clearPendingPushTimers(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

/** Cancel one pending push (e.g. the echo of a snapshot just applied locally). */
export function cancelPush(key: string): void {
  const pending = timers.get(key);
  if (pending) clearTimeout(pending);
  timers.delete(key);
}
