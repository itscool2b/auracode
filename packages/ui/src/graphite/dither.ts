/**
 * Pure maths behind DitherField: a Bayer 8x8 ordered dither of a slowly evolving, domain-warped
 * value-noise field, quantised to black plus a few greys, with rare volt pixels where the field
 * peaks. Nothing here touches the DOM, so the same frame renders in a browser, in a test or in a
 * build script that writes the static fallback image.
 *
 * Units: a "cell" is one dither pixel (4 CSS px by default). The noise is sampled on a coarse grid
 * every COARSE_STEP cells and interpolated, because the field is deliberately smooth and the
 * dither, not the noise, supplies the fine texture. That keeps a full-width hero near 2ms a frame.
 */

/** Palette index written for a lit volt pixel; greys are 0 (black) to levels - 1. */
export const VOLT = 255;

/** Cells between coarse noise samples. */
export const COARSE_STEP = 4;

/** Wavelength of the base noise octave, in CSS px. Large on purpose: forms, not static. */
export const FEATURE_PX = 420;

/** Field value above which a cell counts as a peak and may light up in volt. */
export const PEAK = 0.72;

/** Width of the bright front that runs ahead of a dissolve, in progress units. */
export const FRONT = 0.025;

/** How cells resolve into the target as progress rises. */
export type DissolveOrder = "scatter" | "down" | "up" | "radial";

function buildBayer(size: number): number[] {
  let matrix = [0];
  let n = 1;
  while (n < size) {
    const next = new Array<number>(4 * n * n);
    for (let y = 0; y < 2 * n; y++) {
      for (let x = 0; x < 2 * n; x++) {
        const quadrant = y < n ? (x < n ? 0 : 2) : x < n ? 3 : 1;
        next[y * 2 * n + x] = 4 * (matrix[(y % n) * n + (x % n)] ?? 0) + quadrant;
      }
    }
    matrix = next;
    n *= 2;
  }
  return matrix;
}

/** The 8x8 Bayer index matrix, row-major, a permutation of 0..63. */
export const BAYER_8: readonly number[] = Object.freeze(buildBayer(8));

const THRESHOLDS = new Float32Array(BAYER_8.map((index) => (index + 0.5) / 64));

/** The ordered-dither threshold of a cell, in (0, 1). Tiles every 8 cells, negatives included. */
export function bayerThreshold(x: number, y: number): number {
  return THRESHOLDS[((y & 7) << 3) | (x & 7)] ?? 0.5;
}

/**
 * Quantises a 0..1 value to one of `levels` steps, rounding up where the fractional part beats the
 * cell's threshold. Averaged over an 8x8 tile the result equals value * (levels - 1), which is what
 * makes a dithered gradient read as a gradient.
 */
export function ditherLevel(value: number, levels: number, threshold: number): number {
  const top = Math.max(1, Math.floor(levels) - 1);
  if (!(value > 0)) return 0;
  if (value >= 1) return top;
  const scaled = value * top;
  const base = Math.floor(scaled);
  return Math.min(top, base + (scaled - base > threshold ? 1 : 0));
}

/** A deterministic hash of a cell and a seed, uniform in [0, 1). */
export function hash01(x: number, y: number, seed: number): number {
  let h =
    (Math.imul(x | 0, 0x27d4eb2d) ^
      Math.imul(y | 0, 0x165667b1) ^
      Math.imul(seed | 0, 0x9e3779b1)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 3D (x, y and time), in [0, 1]. */
export type Noise3 = (x: number, y: number, z: number) => number;

/** Seeded 3D value noise on a 256-cell lattice with quintic interpolation. */
export function createValueNoise3(seed: number): Noise3 {
  const random = mulberry32(seed);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = swap;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255] ?? 0;
  const values = new Float32Array(256);
  for (let i = 0; i < 256; i++) values[i] = random();
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lattice = (index: number) => values[perm[index] ?? 0] ?? 0;
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const w = fade(z - zi);
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const a = (perm[X] ?? 0) + Y;
    const aa = (perm[a] ?? 0) + Z;
    const ab = (perm[a + 1] ?? 0) + Z;
    const b = (perm[X + 1] ?? 0) + Y;
    const ba = (perm[b] ?? 0) + Z;
    const bb = (perm[b + 1] ?? 0) + Z;
    const x00 = lattice(aa) + (lattice(ba) - lattice(aa)) * u;
    const x10 = lattice(ab) + (lattice(bb) - lattice(ab)) * u;
    const x01 = lattice(aa + 1) + (lattice(ba + 1) - lattice(aa + 1)) * u;
    const x11 = lattice(ab + 1) + (lattice(bb + 1) - lattice(ab + 1)) * u;
    const y0 = x00 + (x10 - x00) * v;
    const y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  };
}

