import { describe, expect, it } from "vitest";
import {
  centredSquare,
  checkRects,
  fitGrid,
  gridPath,
  gridRects,
  LOADER_ORDER,
  LOADER_STEP_MS,
  loaderFrame,
  loaderRects,
  PIXEL_MARK_GRID,
  pixelMarkSvg,
} from "./pixels";

const onCells = (grid: readonly string[]) =>
  grid.reduce((total, row) => total + [...row].filter((c) => c === "#").length, 0);

describe("the auracode glyph", () => {
  it("is a 6x6 grid of on and off cells", () => {
    expect(PIXEL_MARK_GRID).toHaveLength(6);
    for (const row of PIXEL_MARK_GRID) expect(row).toMatch(/^[#.]{6}$/);
    expect(Object.isFrozen(PIXEL_MARK_GRID)).toBe(true);
  });

  it("lands on whole pixels, centred, at every size the product uses", () => {
    for (const size of [12, 16, 20, 24, 32, 48, 64, 128]) {
      const { cell, offset } = fitGrid(size, 6);
      expect(Number.isInteger(cell), `${size}`).toBe(true);
      expect(Number.isInteger(offset), `${size}`).toBe(true);
      expect(offset * 2 + cell * 6, `${size}`).toBe(size);
    }
    expect(fitGrid(16, 6)).toEqual({ cell: 2, offset: 2 });
    expect(fitGrid(20, 6)).toEqual({ cell: 3, offset: 1 });
    expect(fitGrid(24, 6)).toEqual({ cell: 4, offset: 0 });
    expect(fitGrid(32, 6)).toEqual({ cell: 5, offset: 1 });
  });

  it("merges each row's run of on cells into one rectangle covering exactly those cells", () => {
    const rects = gridRects(PIXEL_MARK_GRID, 3, 1);
    const area = rects.reduce((total, r) => total + r.w * r.h, 0);
    expect(area).toBe(onCells(PIXEL_MARK_GRID) * 9);
    expect(rects.length).toBeLessThan(onCells(PIXEL_MARK_GRID));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(1);
      expect(r.y).toBeGreaterThanOrEqual(1);
      expect(r.x + r.w).toBeLessThanOrEqual(19);
    }
    expect(gridPath(["#"], 4, 2)).toBe("M2 2h4v4h-4z");
  });

  it("writes a standalone icon SVG for the app icon and favicons", () => {
    const svg = pixelMarkSvg({ size: 512 });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="512" height="512"/);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('fill="#ededed"');
    const bare = pixelMarkSvg({ size: 16, padding: 0, background: null, color: "#000000" });
    expect(bare).not.toContain("<rect");
    expect(bare).toContain('d="M4 2h8v2h-8z');
  });
});

describe("the 2x3 loader", () => {
  it("walks one head and a two-cell trail round the perimeter", () => {
    expect([...LOADER_ORDER].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    for (let step = -12; step < 24; step++) {
      const levels = loaderFrame(step);
      expect([...levels].sort()).toEqual([0, 0, 0, 1, 2, 3]);
      expect(loaderFrame(step + 6)).toEqual(levels);
      const head = levels.indexOf(3);
      const next = loaderFrame(step + 1);
      // The head moves on, and where it was becomes the first trail cell.
      expect(next[head]).toBe(2);
    }
    expect(loaderFrame(0)).toEqual([3, 0, 2, 0, 1, 0]);
  });

  it("steps faster while streaming than while thinking", () => {
    expect(LOADER_STEP_MS.streaming).toBeLessThan(LOADER_STEP_MS.tool);
    expect(LOADER_STEP_MS.tool).toBeLessThan(LOADER_STEP_MS.thinking);
  });

  it("lays its six cells on whole pixels inside the box at every size", () => {
    for (const size of [12, 14, 16, 20, 24, 32, 48, 56]) {
      const rects = loaderRects(size);
      expect(rects).toHaveLength(6);
      for (const r of rects) {
        for (const n of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(n)).toBe(true);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(size);
        expect(r.y + r.h).toBeLessThanOrEqual(size);
      }
      const first = rects[0];
      const last = rects[5];
      if (first && last) {
        const left = first.x;
        const right = size - (last.x + last.w);
        expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      }
    }
    expect(loaderRects(16)[0]).toEqual({ x: 5, y: 4, w: 2, h: 2 });
  });
});

describe("state shapes", () => {
  it("centres squares and the check on whole pixels", () => {
    for (const size of [14, 16, 20, 24, 32, 48, 56]) {
      const square = centredSquare(size, 0.375);
      expect(Number.isInteger(square.x)).toBe(true);
      expect(square.x * 2 + square.w).toBe(size);
      const check = checkRects(size);
      expect(check).toHaveLength(5);
      for (const r of check) {
        expect(Number.isInteger(r.x) && Number.isInteger(r.y)).toBe(true);
        expect(r.x + r.w).toBeLessThanOrEqual(size);
        expect(r.y + r.h).toBeLessThanOrEqual(size);
      }
    }
    expect(centredSquare(16, 0.375)).toEqual({ x: 5, y: 5, w: 6, h: 6 });
  });
});
