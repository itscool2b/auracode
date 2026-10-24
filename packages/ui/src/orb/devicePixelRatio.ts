/**
 * Change notifications for `window.devicePixelRatio`, which moves when the window crosses to a
 * display with a different scale factor or the page zoom changes. The DOM has no event for it.
 *
 * The main signal is a media query that matches only the current ratio: it stops matching, and so
 * fires `change`, as soon as the ratio moves, and is then armed again at the new ratio. `resize`
 * alone would miss the common case, because a window moved between displays usually keeps its size
 * in CSS px; it is still watched as a cheap backup for engines whose media queries miss a change.
 *
 * Known blind spot: Chromium's DevTools scale override (CDP setDeviceMetricsOverride with the size
 * unchanged) moves the ratio without notifying media queries or firing `resize`. Real display moves
 * and zoom go through Chromium's page zoom, which does notify; WebKit re-evaluates every media
 * query list on each rendering update.
 */

/**
 * Half-width of the band the query matches. Wider than the float noise in reported ratios (zoom
 * levels report values like 1.100000023841858), narrower than any real step: Windows custom
 * scaling moves in 1% steps, zoom and display scales in larger ones.
 */
const RATIO_TOLERANCE = 0.001;

/** The slice of a MediaQueryList the watcher uses. */
export interface RatioMediaQuery {
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

/** The slice of `window` the watcher uses, injectable so its logic runs under test. */
export interface RatioView {
  readonly devicePixelRatio: number;
  /** Absent in some embedded engines; a null result is tolerated too, defensively. */
  readonly matchMedia?: ((query: string) => RatioMediaQuery | null) | undefined;
  addEventListener(type: "resize", listener: () => void): void;
  removeEventListener(type: "resize", listener: () => void): void;
}

/**
 * A query matching ratios within RATIO_TOLERANCE of `ratio`. A band rather than an exact
 * `(resolution: Xdppx)`, so a ratio that does not survive the round trip through the query's number
 * still matches now, and therefore still fires when it moves.
 */
function ratioQuery(ratio: number): string {
  const low = Math.max(0, ratio - RATIO_TOLERANCE);
  const high = ratio + RATIO_TOLERANCE;
  return `(min-resolution: ${low}dppx) and (max-resolution: ${high}dppx)`;
}

/**
 * Calls `onChange` after each change of `view.devicePixelRatio`, once per change however many
 * signals report it. Returns the unsubscribe function.
 */
export function watchDevicePixelRatio(view: RatioView, onChange: () => void): () => void {
  let ratio = view.devicePixelRatio;
  let disarm: (() => void) | null = null;
  let stopped = false;

  function arm(): void {
    disarm?.();
    disarm = null;
    // A nonsense ratio (0, NaN) cannot go in a query; `resize` still notices when it recovers.
    if (!(Number.isFinite(ratio) && ratio > 0) || typeof view.matchMedia !== "function") return;
    const media = view.matchMedia(ratioQuery(ratio));
    if (!media || typeof media.addEventListener !== "function") return;
    media.addEventListener("change", check);
    disarm = () => media.removeEventListener("change", check);
  }

  // Both signals land here. Comparing with the last ratio collapses their duplicate reports, and
  // ignores resizes on the same display. Object.is, so a stuck NaN does not report every resize.
  function check(): void {
    if (stopped) return;
    const next = view.devicePixelRatio;
    if (Object.is(next, ratio)) return;
    ratio = next;
    // Re-armed before notifying, so a listener that throws or unsubscribes leaves a sound state.
    arm();
    onChange();
  }

  arm();
  view.addEventListener("resize", check);
  return () => {
    if (stopped) return;
    stopped = true;
    disarm?.();
    disarm = null;
    view.removeEventListener("resize", check);
  };
}
