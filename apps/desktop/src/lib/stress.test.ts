import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRESS,
  formatStressConfig,
  MAX_STRESS_TOKENS,
  parseStressConfig,
  stressTurnTokens,
} from "./stress";

// Same cases as the Rust parser's tests in src-tauri/src/launch.rs: the two must agree.

function config(orbs: number, rate: number, aura: boolean, seconds: number) {
  return { ok: true, config: { orbs, rate, aura, seconds } };
}

describe("parseStressConfig", () => {
  it("parses the documented example", () => {
    expect(parseStressConfig("orbs=24,rate=200,aura=1,seconds=0")).toEqual(
      config(24, 200, true, 0),
    );
  });

  it("fills missing keys with defaults, in any order", () => {
    expect(parseStressConfig("seconds=30, orbs=3")).toEqual(config(3, 200, true, 30));
    expect(parseStressConfig("aura=0")).toEqual(config(6, 200, false, 0));
  });

  it("reads a bare flag as all defaults", () => {
    for (const flag of ["1", "true", "YES", " on "]) {
      expect(parseStressConfig(flag)).toEqual({ ok: true, config: DEFAULT_STRESS });
    }
  });

  it("tolerates whitespace, case and empty entries", () => {
    expect(parseStressConfig(" ORBS = 2 ,, Rate=10 , aura = off ,")).toEqual(
      config(2, 10, false, 0),
    );
  });

  it("includes both ends of every range", () => {
    expect(parseStressConfig("orbs=1,rate=1,seconds=86400")).toEqual(config(1, 1, true, 86_400));
    expect(parseStressConfig("orbs=24,rate=5000")).toEqual(config(24, 5000, true, 0));
  });

  it("rejects out-of-range and malformed numbers", () => {
    for (const input of [
      "orbs=0",
      "orbs=25",
      "rate=0",
      "rate=5001",
      "seconds=86401",
      "orbs=-1",
      "orbs=+5",
      "orbs=2.5",
      "orbs=",
      "rate=99999999999",
      "orbs=1e3",
    ]) {
      const result = parseStressConfig(input);
      expect(result.ok, input).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/must be a whole number from \d+ to \d+/);
    }
  });

  it("rejects unknown, repeated and unpaired settings with readable errors", () => {
    expect(parseStressConfig("orbs=2,speed=3")).toEqual({
      ok: false,
      error: 'unknown setting "speed" (expected orbs, rate, aura or seconds)',
    });
    expect(parseStressConfig("orbs=2,ORBS=3")).toEqual({
      ok: false,
      error: '"orbs" is set more than once',
    });
    expect(parseStressConfig("orbs")).toEqual({
      ok: false,
      error: '"orbs" is not a key=value pair',
    });
    expect(parseStressConfig("aura=maybe")).toEqual({
      ok: false,
      error: 'aura must be 1 or 0, not "maybe"',
    });
    expect(parseStressConfig("orbs=99")).toEqual({
      ok: false,
      error: 'orbs must be a whole number from 1 to 24, not "99"',
    });
  });
});

describe("formatting and turn size", () => {
  it("round-trips through the variable format", () => {
    const original = { orbs: 9, rate: 750, aura: false, seconds: 45 };
    expect(formatStressConfig(original)).toBe("orbs=9,rate=750,aura=0,seconds=45");
    expect(parseStressConfig(formatStressConfig(original))).toEqual({
      ok: true,
      config: original,
    });
  });

  it("sizes timed and rolling turns, within the shell's cap", () => {
    expect(stressTurnTokens({ orbs: 6, rate: 200, aura: true, seconds: 3 })).toBe(600);
    expect(stressTurnTokens({ orbs: 6, rate: 200, aura: true, seconds: 0 })).toBe(6000);
    expect(stressTurnTokens({ orbs: 1, rate: 5000, aura: true, seconds: 86_400 })).toBe(
      MAX_STRESS_TOKENS,
    );
  });
});
