/**
 * Small, dependency-free motion helpers for the website. Every moving thing here pauses while it is
 * offscreen or the tab is hidden, and stops for prefers-reduced-motion. Measured timings live in
 * docs/design/visual-language.md (3.8) and the Graphite tokens.
 */
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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

/** Whether a media query matches, live. `fallback` on the server and during hydration. */
export function useMedia(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => fallback,
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

/**
 * A value derived from an element's position as the page scrolls, recomputed at most once a frame
 * and quantised to `step` so React renders only when it changes.
 */
export function useScrollValue(
  ref: RefObject<Element | null>,
  compute: (rect: DOMRect, viewport: number) => number,
  { step = 0.005, initial = 0 }: { step?: number; initial?: number } = {},
): number {
  const [value, setValue] = useState(initial);
  const mapping = useRef(compute);
  mapping.current = compute;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const raw = mapping.current(node.getBoundingClientRect(), window.innerHeight);
      const next = Math.round(Math.min(1, Math.max(0, raw)) / step) * step;
      setValue((previous) => (Math.abs(previous - next) < step / 2 ? previous : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, step]);
  return value;
}

/** A cubic-bezier easing as a function of time in [0, 1], for JavaScript-driven tweens. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const sample = (a: number, b: number, t: number) =>
    3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (sample(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return sample(y1, y2, (lo + hi) / 2);
  };
}
