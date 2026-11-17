import { useEffect, useRef } from "react";

/**
 * Plays the `.animate-bump` hop on the element when `value` goes up while it
 * is on screen (a session completed, the streak grew). Not while the page is
 * still loading its saved values (the first two seconds), and not with
 * reduced motion (globals.css).
 */
export function useBumpOnIncrease<T extends Element>(value: number) {
  const ref = useRef<T>(null);
  const prev = useRef<number | null>(null);
  const since = useRef(0);
  useEffect(() => {
    since.current = performance.now();
  }, []);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    const el = ref.current;
    const loading = performance.now() - since.current < 2000;
    if (!el || before === null || value <= before || loading) return;
    el.classList.remove("animate-bump");
    el.getBoundingClientRect(); // reflow, so the animation restarts
    el.classList.add("animate-bump");
  }, [value]);
  return ref;
}