/*
 * Each octave is rotated by about 37 degrees and scaled by 2.03, so the lattice of one octave never
 * lines up with the next and the field shows no grid.
 */
const ROT_COS = 0.8;
const ROT_SIN = 0.6;

/** Fractal sum of `octaves` noise layers, normalised back to [0, 1]. */
export function fbm3(noise: Noise3, x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let px = x;
  let py = y;
  let pz = z;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * noise(px, py, pz);
    norm += amplitude;
    const rx = (ROT_COS * px - ROT_SIN * py) * 2.03;
    const ry = (ROT_SIN * px + ROT_COS * py) * 2.03;
    px = rx + 17.31;
    py = ry - 9.17;
    pz *= 1.37;
    amplitude *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * The field at a point (noise units) and time (seconds): fbm warped by two more fbm lookups, which
 * turns blobs into the folded, flowing forms that make an ordered dither look drawn rather than
 * noisy. Returns roughly 0.2..0.8, centred near 0.5.
 */
export function fieldValue(noise: Noise3, x: number, y: number, time: number): number {
  const z = time * 0.03;
  const qx = fbm3(noise, x + time * 0.004, y, z, 2);
  const qy = fbm3(noise, x + 5.2, y + 1.3 - time * 0.007, z + 3.7, 2);
  return fbm3(noise, x + 2.4 * qx, y + 2.4 * qy, z * 0.7 + 11.1, 4);
}

/** The field value below which a cell stays black, for a density in [0, 1]. */
export function fieldFloor(density: number): number {
  return 0.74 - 0.36 * Math.min(1, Math.max(0, density));
}

/** Width of the ramp from black to the brightest grey, in field units. */
const RAMP = 0.24;

/** Plateaus in the shaped field, and the share of each step spent on its soft edge. */
const TERRACES = 4;
const TERRACE_EDGE = 0.2;

/**
 * Posterises a 0..1 value into TERRACES flat plateaus joined by short smooth edges. Each plateau
 * dithers to one steady Bayer pattern, so the field reads as drawn areas of tone with crisp,
 * patterned transitions (the 1-bit print look) rather than as fog. Monotonic; 0 and 1 are fixed.
 */
export function terrace(value: number): number {
  const s = Math.min(1, Math.max(0, value)) * TERRACES;
  const step = Math.min(TERRACES - 1, Math.floor(s));
  const t = Math.min(1, Math.max(0, (s - step - (0.5 - TERRACE_EDGE)) / (2 * TERRACE_EDGE)));
  return (step + t * t * (3 - 2 * t)) / TERRACES;
}

/**
 * Maps a raw field value to coverage in [0, 1]. `density` 0 lights almost nothing, 1 lights most of
 * the field; the default 0.5 leaves about two thirds of the field black, so forms read as forms.
 */
export function shapeField(value: number, density: number): number {
  const s = Math.min(1, Math.max(0, (value - fieldFloor(density)) / RAMP));
  return terrace(s * s * (3 - 2 * s));
}

/**
 * The progress at which a cell leaves the noise for the target, in [0, 1). Half of it is random per
 * cell, so the dissolve happens a pixel at a time; half is a slow noise (`blob`, 0..1), so the
 * pixels go in ragged islands rather than as salt and pepper. An order adds a direction on top.
 */
export function dissolveThreshold(
  x: number,
  y: number,
  cols: number,
  rows: number,
  seed: number,
  order: DissolveOrder,
  blob = 0.5,
): number {
  const r = Math.min(0.9999, 0.5 * hash01(x, y, seed ^ 0x51ed27) + 0.5 * blob);
  switch (order) {
    case "down":
      return 0.6 * (y / Math.max(1, rows)) + 0.4 * r;
    case "up":
      return 0.6 * (1 - (y + 1) / Math.max(1, rows)) + 0.4 * r;
    case "radial": {
      const dx = (x + 0.5) / Math.max(1, cols) - 0.5;
      const dy = (y + 0.5) / Math.max(1, rows) - 0.5;
      const d = Math.min(0.999, Math.sqrt(dx * dx + dy * dy) / Math.SQRT1_2);
      return 0.6 * d + 0.4 * r;
    }
    default:
      return r;
  }
}

/** A circular lens in cell units; strength 0..1 fades it in and out. */
export interface DitherLens {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly strength: number;
}

/** Buffers reused across frames; rebuild with createFieldBuffers when the size or seed changes. */
export interface FieldBuffers {
  readonly cols: number;
  readonly rows: number;
  readonly seed: number;
  readonly order: DissolveOrder;
  readonly coarseCols: number;
  readonly coarseRows: number;
  /** Raw field values on the coarse grid, refilled every frame. */
  readonly coarse: Float32Array;
  /** Per column: coarse index and interpolation weight. */
  readonly columnIndex: Uint16Array;
  readonly columnWeight: Float32Array;
  /** Per cell: dissolve threshold and spark hash, fixed for the field's lifetime. */
  readonly thresholds: Float32Array;
  readonly sparks: Float32Array;
  /** Output palette indices, one per cell. */
  readonly levels: Uint8Array;
}

export function createFieldBuffers(
  cols: number,
  rows: number,
  seed: number,
  order: DissolveOrder = "scatter",
): FieldBuffers {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const coarseCols = Math.ceil(c / COARSE_STEP) + 2;
  const coarseRows = Math.ceil(r / COARSE_STEP) + 2;
  const columnIndex = new Uint16Array(c);
  const columnWeight = new Float32Array(c);
  for (let x = 0; x < c; x++) {
    const g = x / COARSE_STEP;
    columnIndex[x] = Math.floor(g);
    columnWeight[x] = g - Math.floor(g);
  }
  const thresholds = new Float32Array(c * r);
  const sparks = new Float32Array(c * r);
  const blobs = createValueNoise3(seed ^ 0x2545f491);
  for (let y = 0; y < r; y++) {
    for (let x = 0; x < c; x++) {
      // Value noise bunches near 0.5; stretching it keeps the dissolve's pace even.
      const blob = Math.min(1, Math.max(0, (blobs(x / 14, y / 14, 0.5) - 0.5) * 1.8 + 0.5));
      thresholds[y * c + x] = dissolveThreshold(x, y, c, r, seed, order, blob);
      sparks[y * c + x] = hash01(x, y, seed + 7919);
    }
  }
  return {
    cols: c,
    rows: r,
    seed,
    order,
    coarseCols,
    coarseRows,
    coarse: new Float32Array(coarseCols * coarseRows),
    columnIndex,
    columnWeight,
    thresholds,
    sparks,
    levels: new Uint8Array(c * r),
  };
}

/** Fills the coarse grid with the field at `time`. `cellPx` is the CSS size of one cell. */
export function sampleField(buffers: FieldBuffers, noise: Noise3, cellPx: number, time: number) {
  const unit = (COARSE_STEP * cellPx) / FEATURE_PX;
  const { coarse, coarseCols, coarseRows } = buffers;
  for (let gy = 0; gy < coarseRows; gy++) {
    for (let gx = 0; gx < coarseCols; gx++) {
      coarse[gy * coarseCols + gx] = fieldValue(noise, gx * unit, gy * unit, time);
    }
  }
}

export interface FrameSettings {
  /** Grey levels including black, 2 to 4. */
  readonly levels: number;
  readonly density: number;
  /** Probability that a peak cell lights up in volt, 0 to 1. */
  readonly accent: number;
  /** 0 is all noise, 1 is all target. */
  readonly progress: number;
  /** Luminance of the target per cell, 0..1, or null for no target. */
  readonly target: Float32Array | null;
  /** How much the live field textures a resolved target, 0 (flat) to 1. */
  readonly texture: number;
  /** Whether resolved target cells may light up in volt too (at a fifth of the accent). */
  readonly targetSparks: boolean;
  readonly lens: DitherLens | null;
  /** An ellipse, in cell units, where the field thins out to black so text over it stays clear. */
  readonly clearing?: DitherClearing | null;
}

/** An elliptical clearing in cell units: centre and radii. */
export interface DitherClearing {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

/**
 * How much of the field survives at a squared normalised distance from a clearing's centre: none in
 * the middle, all of it at the rim, thinning a pixel at a time in between.
 */
export function clearingKeep(d2: number): number {
  if (d2 >= 1) return 1;
  const t = Math.max(0, (d2 - 0.12) / 0.88);
  return t * t * (3 - 2 * t);
}

/** Writes one palette index per cell into `buffers.levels`, from the sampled coarse grid. */
export function renderLevels(buffers: FieldBuffers, settings: FrameSettings): Uint8Array {
  const { cols, rows, coarse, coarseCols, columnIndex, columnWeight, thresholds, sparks, levels } =
    buffers;
  const top = Math.max(1, Math.min(254, Math.floor(settings.levels) - 1));
  const low = fieldFloor(settings.density);
  const accent = Math.min(1, Math.max(0, settings.accent));
  const targetAccent = settings.targetSparks ? accent * 0.2 : -1;
  const progress = Math.min(1, Math.max(0, settings.progress));
  const target =
    settings.target && settings.target.length >= cols * rows && progress > 0
      ? settings.target
      : null;
  const texture = Math.min(1, Math.max(0, settings.texture));
  const lens = settings.lens && settings.lens.strength > 0 ? settings.lens : null;
  const lensR2 = lens ? lens.radius * lens.radius : 0;
  const clearing =
    settings.clearing && settings.clearing.rx > 0 && settings.clearing.ry > 0
      ? settings.clearing
      : null;
  for (let y = 0; y < rows; y++) {
    const gy = y / COARSE_STEP;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    const rowA = y0 * coarseCols;
    const rowB = rowA + coarseCols;
    const ty = (y & 7) << 3;
    const cy = clearing ? (y - clearing.y) / clearing.ry : 0;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const x0 = columnIndex[x] ?? 0;
      const fx = columnWeight[x] ?? 0;
      const a = coarse[rowA + x0] ?? 0;
      const b = coarse[rowA + x0 + 1] ?? 0;
      const c = coarse[rowB + x0] ?? 0;
      const d = coarse[rowB + x0 + 1] ?? 0;
      const upper = a + (b - a) * fx;
      const raw = upper + (c + (d - c) * fx - upper) * fy;

      let base = Math.min(1, Math.max(0, (raw - low) / RAMP));
      base = terrace(base * base * (3 - 2 * base));
      if (clearing) {
        const cx = (x - clearing.x) / clearing.rx;
        base *= clearingKeep(cx * cx + cy * cy);
      }
      let s = base;
      if (lens) {
        const dx = x - lens.x;
        const dy = y - lens.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < lensR2) {
          const k = 1 - Math.sqrt(d2) / lens.radius;
          const pull = k * k * lens.strength;
          // The lens develops what lies under the black: a lower floor and more contrast.
          let lifted = Math.min(1, Math.max(0, (raw - (low - 0.16 * pull)) / RAMP));
          lifted = terrace(lifted * lifted * (3 - 2 * lifted));
          s = Math.min(1, Math.max(0, 0.5 + (lifted - 0.5) * (1 + 0.6 * pull)));
        }
      }

      // Volt comes from the field's own peaks, never from the lens.
      let spark = base > PEAK && (sparks[i] ?? 1) < accent;
      if (target) {
        const threshold = thresholds[i] ?? 0;
        if (progress > threshold) {
          const lum = target[i] ?? 0;
          const grain = Math.min(1, Math.max(0, (raw - 0.2) / 0.6));
          s = lum * (1 - texture * (1 - grain));
          if (progress - threshold < FRONT && progress < 1) s = Math.min(1, s + 0.3);
          spark = s > PEAK && (sparks[i] ?? 1) < targetAccent;
        }
      }

      if (spark) {
        levels[i] = VOLT;
        continue;
      }
      const threshold = THRESHOLDS[ty | (x & 7)] ?? 0.5;
      if (!(s > 0)) {
        levels[i] = 0;
      } else if (s >= 1) {
        levels[i] = top;
      } else {
        const scaled = s * top;
        const base = Math.floor(scaled);
        levels[i] = base + (scaled - base > threshold ? 1 : 0);
      }
    }
  }
  return levels;
}

