import { describe, expect, it } from "vitest";
import { FpsMeter, FrameLog } from "./fps";

function run(meter: FpsMeter, from: number, frameMs: number, frames: number): number {
  let now = from;
  for (let i = 0; i < frames; i += 1) {
    meter.tick(now);
    now += frameMs;
  }
  return now - frameMs;
}

describe("FpsMeter", () => {
  it("reads a steady 60 Hz as 60", () => {
    const meter = new FpsMeter();
    run(meter, 1000, 1000 / 60, 121);
    const summary = meter.summary();
    expect(summary.frames).toBe(120);
    expect(summary.seconds).toBeCloseTo(2, 5);
    expect(summary.avg).toBeCloseTo(60, 5);
    expect(summary.min).toBeCloseTo(60, 0);
    expect(summary.current).toBeCloseTo(60, 0);
  });

  it("shows a stall as a dip in the minimum, not in the average alone", () => {
    const meter = new FpsMeter(500);
    const last = run(meter, 0, 1000 / 60, 61);
    // One 400 ms hitch, then smooth again.
    run(meter, last + 400, 1000 / 60, 61);
    const summary = meter.summary();
    expect(summary.min).toBeLessThan(40);
    expect(summary.avg).toBeGreaterThan(45);
  });

  it("is zero before two frames and ignores repeated timestamps", () => {
    const meter = new FpsMeter();
    expect(meter.summary()).toEqual({ frames: 0, seconds: 0, avg: 0, min: 0, current: 0 });
    meter.tick(10);
    meter.tick(10);
    meter.tick(5);
    meter.tick(Number.NaN);
    expect(meter.summary().frames).toBe(0);
  });

  it("starts over after reset", () => {
    const meter = new FpsMeter();
    run(meter, 0, 1000 / 30, 31);
    meter.reset();
    run(meter, 5000, 1000 / 120, 121);
    expect(meter.summary().avg).toBeCloseTo(120, 5);
  });
});

describe("FrameLog", () => {
  it("records the frames counted since the previous sample", () => {
    const log = new FrameLog();
    log.record(1000, 60, false);
    log.record(2000, 118, false);
    log.record(3000, 118, true);
    expect(log.samples).toEqual([
      { t: 1000, frames: 60, hidden: false },
      { t: 2000, frames: 58, hidden: false },
      { t: 3000, frames: 0, hidden: true },
    ]);
  });

  it("treats a lower total as a reset meter", () => {
    const log = new FrameLog();
    log.record(1000, 600, false);
    log.record(2000, 45, false);
    log.record(3000, 105, false);
    expect(log.samples.map((sample) => sample.frames)).toEqual([600, 45, 60]);
  });

  it("keeps only the newest samples", () => {
    const log = new FrameLog(3);
    for (let second = 1; second <= 5; second += 1) log.record(second * 1000, second * 60, false);
    expect(log.samples.map((sample) => sample.t)).toEqual([3000, 4000, 5000]);
    expect(log.samples.every((sample) => sample.frames === 60)).toBe(true);
  });

  it("ignores nonsense input", () => {
    const log = new FrameLog();
    log.record(Number.NaN, 10, false);
    log.record(1000, Number.POSITIVE_INFINITY, false);
    log.record(1000, -1, false);
    expect(log.samples).toEqual([]);
    log.record(2000, 30, false);
    expect(log.samples).toEqual([{ t: 2000, frames: 30, hidden: false }]);
  });

  it("falls back to 300 samples for a nonsense capacity", () => {
    for (const capacity of [Number.NaN, 0, 0.5, -3]) {
      const log = new FrameLog(capacity);
      for (let second = 1; second <= 301; second += 1) log.record(second * 1000, second, false);
      expect(log.samples).toHaveLength(300);
    }
  });
});
