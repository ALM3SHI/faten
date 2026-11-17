import { useCallback, useSyncExternalStore } from "react";

/**
 * «وضع السبورة» in the tutor: a per-device preference (localStorage), so a
 * student who likes the lesson on a chalkboard keeps it on next time.
 * Off on the server and during hydration, then the saved value.
 */
const KEY = "faten_board_mode";
const EVENT = "faten-board-mode";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
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

export function useBoardMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.setItem(KEY, "1");
      else window.localStorage.removeItem(KEY);
    } catch {
      /* storage blocked: the mode just isn't remembered */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, set];
}
