import { describe, expect, it } from "vitest";
import { LOGO_PATH, LOGO_SMALL_MAX, LOGO_SMALL_PATH, LOGO_VIEWBOX, logoSvg } from "./logoPaths";

/** Every coordinate pair of a path made of M, C, L and Z commands. */
function points(d: string): Array<[number, number]> {
  const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) out.push([numbers[i] ?? 0, numbers[i + 1] ?? 0]);
  return out;
}

describe("the logo", () => {
  it.each([
    ["full", LOGO_PATH],
    ["small", LOGO_SMALL_PATH],
  ])("%s path is one even-odd shape of closed subpaths inside its view box", (_, d) => {
    expect(d).toMatch(/^M[\d.]/);
    expect(d).toMatch(/^[MCLZ\d. -]+$/);
    // The outline plus its holes, the two eyes.
    const subpaths = d.match(/M/g)?.length ?? 0;
    expect(subpaths).toBeGreaterThanOrEqual(3);
    expect(d.match(/Z/g)?.length).toBe(subpaths);
    // Curve control points may sit a hair outside the outline; the 4-unit margin absorbs them.
    const [w, h] = LOGO_VIEWBOX;
    for (const [x, y] of points(d)) {
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(y).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThanOrEqual(w + 2);
      expect(y).toBeLessThanOrEqual(h + 2);
    }
  });

  it("writes a standalone icon SVG on a rounded black tile", () => {
    const svg = logoSvg({ size: 512 });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="512" height="512"/);
    expect(svg).toContain('<rect width="512" height="512" rx="115" fill="#000000"/>');
    expect(svg).toContain('fill="#ededed" fill-rule="evenodd"');
    expect(svg).toContain(LOGO_PATH);
  });

  it("uses the small variant for tiny icons and can drop the tile", () => {
    const bare = logoSvg({ size: LOGO_SMALL_MAX, padding: 0, background: null, color: "#000000" });
    expect(bare).not.toContain("<rect");
    expect(bare).toContain('fill="#000000"');
    expect(bare).toContain(LOGO_SMALL_PATH);
  });

  it("centres the logo inside the padding", () => {
    const svg = logoSvg({ size: 1000, padding: 0.1 });
    const match = svg.match(/translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/);
    expect(match).not.toBeNull();
    const [, tx, ty, s] = match ?? [];
    const [w, h] = LOGO_VIEWBOX;
    const scale = Number(s);
    expect(scale * Math.max(w, h)).toBeCloseTo(800, 0);
    expect(Number(tx) * 2 + w * scale).toBeCloseTo(1000, 0);
    expect(Number(ty) * 2 + h * scale).toBeCloseTo(1000, 0);
  });
});
