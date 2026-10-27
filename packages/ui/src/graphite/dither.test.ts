import { describe, expect, it } from "vitest";
import {
  BAYER_8,
  bayerThreshold,
  clearingKeep,
  createFieldBuffers,
  createValueNoise3,
  DEFAULT_SEED,
  dissolveThreshold,
  ditherLevel,
  fbm3,
  fieldFloor,
  fieldValue,
  gridTarget,
  hash01,
  luminanceOf,
  mulberry32,
  renderDitherFrame,
  renderLevels,
  sampleField,
  shapeField,
  terrace,
  VOLT,
} from "./dither";

describe("Bayer matrix", () => {
  it("is the classic 8x8 ordering, a permutation of 0..63", () => {
    expect(BAYER_8).toHaveLength(64);
    expect([...BAYER_8].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(BAYER_8.slice(0, 8)).toEqual([0, 32, 8, 40, 2, 34, 10, 42]);
    expect(BAYER_8.slice(56, 64)).toEqual([63, 31, 55, 23, 61, 29, 53, 21]);
  });

  it("tiles every eight cells, negative coordinates included", () => {
    expect(bayerThreshold(0, 0)).toBeCloseTo(0.5 / 64, 6);
    expect(bayerThreshold(8, 16)).toBe(bayerThreshold(0, 0));
    expect(bayerThreshold(-1, -1)).toBe(bayerThreshold(7, 7));
    for (let i = 0; i < 64; i++) {
      const t = bayerThreshold(i % 8, Math.floor(i / 8));
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    }
  });
});

describe("ordered dithering", () => {
  it("maps black to 0 and full value to the top level", () => {
    for (let i = 0; i < 64; i++) {
      const t = bayerThreshold(i % 8, Math.floor(i / 8));
      expect(ditherLevel(0, 4, t)).toBe(0);
      expect(ditherLevel(-1, 4, t)).toBe(0);
      expect(ditherLevel(Number.NaN, 4, t)).toBe(0);
      expect(ditherLevel(1, 4, t)).toBe(3);
      expect(ditherLevel(2, 4, t)).toBe(3);
    }
  });

  it("averages to the input across a tile, so a dithered ramp reads as a ramp", () => {
    for (const levels of [2, 3, 4]) {
      for (let value = 0; value <= 1; value += 1 / 37) {
        let sum = 0;
        for (let i = 0; i < 64; i++) {
          sum += ditherLevel(value, levels, bayerThreshold(i % 8, Math.floor(i / 8)));
        }
        expect(sum / 64 / (levels - 1)).toBeCloseTo(value, 1);
        expect(Math.abs(sum / 64 / (levels - 1) - value)).toBeLessThanOrEqual(1 / 64 + 1e-9);
      }
    }
  });

  it("never darkens a cell as its value rises", () => {
    for (let i = 0; i < 64; i++) {
      const t = bayerThreshold(i % 8, Math.floor(i / 8));
      let previous = 0;
      for (let value = 0; value <= 1; value += 0.01) {
        const level = ditherLevel(value, 4, t);
        expect(level).toBeGreaterThanOrEqual(previous);
        previous = level;
      }
    }
  });
});

describe("hashes, random numbers and noise", () => {
  it("hashes cells deterministically and uniformly into [0, 1)", () => {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const h = hash01(x, y, 3);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
        expect(hash01(x, y, 3)).toBe(h);
        sum += h;
        count++;
      }
    }
    expect(sum / count).toBeCloseTo(0.5, 1);
    expect(hash01(10, 10, 1)).not.toBe(hash01(10, 10, 2));
  });

  it("seeds a repeatable PRNG", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(c()).not.toBe(first[0]);
  });

  it("makes smooth, bounded, seeded value noise", () => {
    const noise = createValueNoise3(7);
    const again = createValueNoise3(7);
    const other = createValueNoise3(8);
    let differs = false;
    for (let i = 0; i < 400; i++) {
      const x = i * 0.173;
      const y = i * 0.091;
      const z = i * 0.013;
      const v = noise(x, y, z);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(again(x, y, z)).toBe(v);
      if (other(x, y, z) !== v) differs = true;
      expect(Math.abs(noise(x + 0.001, y, z) - v)).toBeLessThan(0.02);
    }
    expect(differs).toBe(true);
    const fbm = fbm3(noise, 3.3, 1.7, 0.5, 4);
    expect(fbm).toBeGreaterThanOrEqual(0);
    expect(fbm).toBeLessThanOrEqual(1);
  });

  it("evolves the field slowly: a thirtieth of a second barely moves it", () => {
    const noise = createValueNoise3(DEFAULT_SEED);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.21;
      expect(
        Math.abs(fieldValue(noise, x, y, 10 + 1 / 30) - fieldValue(noise, x, y, 10)),
      ).toBeLessThan(0.01);
    }
  });
});

