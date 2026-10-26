import { useSyncExternalStore } from "react";

/**
 * Motion vocabulary: spring presets, durations, and easing curves as plain data, so the same values
 * drive Motion (`transition={springs.smooth}`), the Web Animations API, and CSS (tokens.css carries
 * the CSS twins). Plus the reduced-motion preference, readable inside and outside React.
 */

/** A damped spring in the shape Motion's `transition` prop accepts. */
export interface SpringPreset {
  readonly type: "spring";
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/**
 * Damping ratios and settle times (to within 0.2%):
 * - snappy: 0.83, about 355ms, one percent overshoot. Toggles, pills, pressed states.
 * - smooth: 0.96, about 460ms, no visible overshoot. Panels, sheets, layout shifts.
 * - gentle: 0.87, about 720ms. Large surfaces and ambient moves.
 */
export const springs = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 1 },
  smooth: { type: "spring", stiffness: 260, damping: 31, mass: 1 },
  gentle: { type: "spring", stiffness: 120, damping: 19, mass: 1 },
} as const satisfies Record<string, SpringPreset>;

/** Durations in ms, mirroring `--aura-duration-*` in tokens.css. */
export const durations = {
  instant: 90,
  fast: 150,
  base: 240,
  slow: 380,
  slower: 620,
  ambient: 1400,
  fade: 200,
} as const;

/** Cubic-bezier control points (x1, y1, x2, y2), Motion's `ease` format. */
export type CubicBezier = [number, number, number, number];

/*
 * Mutable tuple types because animation libraries type easing as a mutable tuple and a readonly one
 * would not be assignable; the arrays are frozen so a stray write throws instead of retiming the app.
 */
const bezier = (x1: number, y1: number, x2: number, y2: number): CubicBezier =>
  Object.freeze([x1, y1, x2, y2]) as CubicBezier;

/** Easing curves, mirroring `--aura-ease-*` in tokens.css. */
export const easings = {
  standard: bezier(0.2, 0, 0, 1),
  emphasized: bezier(0.05, 0.7, 0.1, 1),
  out: bezier(0.16, 1, 0.3, 1),
  in: bezier(0.4, 0, 1, 1),
  inOut: bezier(0.65, 0, 0.35, 1),
} as const;

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let reducedMotionList: MediaQueryList | null | undefined;
let appMotion: "full" | "reduced" | "off" = "full";
const appListeners = new Set<() => void>();

/** Apply the persisted application preference. Full never overrides the OS accessibility setting. */
export function setMotionPreference(value: "full" | "reduced" | "off"): void {
  if (appMotion === value) return;
  appMotion = value;
  if (typeof document !== "undefined") document.documentElement.dataset.motion = value;
  for (const listener of appListeners) listener();
}

/** The shared MediaQueryList, created once; null where there is no `matchMedia` (SSR, tests). */
function reducedMotionMedia(): MediaQueryList | null {
  if (reducedMotionList !== undefined) return reducedMotionList;
  reducedMotionList =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_MOTION_QUERY)
      : null;
  return reducedMotionList;
}

/** Whether the user asked for reduced motion. False where it cannot be known (SSR). */
export function prefersReducedMotion(): boolean {
  return appMotion !== "full" || (reducedMotionMedia()?.matches ?? false);
}

/** Calls `onChange` whenever the preference flips; returns the unsubscribe function. */
export function subscribeReducedMotion(onChange: () => void): () => void {
  const media = reducedMotionMedia();
  appListeners.add(onChange);
  media?.addEventListener("change", onChange);
  return () => {
    appListeners.delete(onChange);
    media?.removeEventListener("change", onChange);
  };
}

/*
 * The server cannot know the preference, so it renders the full-motion markup; React then swaps in
 * the client value after hydration without a mismatch error.
 */
const serverReducedMotion = (): boolean => false;

/** The reduced-motion preference as React state, updated live. SSR-safe. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, serverReducedMotion);
}
