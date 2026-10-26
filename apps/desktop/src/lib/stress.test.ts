import { describe, expect, it } from "vitest";
import type { StressConfig } from "../bindings";
import {
  DEFAULT_STRESS,
  formatStressConfig,
  MAX_STRESS_TOKENS,
  parseStressConfig,
  ROLLING_TURN_SECONDS,
  StressRun,
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

describe("StressRun", () => {
  const settings = (rate: number, seconds: number): StressConfig => ({
    orbs: 6,
    rate,
    aura: true,
    seconds,
  });

  /** Every turn of a run with fixed settings, in order. */
  function turns(config: StressConfig): number[] {
    const run = new StressRun();
    const sizes: number[] = [];
    for (let tokens = run.next(config); tokens !== null; tokens = run.next(config)) {
      sizes.push(tokens);
      if (sizes.length > 10_000) throw new Error("the run never ends");
    }
    return sizes;
  }

  const sum = (sizes: readonly number[]): number => sizes.reduce((total, size) => total + size, 0);

  it("streams a timed run that fits in one turn as that one turn, as before", () => {
    expect(turns(settings(200, 3))).toEqual([600]);
    expect(turns(settings(1, 86_400))).toEqual([86_400]);
    expect(turns(settings(5000, 100))).toEqual([MAX_STRESS_TOKENS]);
  });

  it("keeps a timed run longer than one turn going until all its seconds have streamed", () => {
    // Both ended after their first turn, at 2,500 s and 100 s: it was capped at MAX_STRESS_TOKENS.
    expect(turns(settings(200, 3600))).toEqual([MAX_STRESS_TOKENS, 220_000]);
    expect(turns(settings(5000, 600))).toEqual(Array(6).fill(MAX_STRESS_TOKENS));
    expect(turns(settings(5000, 101))).toEqual([MAX_STRESS_TOKENS, 5000]);
  });

  it("streams exactly rate x seconds tokens in turns the shell accepts, for any settings", () => {
    for (const rate of [1, 3, 7, 200, 999, 4999, 5000]) {
      for (const seconds of [1, 59, 101, 3600, 86_400]) {
        const sizes = turns(settings(rate, seconds));
        expect(sum(sizes), `rate=${rate},seconds=${seconds}`).toBe(rate * seconds);
        for (const size of sizes) {
          expect(Number.isInteger(size) && size >= 1 && size <= MAX_STRESS_TOKENS).toBe(true);
        }
        // Every turn but the last is full: as few turns (and turn boundaries) as possible.
        expect(sizes.slice(0, -1).every((size) => size === MAX_STRESS_TOKENS)).toBe(true);
      }
    }
  });

  it("streams open-ended runs in rolling turns until stopped", () => {
    const run = new StressRun();
    for (let turn = 0; turn < 1000; turn += 1) {
      expect(run.next(settings(200, 0))).toBe(200 * ROLLING_TURN_SECONDS);
    }
    expect(new StressRun().next(settings(5000, 0))).toBe(5000 * ROLLING_TURN_SECONDS);
  });

  it("sizes each turn from the settings current when it starts, and still ends on time", () => {
    const run = new StressRun();
    expect(run.next(settings(5000, 300))).toBe(MAX_STRESS_TOKENS); // 100 s
    // The rate slider moved mid-run: the 200 s left stream at the new rate.
    expect(run.next(settings(1000, 300))).toBe(200_000);
    expect(run.next(settings(1000, 300))).toBeNull();

    // Switched from open-ended to timed after one 30 s turn: the run is already over.
    const rolling = new StressRun();
    expect(rolling.next(settings(200, 0))).toBe(6000);
    expect(rolling.next(settings(200, 10))).toBeNull();
    // Or not yet: 30 s of a 45 s run have streamed.
    const longer = new StressRun();
    longer.next(settings(200, 0));
    expect(longer.next(settings(200, 45))).toBe(3000);
    expect(longer.next(settings(200, 45))).toBeNull();
  });

  it("starts nothing without a rate, rather than dividing by zero", () => {
    expect(new StressRun().next(settings(0, 60))).toBeNull();
    expect(new StressRun().next(settings(0, 0))).toBeNull();
  });
});
