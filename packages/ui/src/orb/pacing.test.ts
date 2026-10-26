import { describe, expect, it } from "vitest";
import {
  clampDpr,
  effectiveFps,
  frameIntervalMs,
  MAX_ORB_PIXELS,
  nextFrameTime,
  type OrbScheduleState,
  orbNeedsFrame,
  orbPixelSize,
  orbWantsLoop,
  type SchedulerEnv,
  SHARED_CANVAS_STEP,
  sharedCanvasSize,
  shouldDrawFrame,
} from "./pacing";

/** Simulates a display ticking at `hz` for `seconds`, with optional jitter; returns frames drawn. */
function countFrames(fps: number, hz: number, seconds: number, jitterMs = 0): number {
  let lastDrawAt = Number.NEGATIVE_INFINITY;
  let drawn = 0;
  const ticks = Math.round(seconds * hz);
  for (let tick = 0; tick < ticks; tick += 1) {
    const wobble = jitterMs === 0 ? 0 : (tick % 2 === 0 ? 1 : -1) * jitterMs;
    const now = (tick * 1000) / hz + wobble;
    if (shouldDrawFrame(now, lastDrawAt, fps)) {
      drawn += 1;
      lastDrawAt = nextFrameTime(lastDrawAt, now, fps);
    }
  }
  return drawn;
}

describe("frame pacing", () => {
  it("converts fps to an interval, with Infinity for never", () => {
    expect(frameIntervalMs(60)).toBeCloseTo(16.667, 3);
    expect(frameIntervalMs(0)).toBe(Number.POSITIVE_INFINITY);
    expect(frameIntervalMs(-5)).toBe(Number.POSITIVE_INFINITY);
    expect(frameIntervalMs(Number.NaN)).toBe(Number.POSITIVE_INFINITY);
  });

  it("always draws an orb that has never drawn", () => {
    expect(shouldDrawFrame(0, Number.NEGATIVE_INFINITY, 24)).toBe(true);
  });

  it("never draws at a non-positive rate", () => {
    expect(shouldDrawFrame(1000, 0, 0)).toBe(false);
    expect(shouldDrawFrame(1000, Number.NEGATIVE_INFINITY, -1)).toBe(false);
  });

  it("draws a 60 fps orb on every tick of a 60 Hz display, even with jitter", () => {
    expect(countFrames(60, 60, 10)).toBe(600);
    expect(countFrames(60, 60, 10, 0.9)).toBe(600);
  });

  it("averages 24 fps on 60 Hz and 120 Hz displays", () => {
    expect(countFrames(24, 60, 10)).toBeGreaterThanOrEqual(238);
    expect(countFrames(24, 60, 10)).toBeLessThanOrEqual(242);
    expect(countFrames(24, 120, 10)).toBeGreaterThanOrEqual(238);
    expect(countFrames(24, 120, 10)).toBeLessThanOrEqual(242);
  });

  it("halves 60 fps work on a 120 Hz display", () => {
    expect(countFrames(60, 120, 10)).toBe(600);
  });

  it("waits a full interval between frames", () => {
    expect(shouldDrawFrame(30, 0, 24)).toBe(false);
    expect(shouldDrawFrame(41, 0, 24)).toBe(true);
  });

  it("restarts after a stall instead of bursting to catch up", () => {
    const resumed = nextFrameTime(100, 5000, 24);
    expect(resumed).toBe(5000);
    expect(shouldDrawFrame(5000 + 16.7, resumed, 24)).toBe(false);
  });

  it("draws and resyncs when the clock goes backwards", () => {
    expect(shouldDrawFrame(10, 500, 24)).toBe(true);
    expect(nextFrameTime(500, 10, 24)).toBe(10);
  });

  it("raises the rate while an orb is settling", () => {
    expect(effectiveFps(24, true)).toBe(60);
    expect(effectiveFps(24, false)).toBe(24);
    expect(effectiveFps(60, true)).toBe(60);
  });
});

