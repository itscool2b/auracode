/**
 * Small, dependency-free motion helpers for the website. Every moving thing here pauses while it is
 * offscreen or the tab is hidden, and stops for prefers-reduced-motion. Measured timings live in
 * docs/design/visual-language.md and the shared motion tokens.
 */
import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCED);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** The OS reduced-motion preference. False on the server, which renders the full-motion markup. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** Whether the tab is visible. True on the server. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

/** Whether an element intersects the viewport (with a margin), updated live. */
export function useInView(
  ref: RefObject<Element | null>,
  { rootMargin = "0px", threshold = 0 }: { rootMargin?: string; threshold?: number } = {},
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setInView(entry.isIntersecting);
      },
      { rootMargin, threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin, threshold]);
  return inView;
}
