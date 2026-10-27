import { describe, expect, it } from "vitest";
import {
  createFieldBuffers,
  createValueNoise3,
  DEFAULT_SEED,
  renderDitherFrame,
  renderLevels,
  sampleField,
  VOLT,
} from "./dither";
import { type DitherSprite, paintSprites, parseSprite, spritePose } from "./sprites";

// A 4x3 arrow facing right, in two frames.
const ARROW: readonly (readonly string[])[] = [
  ["99..", "9999", "99.."],
  ["9...", "9999", "9..."],
];

const sprite = (overrides: Partial<DitherSprite> = {}): DitherSprite => ({
  frames: ARROW,
  x: 0.5,
  y: 0.5,
  vx: 0,
  halo: 0,
  ...overrides,
});

describe("sprite art", () => {
  it("reads empty cells, ninths and solid black, once per frames array", () => {
    const art = parseSprite([["9.0#", "4  3"]]);
    expect(art.width).toBe(4);
    expect(art.height).toBe(2);
    const lum = art.frames[0];
    expect(lum?.[0]).toBe(1);
    expect(lum?.[1]).toBe(-1);
    expect(lum?.[2]).toBe(0);
    expect(lum?.[3]).toBe(1);
    expect(lum?.[4]).toBeCloseTo(4 / 9, 6);
    expect(lum?.[5]).toBe(-1);
    expect(parseSprite(ARROW)).toBe(parseSprite(ARROW));
  });

  it("refuses frames of different sizes", () => {
    expect(() => parseSprite([["99"], ["999"]])).toThrow();
  });
});

describe("sprite paths", () => {
  it("starts at its fractions of the field and drifts in CSS px per second", () => {
    const still = spritePose(sprite(), 0, 100, 50, 4);
    expect(still.x).toBe(50);
    expect(still.y).toBe(25);
    const moving = sprite({ vx: 20 });
    expect(spritePose(moving, 0, 100, 50, 4).x).toBe(50);
    expect(spritePose(moving, 2, 100, 50, 4).x).toBeCloseTo(60, 6);
  });

  it("faces its direction of travel", () => {
    expect(spritePose(sprite({ vx: 10 }), 0, 100, 50, 4).flip).toBe(false);
    expect(spritePose(sprite({ vx: -10 }), 0, 100, 50, 4).flip).toBe(true);
  });

  it("leaves the field completely before entering from the other side", () => {
    const fast = sprite({ x: 0.9, vx: 40 });
    const xs = Array.from({ length: 200 }, (_, i) => spritePose(fast, i * 0.25, 100, 50, 4).x);
    const wrap = xs.findIndex((x, i) => i > 0 && x < (xs[i - 1] ?? 0));
    expect(wrap).toBeGreaterThan(0);
    // Just before the wrap it is past the right edge, just after it is before the left edge.
    expect(xs[wrap - 1] ?? 0).toBeGreaterThan(100);
    expect(xs[wrap] ?? 0).toBeLessThan(0);
  });

  it("bobs, steps its frames and stays put at time 0 for a frozen field", () => {
    const bobbing = sprite({ bob: 8, bobPeriod: 4, fps: 2 });
    const quarter = spritePose(bobbing, 1, 100, 50, 4);
    expect(quarter.y).toBeCloseTo(25 + 8 / 4, 6);
    expect(spritePose(bobbing, 0, 100, 50, 4).frame).toBe(0);
    expect(spritePose(bobbing, 0.5, 100, 50, 4).frame).toBe(1);
    expect(spritePose(bobbing, 1, 100, 50, 4).frame).toBe(0);
  });

  it("rolls lazily: upright, then upside down halfway through the roll", () => {
    const rolling = sprite({ roll: { every: 10, duration: 2 } });
    expect(spritePose(rolling, 0, 100, 50, 4).squash).toBe(1);
    expect(spritePose(rolling, 1, 100, 50, 4).squash).toBeCloseTo(-1, 6);
    expect(spritePose(rolling, 5, 100, 50, 4).squash).toBe(1);
  });

  it("eases away from a point such as the pointer lens", () => {
    const plain = spritePose(sprite(), 0, 100, 50, 4);
    const pushed = spritePose(sprite(), 0, 100, 50, 4, { x: 46, y: 25, radius: 10, strength: 1 });
    expect(pushed.x).toBeGreaterThan(plain.x);
    const far = spritePose(sprite(), 0, 100, 50, 4, { x: 5, y: 5, radius: 4, strength: 1 });
    expect(far.x).toBe(plain.x);
  });
});

