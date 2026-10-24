import { describe, expect, it } from "vitest";
import { AGENT_BRANDS } from "../brand";
import {
  glide,
  ORB_STATE_LABELS,
  ORB_STATES,
  type OrbState,
  orbStateTarget,
  PALETTE_FLOATS,
  PULSE_HZ,
  pulseOffset,
  writeBrandPalette,
  writeTargetPalette,
} from "./states";

const ACTIVE: readonly OrbState[] = ["thinking", "streaming", "tool"];

function targetPalette(state: OrbState): Float32Array {
  const brand = writeBrandPalette(new Float32Array(PALETTE_FLOATS), AGENT_BRANDS.antigravity);
  return writeTargetPalette(new Float32Array(PALETTE_FLOATS), brand, state);
}

/** RGB of the palette's third stop, the dominant body colour. */
function bodyColor(palette: Float32Array): [number, number, number] {
  return [palette[6] ?? 0, palette[7] ?? 0, palette[8] ?? 0];
}

describe("orb states", () => {
  it("lists all seven states exactly once", () => {
    expect([...ORB_STATES].sort()).toEqual(
      ["done", "error", "idle", "streaming", "thinking", "tool", "waiting"].sort(),
    );
  });

  it("defines a sane target and a label for every state", () => {
    for (const state of ORB_STATES) {
      const target = orbStateTarget(state);
      expect(target.energy, state).toBeGreaterThanOrEqual(0);
      expect(target.energy, state).toBeLessThanOrEqual(1);
      expect(target.speed, state).toBeGreaterThan(0);
      expect(target.turbulence, state).toBeGreaterThan(0);
      expect(target.fps, state).toBeGreaterThan(0);
      expect(target.glideMs, state).toBeGreaterThan(0);
      expect(target.tintAmount, state).toBeGreaterThanOrEqual(0);
      expect(target.tintAmount, state).toBeLessThanOrEqual(1);
      expect(ORB_STATE_LABELS[state].length, state).toBeGreaterThan(0);
    }
  });

  it("runs idle slow (about 24 fps) and active states at 60 fps", () => {
    expect(orbStateTarget("idle").fps).toBe(24);
    for (const state of ACTIVE) expect(orbStateTarget(state).fps).toBe(60);
  });

  it("puts more energy into active states than resting ones", () => {
    const resting = Math.max(orbStateTarget("idle").energy, orbStateTarget("done").energy);
    for (const state of ACTIVE) expect(orbStateTarget(state).energy).toBeGreaterThan(resting);
  });

  it("lets done settle: calmest energy, slowest glide", () => {
    const done = orbStateTarget("done");
    for (const state of ORB_STATES) {
      if (state === "done") continue;
      expect(done.energy).toBeLessThanOrEqual(orbStateTarget(state).energy);
      expect(done.glideMs).toBeGreaterThan(orbStateTarget(state).glideMs);
    }
  });

  it("makes only waiting breathe, so it reads as waiting even on amber brands", () => {
    for (const state of ORB_STATES) {
      const pulse = orbStateTarget(state).pulse;
      if (state === "waiting") expect(pulse).toBeGreaterThan(0.1);
      else expect(pulse, state).toBe(0);
    }
  });

  it("treats unknown states as idle", () => {
    expect(orbStateTarget("bogus" as OrbState)).toBe(orbStateTarget("idle"));
    expect(orbStateTarget("constructor" as OrbState)).toBe(orbStateTarget("idle"));
  });
});

describe("state tints", () => {
  it("leaves untinted states on the brand palette", () => {
    const brand = writeBrandPalette(new Float32Array(PALETTE_FLOATS), AGENT_BRANDS.antigravity);
    for (const state of ["idle", "thinking", "streaming", "tool", "done"] as const) {
      expect(Array.from(targetPalette(state))).toEqual(Array.from(brand));
    }
  });

  it("leans waiting toward amber, even on a blue-violet brand", () => {
    const [r, g, b] = bodyColor(targetPalette("waiting"));
    const [r0, , b0] = bodyColor(targetPalette("idle"));
    expect(r).toBeGreaterThan(r0);
    expect(b).toBeLessThan(b0);
    // Amber: red over green over blue.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("leans error toward red", () => {
    const [r, g, b] = bodyColor(targetPalette("error"));
    expect(r).toBeGreaterThan(g * 1.5);
    expect(r).toBeGreaterThan(b);
  });
});

describe("pulseOffset", () => {
  it("swings within its amplitude once every 1 / PULSE_HZ seconds", () => {
    const period = 1000 / PULSE_HZ;
    expect(pulseOffset(0.2, 0)).toBe(0);
    expect(pulseOffset(0.2, period / 4)).toBeCloseTo(0.2, 10);
    expect(pulseOffset(0.2, (3 * period) / 4)).toBeCloseTo(-0.2, 10);
    expect(pulseOffset(0.2, period)).toBeCloseTo(0, 10);
    for (let t = 0; t < 5000; t += 37)
      expect(Math.abs(pulseOffset(0.2, t))).toBeLessThanOrEqual(0.2);
  });

  it("is zero for no amplitude and survives nonsense input", () => {
    expect(pulseOffset(0, 500)).toBe(0);
    expect(pulseOffset(-1, 500)).toBe(0);
    expect(pulseOffset(Number.NaN, 500)).toBe(0);
    expect(pulseOffset(0.2, Number.NaN)).toBe(0);
  });
});

describe("glide", () => {
  it("covers 63% of the way in one time constant and nearly all of it in five", () => {
    expect(glide(0, 1, 200, 200)).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(glide(0, 1, 1000, 200)).toBeGreaterThan(0.99);
  });

  it("never overshoots and moves monotonically", () => {
    let value = 0;
    let previous = -1;
    for (let i = 0; i < 200; i += 1) {
      value = glide(value, 1, 16.7, 120);
      expect(value).toBeGreaterThan(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it("is frame-rate independent: two half steps equal one full step", () => {
    const whole = glide(0.2, 0.9, 33, 250);
    const halves = glide(glide(0.2, 0.9, 16.5, 250), 0.9, 16.5, 250);
    expect(halves).toBeCloseTo(whole, 12);
  });

  it("handles degenerate inputs without NaN", () => {
    expect(glide(0.3, 1, 0, 200)).toBe(0.3);
    expect(glide(0.3, 1, -5, 200)).toBe(0.3);
    expect(glide(0.3, 1, Number.NaN, 200)).toBe(0.3);
    expect(glide(0.3, 1, 16, 0)).toBe(1);
    expect(glide(Number.NaN, 1, 16, 200)).toBe(1);
    expect(glide(0.3, 1, Number.POSITIVE_INFINITY, 200)).toBe(1);
  });
});
