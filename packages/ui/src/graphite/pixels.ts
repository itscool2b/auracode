/**
 * Pixel geometry shared by Graphite's marks: the 2x3 loader and the pixel check. Every shape is
 * laid out in whole CSS pixels inside a square box, so at 1x it lands on device pixels exactly and
 * at other ratios `shape-rendering: crispEdges` keeps it sharp.
 */

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Cell size and offset that fit an n-cell grid in `size` px on whole pixels, centred. */
export function fitGrid(size: number, cells: number, fill = 1): { cell: number; offset: number } {
  const cell = Math.max(1, Math.floor((size * fill) / cells));
  return { cell, offset: Math.floor((size - cell * cells) / 2) };
}

/** Horizontal runs of a grid's "on" cells as rectangles, in px. */
export function gridRects(
  grid: readonly string[],
  cell: number,
  offsetX = 0,
  offsetY = offsetX,
): PixelRect[] {
  const rects: PixelRect[] = [];
  grid.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      const on = row[x] === "#";
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        rects.push({
          x: offsetX + start * cell,
          y: offsetY + y * cell,
          w: (x - start) * cell,
          h: cell,
        });
        start = -1;
      }
    }
  });
  return rects;
}

/** An SVG path (`M x y h w v h h -w z` per run) for a grid's "on" cells. */
export function gridPath(
  grid: readonly string[],
  cell: number,
  offsetX = 0,
  offsetY = offsetX,
): string {
  return gridRects(grid, cell, offsetX, offsetY)
    .map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`)
    .join("");
}

/*
 * The 2x3 loader. Cells are numbered row-major, two per row:
 *   0 1
 *   2 3
 *   4 5
 * A light walks the perimeter clockwise with a two-cell trail.
 */
export const LOADER_ORDER: readonly number[] = Object.freeze([0, 1, 3, 5, 4, 2]);

/** Brightness per loader cell for a step: 3 head, 2 and 1 trail, 0 rest. */
export function loaderFrame(step: number): number[] {
  const levels = [0, 0, 0, 0, 0, 0];
  const n = LOADER_ORDER.length;
  const head = ((Math.floor(step) % n) + n) % n;
  levels[LOADER_ORDER[head] ?? 0] = 3;
  levels[LOADER_ORDER[(head + n - 1) % n] ?? 0] = 2;
  levels[LOADER_ORDER[(head + n - 2) % n] ?? 0] = 1;
  return levels;
}

/** Milliseconds per loader step: thinking walks slowest, streaming fastest. */
export const LOADER_STEP_MS = { thinking: 130, tool: 110, streaming: 90 } as const;

/** Loader cell geometry inside a square box of `size` px. */
export function loaderRects(size: number): PixelRect[] {
  const cell = Math.max(2, Math.round(size * 0.125));
  const gap = Math.max(1, Math.round(size * 0.0625));
  const w = 2 * cell + gap;
  const h = 3 * cell + 2 * gap;
  const x0 = Math.floor((size - w) / 2);
  const y0 = Math.floor((size - h) / 2);
  return Array.from({ length: 6 }, (_, i) => ({
    x: x0 + (i % 2) * (cell + gap),
    y: y0 + Math.floor(i / 2) * (cell + gap),
    w: cell,
    h: cell,
  }));
}

/** A solid square of about `fraction` of the box, centred on whole pixels. */
export function centredSquare(size: number, fraction: number): PixelRect {
  let side = Math.max(2, Math.round(size * fraction));
  if ((size - side) % 2 !== 0) side += 1;
  const at = (size - side) / 2;
  return { x: at, y: at, w: side, h: side };
}

/** The done check as pixels, in drawing order: short arm, then the long one. */
export const CHECK_GRID: readonly string[] = Object.freeze(["....#", "...#.", "#.#..", ".#..."]);
const CHECK_ORDER: ReadonlyArray<readonly [number, number]> = [
  [0, 2],
  [1, 3],
  [2, 2],
  [3, 1],
  [4, 0],
];

/** The check's cells inside a square box of `size` px, in the order they draw. */
export function checkRects(size: number): PixelRect[] {
  const cell = Math.max(2, Math.round(size / 8));
  const x0 = Math.floor((size - 5 * cell) / 2);
  const y0 = Math.floor((size - 4 * cell) / 2);
  return CHECK_ORDER.map(([x, y]) => ({ x: x0 + x * cell, y: y0 + y * cell, w: cell, h: cell }));
}
