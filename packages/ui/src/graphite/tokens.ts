/**
 * The Graphite values code needs as numbers or hex strings: the canvas of a DitherField cannot read
 * CSS custom properties per pixel, and contrast is checked in tests. tokens.css is the source of
 * truth for styling; tokens.test.ts fails if the two drift.
 */

/** Solid colours, as lowercase `#rrggbb`, named after their `--g-*` custom property. */
export const GRAPHITE_COLORS = {
  bg: "#000000",
  "surface-1": "#0a0a0a",
  "surface-2": "#111111",
  "surface-3": "#191919",
  "surface-4": "#222222",
  "line-faint": "#141414",
  line: "#1f1f1f",
  "line-strong": "#2e2e2e",
  "fg-1": "#ededed",
  "fg-2": "#a3a3a3",
  "fg-3": "#858585",
  "fg-4": "#4d4d4d",
  "on-light": "#000000",
  primary: "#ededed",
  "primary-hover": "#ffffff",
  "primary-active": "#d6d6d6",
  volt: "#ccff33",
  green: "#3dd68c",
  red: "#ff5c5c",
  "red-hover": "#ff7a7a",
  selection: "#333333",
  "dither-1": "#2e2e2e",
  "dither-2": "#4d4d4d",
  "dither-3": "#858585",
} as const;

export type GraphiteColor = keyof typeof GRAPHITE_COLORS;

/** Durations in ms, mirroring `--g-dur-*` (measured; see docs/design/visual-language.md 3.8). */
export const GRAPHITE_DURATIONS = {
  micro: 100,
  fast: 150,
  base: 200,
  letter: 250,
  panel: 300,
  settle: 300,
  row: 340,
  dim: 500,
  step: 600,
  headline: 650,
  reveal: 800,
  count: 950,
  tick: 1100,
  shimmer: 1400,
  glint: 3000,
  cycle: 3000,
  timer: 7500,
  exit: 120,
} as const;

/** Staggers in ms, mirroring `--g-stagger*`. */
export const GRAPHITE_STAGGERS = { word: 55, letter: 25, row: 70 } as const;

/** Cubic-bezier control points, mirroring `--g-ease*`. */
export const GRAPHITE_EASINGS = {
  ease: [0.4, 0, 0.2, 1],
  out: [0.16, 1, 0.3, 1],
  quint: [0.23, 1, 0.32, 1],
  smooth: [0.32, 0.72, 0, 1],
  settle: [0, 0.7, 0.3, 1],
  soft: [0.3, 0.3, 0.3, 1],
  step: [0.7, 0, 0.7, 0.7],
  "in-out": [0.7, 0, 0.3, 1],
  reveal: [0.22, 1, 0.36, 1],
  in: [0.4, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * Dither palettes: the grey levels painted above black, darkest first. `quiet` sits behind reading
 * content (the desktop intro), `standard` is the website hero, `bright` is for type made of pixels
 * (the footer wordmark), where the top level has to read as ink.
 */
export const DITHER_PALETTES = {
  quiet: ["#191919", "#2e2e2e", "#4d4d4d"],
  standard: ["#2e2e2e", "#4d4d4d", "#858585"],
  bright: ["#4d4d4d", "#a3a3a3", "#ededed"],
} as const satisfies Record<string, readonly string[]>;

export type DitherPaletteName = keyof typeof DITHER_PALETTES;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour; NaN for anything else. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return Number.NaN;
  const n = Number.parseInt(match[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