export interface DitherFrameOptions {
  readonly cols: number;
  readonly rows: number;
  /** CSS px per cell, which sets how large the noise forms are. Default 4. */
  readonly cellPx?: number;
  readonly seed?: number;
  /** Seconds since the field started. Default 0. */
  readonly time?: number;
  readonly levels?: number;
  readonly density?: number;
  readonly accent?: number;
  readonly progress?: number;
  readonly target?: Float32Array | null;
  readonly texture?: number;
  readonly order?: DissolveOrder;
  readonly clearing?: DitherClearing | null;
}

/** Renders one frame from scratch: for tests and for writing the static fallback image. */
export function renderDitherFrame(options: DitherFrameOptions): Uint8Array {
  const seed = options.seed ?? DEFAULT_SEED;
  const buffers = createFieldBuffers(options.cols, options.rows, seed, options.order ?? "scatter");
  sampleField(buffers, createValueNoise3(seed), options.cellPx ?? 4, options.time ?? 0);
  return renderLevels(buffers, {
    levels: options.levels ?? 4,
    density: options.density ?? 0.5,
    accent: options.accent ?? DEFAULT_ACCENT,
    progress: options.progress ?? 0,
    target: options.target ?? null,
    texture: options.texture ?? 0,
    targetSparks: false,
    lens: null,
    clearing: options.clearing ?? null,
  });
}