describe("shaping", () => {
  it("posterises into plateaus without ever reversing", () => {
    expect(terrace(0)).toBe(0);
    expect(terrace(1)).toBe(1);
    let previous = 0;
    for (let v = 0; v <= 1.0001; v += 0.005) {
      const t = terrace(v);
      expect(t).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = t;
    }
    // The middle of the second step is flat.
    expect(terrace(0.26)).toBeCloseTo(terrace(0.3), 6);
    expect(terrace(0.3)).toBeCloseTo(0.25, 6);
  });

  it("lights more of the field as density or value rises", () => {
    expect(fieldFloor(1)).toBeLessThan(fieldFloor(0));
    expect(shapeField(0.3, 0.5)).toBe(0);
    expect(shapeField(0.95, 0.5)).toBe(1);
    for (let v = 0; v < 1; v += 0.05) {
      expect(shapeField(v, 0.8)).toBeGreaterThanOrEqual(shapeField(v, 0.2));
      expect(shapeField(v + 0.05, 0.5)).toBeGreaterThanOrEqual(shapeField(v, 0.5));
    }
  });

  it("thins a clearing to black in the middle and leaves the rim alone", () => {
    expect(clearingKeep(0)).toBe(0);
    expect(clearingKeep(0.1)).toBe(0);
    expect(clearingKeep(1)).toBe(1);
    expect(clearingKeep(4)).toBe(1);
    expect(clearingKeep(0.6)).toBeGreaterThan(clearingKeep(0.3));
  });

  it("gives every cell a dissolve threshold in [0, 1), in the asked direction", () => {
    const rows = 60;
    const meanRow = (order: "down" | "up", y: number) => {
      let sum = 0;
      for (let x = 0; x < 80; x++) sum += dissolveThreshold(x, y, 80, rows, 1, order, 0.5);
      return sum / 80;
    };
    for (const order of ["scatter", "down", "up", "radial"] as const) {
      for (let y = 0; y < rows; y += 7) {
        for (let x = 0; x < 80; x += 9) {
          for (const blob of [0, 0.5, 1]) {
            const t = dissolveThreshold(x, y, 80, rows, 1, order, blob);
            expect(t).toBeGreaterThanOrEqual(0);
            expect(t).toBeLessThan(1);
          }
        }
      }
    }
    expect(meanRow("down", 50)).toBeGreaterThan(meanRow("down", 5));
    expect(meanRow("up", 5)).toBeGreaterThan(meanRow("up", 50));
  });
});

