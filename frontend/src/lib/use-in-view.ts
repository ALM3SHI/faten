"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True once the element has come within `rootMargin` of the viewport (then
 * stays true). Used to defer heavy widgets that sit below the fold.
 */
export function useInViewOnce<T extends Element>(rootMargin = "200px"): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // No observer support: show the widget right away.
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen];
}