/** The seed every field uses unless told otherwise, so the first frame is the same everywhere. */
export const DEFAULT_SEED = 0x6a09e667;

/** Default chance that a peak cell is volt: a few dozen lit pixels across a hero. */
export const DEFAULT_ACCENT = 0.02;

/** Luminance (Rec. 709, on sRGB values) of RGBA pixels, one float per pixel. */
export function luminanceOf(rgba: Uint8ClampedArray, out?: Float32Array): Float32Array {
  const count = Math.floor(rgba.length / 4);
  const result = out && out.length >= count ? out : new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const alpha = (rgba[i * 4 + 3] ?? 0) / 255;
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    result[i] = ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * alpha;
  }
  return result;
}

/**
 * Rasterises a grid of "#" and "." rows (a pixel mark) into per-cell luminance, centred, each grid
 * pixel `scale` cells wide. Crisp at any size because it never resamples.
 */
export function gridTarget(
  rowsOfGrid: readonly string[],
  cols: number,
  rows: number,
  scale: number,
): Float32Array {
  const out = new Float32Array(cols * rows);
  const gridRows = rowsOfGrid.length;
  const gridCols = Math.max(0, ...rowsOfGrid.map((row) => row.length));
  const s = Math.max(1, Math.floor(scale));
  const left = Math.floor((cols - gridCols * s) / 2);
  const topRow = Math.floor((rows - gridRows * s) / 2);
  for (let gy = 0; gy < gridRows; gy++) {
    const line = rowsOfGrid[gy] ?? "";
    for (let gx = 0; gx < gridCols; gx++) {
      if (line[gx] !== "#") continue;
      for (let dy = 0; dy < s; dy++) {
        const y = topRow + gy * s + dy;
        if (y < 0 || y >= rows) continue;
        for (let dx = 0; dx < s; dx++) {
          const x = left + gx * s + dx;
          if (x >= 0 && x < cols) out[y * cols + x] = 1;
        }
      }
    }
  }
  return out;
}
