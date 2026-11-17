import { useState } from "react";

/**
 * True from the first render where `value` is true, forever after. Used to
 * mount a lazily loaded dialog only once it has been opened, then keep it
 * mounted so its closing animation still plays.
 */
export function useLatch(value: boolean): boolean {
  const [latched, setLatched] = useState(value);
  if (value && !latched) setLatched(true);
  return latched || value;
}
