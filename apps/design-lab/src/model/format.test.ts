import { describe, expect, it } from "vitest";
import {
  basename,
  dirname,
  formatCost,
  formatCount,
  formatDuration,
  formatElapsed,
  plural,
} from "./format";

describe("formatElapsed", () => {
  it("counts whole seconds, rounding down, then minutes and hours", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(999)).toBe("0s");
    expect(formatElapsed(6000)).toBe("6s");
    expect(formatElapsed(59_999)).toBe("59s");
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(3_600_000)).toBe("1h 00m");
    expect(formatElapsed(3_725_000)).toBe("1h 02m");
  });

  it("shows nonsense as zero", () => {
    expect(formatElapsed(-5)).toBe("0s");
    expect(formatElapsed(Number.NaN)).toBe("0s");
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("0s");
  });
});

describe("formatDuration", () => {
  it("rounds to the nearest second", () => {
    expect(formatDuration(48_000)).toBe("48s");
    expect(formatDuration(6_400)).toBe("6s");
    expect(formatDuration(6_600)).toBe("7s");
    expect(formatDuration(59_600)).toBe("1m 00s");
  });

  it("never shows a short, real duration as zero", () => {
    expect(formatDuration(300)).toBe("<1s");
    expect(formatDuration(600)).toBe("1s");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
  });
});

describe("formatCount", () => {
  it("abbreviates thousands and millions, rounding before choosing the unit", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(950)).toBe("950");
    expect(formatCount(4_812)).toBe("4.8k");
    expect(formatCount(96_384)).toBe("96.4k");
    expect(formatCount(2_000)).toBe("2k");
    expect(formatCount(999_950)).toBe("1M");
    expect(formatCount(12_345_678)).toBe("12.3M");
    expect(formatCount(-1_500)).toBe("-1.5k");
    expect(formatCount(Number.NaN)).toBe("0");
  });
});

describe("formatCost", () => {
  it("shows cents, and four decimals under a cent", () => {
    expect(formatCost(0.21, "USD")).toBe("$0.21");
    expect(formatCost(1.4, "usd")).toBe("$1.40");
    expect(formatCost(0.0034, "USD")).toBe("$0.0034");
    expect(formatCost(0, "USD")).toBe("$0.00");
    expect(formatCost(0.21, "EUR")).toBe("0.21 EUR");
  });

  it("returns null without a usable amount", () => {
    expect(formatCost(null, "USD")).toBeNull();
    expect(formatCost(Number.NaN, "USD")).toBeNull();
    expect(formatCost(-1, "USD")).toBeNull();
  });
});

describe("words and paths", () => {
  it("pluralises", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(2, "file")).toBe("2 files");
    expect(plural(0, "match", "matches")).toBe("0 matches");
  });

  it("splits paths on either separator", () => {
    expect(basename("packages/ui/src/orb/pacing.ts")).toBe("pacing.ts");
    expect(basename("C:\\work\\app.rs")).toBe("app.rs");
    expect(basename("src/")).toBe("src");
    expect(basename("README.md")).toBe("README.md");
    expect(dirname("packages/ui/src/orb/pacing.ts")).toBe("packages/ui/src/orb");
    expect(dirname("README.md")).toBe("");
  });
});