describe("painting sprites", () => {
  it("writes the art's luminance into its cells and leaves the rest of the field alone", () => {
    const overlay = new Float32Array(20 * 10);
    const drawn = paintSprites(overlay, 20, 10, [sprite()], 0, 4);
    expect(drawn).toBe(true);
    const at = (x: number, y: number) => overlay[y * 20 + x];
    // A 4x3 sprite centred on (10, 5) spans x 8..11 and y 4..6.
    expect(at(8, 4)).toBe(1);
    expect(at(10, 4)).toBe(-1);
    expect(at(11, 5)).toBe(1);
    expect(at(0, 0)).toBe(-1);
    expect([...overlay].filter((v) => v >= 0)).toHaveLength(8);
  });

  it("mirrors the art when it swims left", () => {
    const overlay = new Float32Array(20 * 10);
    paintSprites(overlay, 20, 10, [sprite({ vx: -1 })], 0, 4);
    expect(overlay[4 * 20 + 11]).toBe(1);
    expect(overlay[4 * 20 + 8]).toBe(-1);
  });

  it("cuts a black moat around the shape so it reads against the noise", () => {
    const overlay = new Float32Array(20 * 10);
    paintSprites(overlay, 20, 10, [sprite({ halo: 1 })], 0, 4);
    expect(overlay[3 * 20 + 8]).toBe(0);
    expect(overlay[5 * 20 + 7]).toBe(0);
    expect(overlay[5 * 20 + 9]).toBe(1);
    expect(overlay[0]).toBe(-1);
  });

  it("draws nothing for a sprite off the field", () => {
    const overlay = new Float32Array(20 * 10);
    expect(paintSprites(overlay, 20, 10, [sprite({ x: 3 })], 0, 4)).toBe(false);
    expect(overlay.every((v) => v === -1)).toBe(true);
  });
});

describe("sprites in the field", () => {
  const cols = 64;
  const rows = 32;
  const base = {
    levels: 4,
    accent: 1,
    progress: 0,
    target: null,
    texture: 0,
    targetSparks: false,
    lens: null,
  };
  const solid = sprite({ frames: [["9999", "9999", "9999"]], halo: 1 });

  it("leaves the field unchanged when no sprite lands", () => {
    const overlay = new Float32Array(cols * rows);
    paintSprites(overlay, cols, rows, [], 0, 4);
    expect(renderDitherFrame({ cols, rows, overlay })).toEqual(renderDitherFrame({ cols, rows }));
  });

  it("dithers sprites in the field's own cells, with no volt on them", () => {
    const buffers = createFieldBuffers(cols, rows, DEFAULT_SEED);
    sampleField(buffers, createValueNoise3(DEFAULT_SEED), 4, 0);
    const overlay = new Float32Array(cols * rows);
    paintSprites(overlay, cols, rows, [solid], 0, 4);
    const frame = renderLevels(buffers, { ...base, density: 1, overlay }).slice();
    for (let y = 15; y <= 17; y++) {
      for (let x = 30; x <= 33; x++) expect(frame[y * cols + x]).toBe(3);
    }
    // The moat is black even where the dense field would light up.
    for (let x = 29; x <= 34; x++) expect(frame[14 * cols + x]).toBe(0);
    const volt = [...frame].filter((level, i) => level === VOLT && (overlay[i] ?? -1) >= 0);
    expect(volt).toHaveLength(0);
  });

  it("fades sprites to black inside a clearing", () => {
    const buffers = createFieldBuffers(cols, rows, DEFAULT_SEED);
    sampleField(buffers, createValueNoise3(DEFAULT_SEED), 4, 0);
    const overlay = new Float32Array(cols * rows);
    paintSprites(overlay, cols, rows, [solid], 0, 4);
    const frame = renderLevels(buffers, {
      ...base,
      density: 1,
      overlay,
      clearing: { x: cols / 2, y: rows / 2, rx: 14, ry: 10 },
    });
    for (let y = 15; y <= 17; y++) {
      for (let x = 30; x <= 33; x++) expect(frame[y * cols + x]).toBe(0);
    }
  });

  it("puts sprites into a still frame exactly where the engine draws them at time 0", () => {
    const overlay = new Float32Array(cols * rows);
    paintSprites(overlay, cols, rows, [solid], 0, 4);
    const a = renderDitherFrame({ cols, rows, overlay, accent: 0 });
    expect(a).toEqual(renderDitherFrame({ cols, rows, overlay, accent: 0 }));
    expect(a).not.toEqual(renderDitherFrame({ cols, rows, accent: 0 }));
    expect(a[16 * cols + 31]).toBe(3);
  });

  it("keeps sprites bright under a ceiling that dims the field", () => {
    const buffers = createFieldBuffers(cols, rows, DEFAULT_SEED);
    sampleField(buffers, createValueNoise3(DEFAULT_SEED), 4, 0);
    const overlay = new Float32Array(cols * rows);
    paintSprites(overlay, cols, rows, [solid], 0, 4);
    const frame = renderLevels(buffers, { ...base, accent: 0, density: 1, overlay, ceiling: 0.5 });
    expect(frame[16 * cols + 31]).toBe(3);
    const field = [...frame].filter((_, i) => (overlay[i] ?? -1) < 0);
    expect(field.includes(3)).toBe(false);
    expect(field.includes(2)).toBe(true);
  });
});
