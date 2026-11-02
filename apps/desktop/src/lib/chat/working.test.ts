import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  LOOKING_VERBS,
  MAKING_VERBS,
  ROTATION_MAX_MS,
  ROTATION_MIN_MS,
  RUNNING_VERBS,
  rotationDelay,
  seedOf,
  THINKING_VERBS,
  type WorkingContext,
  workingContext,
  workingSince,
  workingVerb,
} from "./working";

const sequence = (seed: number, length: number, context: WorkingContext = null) =>
  Array.from({ length }, (_, tick) => workingVerb(seed, tick, context));

describe("the working line's words", () => {
  it("has about forty tasteful verbs, none repeated across its pools, none shouting", () => {
    const all = [...THINKING_VERBS, ...LOOKING_VERBS, ...MAKING_VERBS, ...RUNNING_VERBS];
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(all.length).toBeLessThanOrEqual(40);
    expect(new Set(all).size).toBe(all.length);
    for (const verb of all) {
      expect(verb).toMatch(/^[A-Z][a-z]+ing( [a-z]+)?$/);
      expect(verb).not.toMatch(/[—–]/);
    }
  });

  it("is deterministic per turn: the same seed always reads the same, other turns differ", () => {
    const seed = seedOf("turn:01a1982d");
    expect(sequence(seed, 12)).toEqual(sequence(seedOf("turn:01a1982d"), 12));
    expect(sequence(seed, 8, "look")).toEqual(sequence(seed, 8, "look"));
    expect(seedOf("turn:a")).not.toBe(seedOf("turn:b"));
    const others = ["turn:b", "turn:c", "turn:d", "turn:e"].map((key) => sequence(seedOf(key), 6));
    expect(others.some((other) => other.join() !== sequence(seed, 6).join())).toBe(true);
  });

  it("never names the same verb twice in a row, with or without a context", () => {
    for (let turn = 0; turn < 200; turn++) {
      const seed = seedOf(`turn:${turn}`);
      for (const context of [null, "look", "make", "run"] as const) {
        const words = sequence(seed, 24, context);
        for (let tick = 1; tick < words.length; tick++)
          expect(words[tick], `${turn} ${context} ${tick}`).not.toBe(words[tick - 1]);
      }
    }
  });

  it("only thinks without a context, and leans towards the latest call's words with one", () => {
    const pools = { look: LOOKING_VERBS, make: MAKING_VERBS, run: RUNNING_VERBS } as const;
    let leaned = 0;
    let total = 0;
    for (let turn = 0; turn < 100; turn++) {
      const seed = seedOf(`turn:${turn}`);
      for (const verb of sequence(seed, 10))
        expect(THINKING_VERBS as readonly string[]).toContain(verb);
      for (const context of ["look", "make", "run"] as const)
        for (const verb of sequence(seed, 10, context)) {
          total += 1;
          if ((pools[context] as readonly string[]).includes(verb)) leaned += 1;
          else expect(THINKING_VERBS as readonly string[]).toContain(verb);
        }
    }
    expect(leaned / total).toBeGreaterThan(0.5);
    expect(leaned / total).toBeLessThan(0.7);
  });

  it("swaps every 2.5 to 3.5 seconds, on a seeded beat", () => {
    const seed = seedOf("turn:t1");
    const delays = Array.from({ length: 50 }, (_, tick) => rotationDelay(seed, tick));
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(ROTATION_MIN_MS);
      expect(delay).toBeLessThan(ROTATION_MAX_MS);
    }
    expect(new Set(delays).size).toBeGreaterThan(10);
    expect(rotationDelay(seed, 3)).toBe(rotationDelay(seedOf("turn:t1"), 3));
  });

  it("takes its context from the kind of the latest call", () => {
    expect(workingContext("read")).toBe("look");
    expect(workingContext("search")).toBe("look");
    expect(workingContext("fetch")).toBe("look");
    expect(workingContext("edit")).toBe("make");
    expect(workingContext("delete")).toBe("make");
    expect(workingContext("move")).toBe("make");
    expect(workingContext("execute")).toBe("run");
    expect(workingContext("think")).toBeNull();
    expect(workingContext("other")).toBeNull();
    expect(workingContext(null)).toBeNull();
  });

  it("counts the elapsed time in whole steps", () => {
    expect(formatElapsed(-5)).toBe("0 s");
    expect(formatElapsed(999)).toBe("0 s");
    expect(formatElapsed(12_400)).toBe("12 s");
    expect(formatElapsed(65_000)).toBe("1 min 5 s");
    expect(formatElapsed(3_725_000)).toBe("1 h 2 min");
    expect(formatElapsed(Number.NaN)).toBe("0 s");
  });

  it("remembers when it first saw a turn working, so a remounted line keeps counting", () => {
    expect(workingSince("chat:turn:x", 1000)).toBe(1000);
    expect(workingSince("chat:turn:x", 9000)).toBe(1000);
    expect(workingSince("chat:turn:y", 9000)).toBe(9000);
  });
});
