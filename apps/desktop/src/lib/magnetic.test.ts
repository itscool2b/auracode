import { describe, expect, it } from "vitest";
import { MAGNET_REACH, magnetOffset } from "./magnetic";

const PILL = { left: 100, top: 40, width: 120, height: 32 };

describe("magnetOffset", () => {
  it("does not move a control whose centre is under the pointer", () => {
    expect(magnetOffset(PILL, 160, 56)).toEqual({ x: 0, y: 0 });
  });

  it("leans toward the pointer, the vertical lean half the horizontal", () => {
    const lean = magnetOffset(PILL, 220, 72);
    expect(lean.x).toBeCloseTo(MAGNET_REACH);
    expect(lean.y).toBeCloseTo(MAGNET_REACH / 2);
    const left = magnetOffset(PILL, 130, 40);
    expect(left.x).toBeCloseTo(-MAGNET_REACH / 2);
    expect(left.y).toBeCloseTo(-MAGNET_REACH / 2);
  });

  it("never leans past its reach, wherever the pointer is", () => {
    for (const [x, y] of [
      [-500, -500],
      [900, 900],
      [160, 4000],
    ] as const) {
      const lean = magnetOffset(PILL, x, y);
      expect(Math.abs(lean.x)).toBeLessThanOrEqual(MAGNET_REACH);
      expect(Math.abs(lean.y)).toBeLessThanOrEqual(MAGNET_REACH / 2);
    }
  });

  it("stays finite for an empty box", () => {
    const lean = magnetOffset({ left: 0, top: 0, width: 0, height: 0 }, 10, 10);
    expect(Number.isFinite(lean.x) && Number.isFinite(lean.y)).toBe(true);
  });
});
