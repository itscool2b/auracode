import { describe, expect, it } from "vitest";
import { FALLBACK_RGB, hexToRgb, mixHex, mixRgb, parseHexColor, rgbToHex } from "./color";

describe("parseHexColor", () => {
  it("parses six- and three-digit hex, with or without #", () => {
    expect(parseHexColor("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(parseHexColor("FF8000")).toEqual([1, 128 / 255, 0]);
    expect(parseHexColor("#f80")).toEqual([1, 136 / 255, 0]);
    expect(parseHexColor("  #000000 ")).toEqual([0, 0, 0]);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "#", "#abcd", "#12345g", "red", "rgb(0 0 0)", "#ff80001"]) {
      expect(parseHexColor(bad)).toBeNull();
    }
    expect(parseHexColor(undefined as unknown as string)).toBeNull();
  });
});

describe("hexToRgb", () => {
  it("falls back instead of failing", () => {
    expect(hexToRgb("nope")).toBe(FALLBACK_RGB);
    expect(hexToRgb("nope", [0, 0, 1])).toEqual([0, 0, 1]);
  });
});

describe("rgbToHex", () => {
  it("round-trips and clamps", () => {
    expect(rgbToHex([1, 128 / 255, 0])).toBe("#ff8000");
    expect(rgbToHex([2, -1, Number.NaN])).toBe("#ff0000");
  });
});

describe("mixing", () => {
  it("hits both endpoints and the midpoint, and clamps t", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#000000", "#ffffff", 7)).toBe("#ffffff");
    expect(mixRgb([0, 0, 0], [1, 1, 1], Number.NaN)).toEqual([0, 0, 0]);
  });
});
