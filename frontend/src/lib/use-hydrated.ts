import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false during the static/SSR render and the first client render that
 * hydrates it, true afterwards. Use instead of `useState + useEffect(() =>
 * setMounted(true))` to gate content that depends on browser-only state
 * (localStorage-persisted stores, the current date, …).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
