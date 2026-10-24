/**
 * Pure scheduling policy for the orb renderer: frame pacing, pixel sizing, and when the animation
 * loop may stop. Kept free of DOM and GL so every rule is unit-tested in Node.
 */

/** Orbs never render above 2x: past that the extra pixels are invisible and cost real GPU time. */
export const MAX_DPR = 2;

/** Upper bound on an orb's drawing buffer side, so one huge orb cannot exhaust GPU memory. */
export const MAX_ORB_PIXELS = 1024;

/** Frame rate used while an orb is still gliding between states, whatever its settled rate. */
export const SETTLING_FPS = 60;

/**
 * Most orbs drawn in one animation frame. Measured in Chromium: each orb canvas updated in a frame
 * costs compositor work, and 18 orbs updating every frame dropped the whole page to about 50 fps
 * while 9 held 60. Over budget, due orbs wait a frame (fairly, see the renderer), so many busy
 * orbs each run a little slower and the page keeps its frame rate.
 */
export const MAX_DRAWS_PER_FRAME = 8;

/** devicePixelRatio clamped to (0, MAX_DPR]; nonsense values (0, NaN, negative) count as 1. */
export function clampDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(dpr, MAX_DPR);
}

/** Drawing buffer side in device pixels for an orb `cssSize` px wide; 0 when there is nothing to draw. */
export function orbPixelSize(cssSize: number, dpr: number): number {
  if (!Number.isFinite(cssSize) || cssSize <= 0) return 0;
  return Math.min(MAX_ORB_PIXELS, Math.max(1, Math.round(cssSize * clampDpr(dpr))));
}

/** The shared canvas grows in steps of this many pixels, so small size changes reuse its buffer. */
export const SHARED_CANVAS_STEP = 64;

/**
 * Side of the shared canvas for orbs of these pixel sizes: the largest, rounded up to a step, or 0
 * when nothing has a size. Takes the orb records directly so the frame loop allocates nothing.
 */
export function sharedCanvasSize(orbs: readonly { readonly pixelSize: number }[]): number {
  let largest = 0;
  for (let i = 0; i < orbs.length; i += 1) {
    const size = orbs[i]?.pixelSize ?? 0;
    if (size > largest) largest = size;
  }
  if (largest <= 0) return 0;
  return Math.min(MAX_ORB_PIXELS, Math.ceil(largest / SHARED_CANVAS_STEP) * SHARED_CANVAS_STEP);
}

/** Milliseconds between frames at `fps`; Infinity when the orb should never animate. */
export function frameIntervalMs(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? 1000 / fps : Number.POSITIVE_INFINITY;
}

/**
 * Tolerance for animation-frame jitter: up to 2ms early still counts as on time, so a 60 fps orb on
 * a 60 Hz display never skips a beat because one callback landed at 16.4ms instead of 16.7ms.
 */
function slackMs(intervalMs: number): number {
  return Math.min(2, intervalMs / 4);
}

/**
 * Whether an orb paced at `fps` that last drew at `lastDrawAt` should draw at `now`. Never-drawn
 * orbs (lastDrawAt = -Infinity) always draw; a clock that went backwards draws and resyncs.
 */
export function shouldDrawFrame(now: number, lastDrawAt: number, fps: number): boolean {
  const interval = frameIntervalMs(fps);
  if (interval === Number.POSITIVE_INFINITY) return false;
  if (!Number.isFinite(lastDrawAt)) return true;
  const elapsed = now - lastDrawAt;
  if (elapsed < 0) return true;
  return elapsed >= interval - slackMs(interval);
}

/**
 * The `lastDrawAt` to store after drawing at `now`. Advancing by exactly one interval, rather than
 * jumping to `now`, keeps the average rate at `fps` even when the display rate is not a multiple of
 * it (24 fps on a 60 Hz display alternates 2- and 3-vsync gaps instead of falling to 20 fps). After a
 * stall the schedule restarts at `now` instead of bursting to catch up.
 */
export function nextFrameTime(lastDrawAt: number, now: number, fps: number): number {
  const interval = frameIntervalMs(fps);
  if (interval === Number.POSITIVE_INFINITY || !Number.isFinite(lastDrawAt)) return now;
  const scheduled = lastDrawAt + interval;
  if (scheduled > now + interval || now - scheduled >= interval) return now;
  return scheduled;
}

/** Frame rate for an orb right now: its settled rate, raised to SETTLING_FPS while it glides. */
export function effectiveFps(settledFps: number, settling: boolean): number {
  return settling ? Math.max(settledFps, SETTLING_FPS) : settledFps;
}

/** The per-orb facts the loop policy needs. The renderer's orb records satisfy this directly. */
export interface OrbScheduleState {
  /** On screen (per IntersectionObserver). */
  readonly visible: boolean;
  /** Needs a frame regardless of pacing: first frame, resize, or a change under reduced motion. */
  readonly dirty: boolean;
  readonly lastDrawAt: number;
}

/** Renderer-wide conditions. The renderer itself satisfies this directly. */
export interface SchedulerEnv {
  /** document.hidden */
  readonly hidden: boolean;
  /** The WebGL context is lost and not yet restored. */
  readonly contextLost: boolean;
  /** prefers-reduced-motion: static frames only, no loop. */
  readonly reducedMotion: boolean;
}

/** Whether `orb` should draw on the animation frame at `now`, paced at `fps`. */
export function orbNeedsFrame(
  orb: OrbScheduleState,
  env: SchedulerEnv,
  now: number,
  fps: number,
): boolean {
  if (env.hidden || env.contextLost || !orb.visible) return false;
  if (orb.dirty) return true;
  if (env.reducedMotion) return false;
  return shouldDrawFrame(now, orb.lastDrawAt, fps);
}

/**
 * Whether `orb` needs future animation frames at all. Offscreen orbs, hidden documents, and lost
 * contexts need none; under reduced motion only a pending static frame does. When no orb needs a
 * frame, the loop stops entirely.
 */
export function orbWantsLoop(orb: OrbScheduleState, env: SchedulerEnv): boolean {
  if (env.hidden || env.contextLost || !orb.visible) return false;
  return orb.dirty || !env.reducedMotion;
}
