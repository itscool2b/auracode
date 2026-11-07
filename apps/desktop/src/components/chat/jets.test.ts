import { describe, expect, it } from "vitest";
import { JETS, pickJet } from "./jets";

const MIRROR: Readonly<Record<string, string>> = {
  "/": "\\",
  "\\": "/",
  "(": ")",
  ")": "(",
  "<": ">",
  ">": "<",
  "[": "]",
  "]": "[",
};

/** The drawing's lines, cut to its own box: the common indent off, padded to its widest line. */
function box(art: string): string[] {
  const lines = art.split("\n");
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length),
  );
  const cut = lines.map((line) => line.slice(indent).trimEnd());
  const width = Math.max(...cut.map((line) => line.length));
  return cut.map((line) => line.padEnd(width));
}

const mirrored = (line: string) =>
  [...line]
    .reverse()
    .map((char) => MIRROR[char] ?? char)
    .join("");

/** Remembers like localStorage, in memory. */
function memory(saved: string | null = null) {
  let value = saved;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe("New chat's jets", () => {
  it("are at least fifteen aircraft, each named once", () => {
    expect(JETS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(JETS.map((jet) => jet.name)).size).toBe(JETS.length);
    for (const name of ["B-2 Spirit", "SR-71 Blackbird", "F-22 Raptor", "F-35 Lightning II"])
      expect(JETS.map((jet) => jet.name)).toContain(name);
    expect(JETS.some((jet) => jet.name.includes("Tomcat"))).toBe(true);
  });

  it("are each a mirror image of itself, nose up", () => {
    for (const jet of JETS) {
      const lines = box(jet.art);
      for (const [index, line] of lines.entries())
        expect(mirrored(line), `${jet.name}, line ${index + 1}`).toBe(line);
    }
  });

  it("fit the hero: at most 17 lines (the height it keeps) and 64 columns", () => {
    for (const jet of JETS) {
      const lines = jet.art.split("\n");
      expect(lines.length, jet.name).toBeLessThanOrEqual(17);
      expect(Math.max(...lines.map((line) => line.length)), jet.name).toBeLessThanOrEqual(64);
      expect(
        lines.every((line) => line === line.trimEnd()),
        jet.name,
      ).toBe(true);
    }
  });

  it("never shows the jet the last launch showed", () => {
    for (const [index, last] of JETS.entries()) {
      const storage = memory(last.name);
      // Every draw, from the first choice to the last, lands on another jet.
      for (const random of [0, 0.5, 0.999999, index / JETS.length]) {
        const jet = pickJet(() => random, memory(last.name));
        expect(jet.name).not.toBe(last.name);
      }
      const next = pickJet(() => 0.3, storage);
      expect(storage.getItem()).toBe(next.name);
    }
  });

  it("reaches every jet, and still picks one when storage fails", () => {
    const seen = new Set(JETS.map((_, index) => pickJet(() => index / JETS.length, memory()).name));
    expect(seen.size).toBe(JETS.length);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(JETS).toContain(pickJet(() => 0.5, broken));
    expect(JETS).toContain(pickJet(() => 0.5, null));
  });
});
