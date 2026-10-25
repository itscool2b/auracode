/**
 * The simulated macOS window every direction renders into, in CSS px. It matches the desktop app's
 * window (apps/desktop/src-tauri/tauri.conf.json): 1440x900, overlay title bar, hidden title,
 * traffic lights at trafficLightPosition { x: 18, y: 24 }.
 */

export const WINDOW_WIDTH = 1440;
export const WINDOW_HEIGHT = 900;
export const WINDOW_RADIUS = 18;

/**
 * Height of the overlay title bar: content runs underneath it, and the desktop app treats this band
 * as the window's drag area. Keep interactive controls out of the traffic lights' corner.
 */
export const TITLEBAR_HEIGHT = 52;

/**
 * The traffic lights, as the native buttons land with trafficLightPosition { x: 18, y: 24 }: the
 * close button starts 18px from the left edge, and the row is centred in the title bar.
 */
export const TRAFFIC_LIGHTS = {
  /** Left edge of the close button. */
  left: 18,
  /** Vertical centre of the row. */
  centerY: TITLEBAR_HEIGHT / 2,
  /** Diameter of each light. */
  size: 12,
  /** Gap between lights. */
  gap: 8,
  /** Right edge of the zoom button: content to the right of this is clear of the lights. */
  right: 18 + 3 * 12 + 2 * 8,
} as const;

/** Space around the window when the viewport is large enough, so the wallpaper frames it. */
export function windowMargin(
  viewportWidth: number,
  viewportHeight: number,
  compact: boolean,
): number {
  if (compact) return 8;
  const shorter = Math.min(viewportWidth, viewportHeight);
  return Math.round(Math.min(64, Math.max(24, shorter * 0.04)));
}

/**
 * The scale that fits the window inside the viewport with its margin, never above 1: on a large
 * screen the window is its real size, on a small one it shrinks as a whole.
 */
export function windowScale(
  viewportWidth: number,
  viewportHeight: number,
  compact = false,
): number {
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return 1;
  const margin = windowMargin(viewportWidth, viewportHeight, compact);
  const fit = Math.min(
    (viewportWidth - 2 * margin) / WINDOW_WIDTH,
    (viewportHeight - 2 * margin) / WINDOW_HEIGHT,
  );
  return Math.max(0.05, Math.min(1, fit));
}

/** A box in the window's own (unscaled) coordinates. */
export interface WindowRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the viewport lies in the window's own coordinates, for a window of `scale` centred in a
 * `viewportWidth` x `viewportHeight` viewport. A copy of the wallpaper drawn in this box, inside the
 * window, lines up exactly with the wallpaper behind it: that is how the window's glass is drawn.
 */
export function viewportInWindow(
  viewportWidth: number,
  viewportHeight: number,
  scale: number,
): WindowRect {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const width = viewportWidth > 0 ? viewportWidth : WINDOW_WIDTH;
  const height = viewportHeight > 0 ? viewportHeight : WINDOW_HEIGHT;
  return {
    left: (WINDOW_WIDTH * s - width) / 2 / s,
    top: (WINDOW_HEIGHT * s - height) / 2 / s,
    width: width / s,
    height: height / s,
  };
}