describe("frames", () => {
  const cols = 96;
  const rows = 54;

  it("renders the same frame for the same seed and time, so the still frame is stable", () => {
    const a = renderDitherFrame({ cols, rows });
    const b = renderDitherFrame({ cols, rows });
    expect(a).toEqual(b);
    expect(renderDitherFrame({ cols, rows, seed: 99 })).not.toEqual(a);
    expect(renderDitherFrame({ cols, rows, time: 30 })).not.toEqual(a);
  });

  it("uses only black, the grey levels and volt", () => {
    const frame = renderDitherFrame({ cols, rows, accent: 0.5, density: 0.8 });
    const seen = new Set(frame);
    for (const level of seen) expect([0, 1, 2, 3, VOLT]).toContain(level);
    expect(seen.has(0)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });

  it("keeps volt rare by default and absent at accent 0", () => {
    const frame = renderDitherFrame({ cols: 360, rows: 180, density: 0.6 });
    const volt = frame.filter((level) => level === VOLT).length;
    expect(volt).toBeGreaterThan(0);
    expect(volt / frame.length).toBeLessThan(0.005);
    expect(renderDitherFrame({ cols, rows, accent: 0 }).includes(VOLT)).toBe(false);
  });

  it("leaves most of the field black at the default density", () => {
    const frame = renderDitherFrame({ cols: 360, rows: 180 });
    const black = frame.filter((level) => level === 0).length / frame.length;
    expect(black).toBeGreaterThan(0.45);
    expect(black).toBeLessThan(0.95);
  });

  it("dissolves into the target: none at 0, some at a half, all at 1", () => {
    const target = new Float32Array(cols * rows).fill(1);
    const noise = renderDitherFrame({ cols, rows });
    expect(renderDitherFrame({ cols, rows, target, progress: 0 })).toEqual(noise);
    const half = renderDitherFrame({ cols, rows, target, progress: 0.5 });
    const done = renderDitherFrame({ cols, rows, target, progress: 1 });
    expect(done.every((level) => level === 3)).toBe(true);
    const resolved = half.filter((level) => level === 3).length / half.length;
    expect(resolved).toBeGreaterThan(0.2);
    expect(resolved).toBeLessThan(0.9);
    const empty = renderDitherFrame({
      cols,
      rows,
      target: new Float32Array(cols * rows),
      progress: 1,
    });
    expect(empty.every((level) => level === 0)).toBe(true);
  });

  it("clears an ellipse to black", () => {
    const frame = renderDitherFrame({
      cols,
      rows,
      density: 1,
      accent: 0,
      clearing: { x: cols / 2, y: rows / 2, rx: 30, ry: 20 },
    });
    for (let y = rows / 2 - 3; y < rows / 2 + 3; y++) {
      for (let x = cols / 2 - 5; x < cols / 2 + 5; x++) expect(frame[y * cols + x]).toBe(0);
    }
  });

  it("develops the field under the lens without inventing volt there", () => {
    const buffers = createFieldBuffers(cols, rows, DEFAULT_SEED);
    sampleField(buffers, createValueNoise3(DEFAULT_SEED), 4, 0);
    const base = {
      levels: 4,
      density: 0.3,
      accent: 1,
      progress: 0,
      target: null,
      texture: 0,
      targetSparks: false,
    };
    const plain = renderLevels(buffers, { ...base, lens: null }).slice();
    const lensed = renderLevels(buffers, {
      ...base,
      lens: { x: cols / 2, y: rows / 2, radius: 20, strength: 1 },
    }).slice();
    const lit = (frame: Uint8Array) => frame.filter((level) => level > 0 && level !== VOLT).length;
    expect(lit(lensed)).toBeGreaterThanOrEqual(lit(plain));
    expect(lensed.filter((l) => l === VOLT).length).toBe(plain.filter((l) => l === VOLT).length);
  });

  it("keeps a clearing dark under the lens", () => {
    const buffers = createFieldBuffers(cols, rows, DEFAULT_SEED);
    sampleField(buffers, createValueNoise3(DEFAULT_SEED), 4, 0);
    const frame = renderLevels(buffers, {
      levels: 4,
      density: 1,
      accent: 0,
      progress: 0,
      target: null,
      texture: 0,
      targetSparks: false,
      lens: { x: cols / 2, y: rows / 2, radius: 20, strength: 1 },
      clearing: { x: cols / 2, y: rows / 2, rx: 12, ry: 12 },
    });
    for (let y = rows / 2 - 3; y <= rows / 2 + 3; y++) {
      for (let x = cols / 2 - 3; x <= cols / 2 + 3; x++) {
        expect(frame[y * cols + x]).toBe(0);
      }
    }
  });
});

describe("targets", () => {
  it("centres a pixel grid on whole cells", () => {
    const lum = gridTarget(["#.", ".#"], 6, 6, 2);
    const at = (x: number, y: number) => lum[y * 6 + x];
    expect(at(1, 1)).toBe(1);
    expect(at(2, 2)).toBe(1);
    expect(at(3, 1)).toBe(0);
    expect(at(3, 3)).toBe(1);
    expect(at(4, 4)).toBe(1);
    expect([...lum].filter((v) => v === 1)).toHaveLength(8);
  });

  it("reads luminance with alpha as coverage", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255]);
    const lum = luminanceOf(rgba);
    expect(lum[0]).toBeCloseTo(1, 5);
    expect(lum[1]).toBe(0);
    expect(lum[2]).toBeCloseTo(0.7152, 4);
  });
});