describe("pixel sizing", () => {
  it("clamps devicePixelRatio to 2 and repairs nonsense", () => {
    expect(clampDpr(3)).toBe(2);
    expect(clampDpr(2)).toBe(2);
    expect(clampDpr(1.5)).toBe(1.5);
    expect(clampDpr(0.75)).toBe(0.75);
    expect(clampDpr(0)).toBe(1);
    expect(clampDpr(-2)).toBe(1);
    expect(clampDpr(Number.NaN)).toBe(1);
  });

  it("sizes the shared canvas to the largest orb, rounded up to a step", () => {
    const orbs = (...sizes: number[]) => sizes.map((pixelSize) => ({ pixelSize }));
    expect(sharedCanvasSize(orbs())).toBe(0);
    expect(sharedCanvasSize(orbs(0, 0))).toBe(0);
    expect(sharedCanvasSize(orbs(56))).toBe(SHARED_CANVAS_STEP);
    expect(sharedCanvasSize(orbs(56, 200, 12))).toBe(256);
    expect(sharedCanvasSize(orbs(256))).toBe(256);
    expect(sharedCanvasSize(orbs(MAX_ORB_PIXELS))).toBe(MAX_ORB_PIXELS);
  });

  it("sizes the drawing buffer from CSS size and clamped DPR", () => {
    expect(orbPixelSize(120, 3)).toBe(240);
    expect(orbPixelSize(120, 1)).toBe(120);
    expect(orbPixelSize(0.2, 1)).toBe(1);
    expect(orbPixelSize(0, 2)).toBe(0);
    expect(orbPixelSize(-4, 2)).toBe(0);
    expect(orbPixelSize(Number.NaN, 2)).toBe(0);
    expect(orbPixelSize(100_000, 2)).toBe(MAX_ORB_PIXELS);
  });
});

describe("loop policy", () => {
  const env = (overrides: Partial<SchedulerEnv> = {}): SchedulerEnv => ({
    hidden: false,
    contextLost: false,
    reducedMotion: false,
    ...overrides,
  });
  const orb = (overrides: Partial<OrbScheduleState> = {}): OrbScheduleState => ({
    visible: true,
    dirty: false,
    lastDrawAt: 0,
    ...overrides,
  });

  it("draws a visible orb when its frame is due", () => {
    expect(orbNeedsFrame(orb(), env(), 50, 24)).toBe(true);
    expect(orbNeedsFrame(orb(), env(), 10, 24)).toBe(false);
    expect(orbWantsLoop(orb(), env())).toBe(true);
  });

  it("skips offscreen orbs entirely", () => {
    expect(orbNeedsFrame(orb({ visible: false, dirty: true }), env(), 50, 60)).toBe(false);
    expect(orbWantsLoop(orb({ visible: false, dirty: true }), env())).toBe(false);
  });

  it("stops everything while the document is hidden or the context is lost", () => {
    for (const condition of [{ hidden: true }, { contextLost: true }]) {
      expect(orbNeedsFrame(orb({ dirty: true }), env(condition), 50, 60)).toBe(false);
      expect(orbWantsLoop(orb({ dirty: true }), env(condition))).toBe(false);
    }
  });

  it("under reduced motion draws only pending static frames and never loops otherwise", () => {
    const reduced = env({ reducedMotion: true });
    expect(orbNeedsFrame(orb({ dirty: true }), reduced, 50, 60)).toBe(true);
    expect(orbWantsLoop(orb({ dirty: true }), reduced)).toBe(true);
    expect(orbNeedsFrame(orb(), reduced, 5000, 60)).toBe(false);
    expect(orbWantsLoop(orb(), reduced)).toBe(false);
  });

  it("draws a dirty orb immediately, regardless of pacing", () => {
    expect(orbNeedsFrame(orb({ dirty: true, lastDrawAt: 49 }), env(), 50, 24)).toBe(true);
  });
});
