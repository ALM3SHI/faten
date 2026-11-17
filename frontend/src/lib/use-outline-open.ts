import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the course menu is shown beside the lesson (wide screens).
 * Remembered per device; open by default.
 */
const KEY = "faten_outline_closed";
const EVENT = "faten-outline";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "1";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useOutlineOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, read, () => true);
  const set = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, "1");
    } catch {
      /* storage blocked: not remembered */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [open, set];
}
