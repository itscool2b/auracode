/**
 * The Graphite values code needs as numbers or hex strings: build steps rasterise brand images from
 * them (the website social card), and contrast is checked in tests. tokens.css is the source of
 * truth for styling; tokens.test.ts fails if the two drift.
 */

/** Solid colours, as lowercase `#rrggbb`, named after their `--g-*` custom property. */
export const GRAPHITE_COLORS = {
  bg: "#101112",
  "surface-1": "#141516",
  "surface-2": "#1c1d1f",
  "surface-3": "#202226",
  "surface-4": "#292b2f",
  "line-faint": "#25272a",
  line: "#303236",
  "line-strong": "#666a70",
  "fg-1": "#fafafa",
  "fg-2": "#a1a1aa",
  "fg-3": "#9b9ba4",
  "fg-4": "#666a70",
  "on-light": "#18181b",
  primary: "#fafafa",
  "primary-hover": "#e4e4e7",
  "primary-active": "#d4d4d8",
  volt: "#d4d4d8",
  green: "#3dd68c",
  red: "#ff5c5c",
  "red-hover": "#ff7a7a",
  "diff-hunk": "#111111",
  selection: "#292b2f",
  focus: "#d4d4d8",
  "code-fg": "#d4d4d4",
  "code-bright": "#ededed",
  "code-dim": "#858585",
  "code-keyword": "#ff8f8f",
  "code-string": "#8fb8ff",
  "code-number": "#c7a6ff",
  "code-function": "#ededed",
  "ansi-black": "#4d4d4d",
  "ansi-red": "#ff6b6b",
  "ansi-green": "#3dd68c",
  "ansi-yellow": "#e6cc6e",
  "ansi-blue": "#7aa7ff",
  "ansi-magenta": "#d69cff",
  "ansi-cyan": "#5cd6d6",
  "ansi-white": "#d4d4d4",
  "ansi-bright-black": "#858585",
  "ansi-bright-red": "#ff8f8f",
  "ansi-bright-green": "#6ee7a8",
  "ansi-bright-yellow": "#f2dc8c",
  "ansi-bright-blue": "#a3c2ff",
  "ansi-bright-magenta": "#e4bdff",
  "ansi-bright-cyan": "#8ae6e6",
  "ansi-bright-white": "#ededed",
  "project-slate": "#8a98a6",
  "project-sand": "#a59e92",
  "project-sage": "#8c9c88",
  "project-clay": "#a88e80",
  "water-surface": "#1e1e1e",
  "water-shallow": "#161616",
  "water-mid": "#0d0d0d",
  "water-low": "#080808",
  "water-deep": "#050505",
  "shade-near": "#080808",
  "shade-far": "#121212",
  hover: "#202226",
  selected: "#292b2f",
  outline: "#666a70",
  overlay: "#1c1d1f",
  warning: "#e6cc6e",
  "warning-tint": "#2a2517",
  "green-tint": "#14251b",
  "red-tint": "#2d191d",
  "on-danger": "#18181b",
  "code-bg": "#141516",
  "terminal-bg": "#141516",
  "terminal-fg": "#d4d4d4",
  "terminal-cursor": "#fafafa",
  "terminal-cursor-text": "#141516",
  "terminal-selection": "#333333",
} as const;

/** Light counterpart, with the same semantic keys. */
export const GRAPHITE_LIGHT_COLORS = {
  bg: "#fafafa",
  "surface-1": "#ffffff",
  "surface-2": "#f4f4f5",
  "surface-3": "#f0f0f2",
  "surface-4": "#e8e8eb",
  "line-faint": "#ececef",
  line: "#e4e4e7",
  "line-strong": "#8b8d94",
  "fg-1": "#18181b",
  "fg-2": "#52525b",
  "fg-3": "#63636d",
  "fg-4": "#8b8d94",
  "on-light": "#fafafa",
  primary: "#18181b",
  "primary-hover": "#303036",
  "primary-active": "#09090b",
  volt: "#3f3f46",
  green: "#166534",
  red: "#b91c1c",
  "red-hover": "#991b1b",
  "diff-hunk": "#f4f4f5",
  selection: "#dde2ea",
  focus: "#71717a",
  "code-fg": "#24292f",
  "code-bright": "#18181b",
  "code-dim": "#63636d",
  "code-keyword": "#b42318",
  "code-string": "#0550ae",
  "code-number": "#6b21a8",
  "code-function": "#18181b",
  "ansi-black": "#24292f",
  "ansi-red": "#b42318",
  "ansi-green": "#166534",
  "ansi-yellow": "#7a5200",
  "ansi-blue": "#1d4ed8",
  "ansi-magenta": "#7e22ce",
  "ansi-cyan": "#0e6d79",
  "ansi-white": "#52525b",
  "ansi-bright-black": "#63636d",
  "ansi-bright-red": "#991b1b",
  "ansi-bright-green": "#14532d",
  "ansi-bright-yellow": "#854d0e",
  "ansi-bright-blue": "#1e40af",
  "ansi-bright-magenta": "#6b21a8",
  "ansi-bright-cyan": "#155e75",
  "ansi-bright-white": "#18181b",
  "project-slate": "#8a98a6",
  "project-sand": "#a59e92",
  "project-sage": "#8c9c88",
  "project-clay": "#a88e80",
  "water-surface": "#ffffff",
  "water-shallow": "#fafafa",
  "water-mid": "#f4f4f5",
  "water-low": "#f4f4f5",
  "water-deep": "#ececef",
  "shade-near": "#e4e4e7",
  "shade-far": "#f0f0f2",
  hover: "#f0f0f2",
  selected: "#e8e8eb",
  outline: "#8b8d94",
  overlay: "#ffffff",
  warning: "#92400e",
  "warning-tint": "#fff7e6",
  "green-tint": "#edf7ef",
  "red-tint": "#fef0f0",
  "on-danger": "#fafafa",
  "code-bg": "#f4f4f5",
  "terminal-bg": "#f4f4f5",
  "terminal-fg": "#24292f",
  "terminal-cursor": "#18181b",
  "terminal-cursor-text": "#f4f4f5",
  "terminal-selection": "#dde2ea",
} as const;

export const GRAPHITE_THEMES = { dark: GRAPHITE_COLORS, light: GRAPHITE_LIGHT_COLORS } as const;

export type GraphiteColor = keyof typeof GRAPHITE_COLORS;

/** Durations in ms, mirroring `--g-dur-*` (authored; see docs/design/visual-language.md). */
export const GRAPHITE_DURATIONS = {
  micro: 80,
  fast: 120,
  base: 160,
  letter: 250,
  panel: 180,
  settle: 120,
  row: 240,
  dim: 120,
  step: 180,
  headline: 240,
  reveal: 240,
  count: 240,
  tick: 1100,
  shimmer: 1400,
  glint: 3000,
  cycle: 3000,
  timer: 7500,
  exit: 120,
} as const;

/** Staggers in ms, mirroring `--g-stagger*`. */
export const GRAPHITE_STAGGERS = { word: 0, letter: 0, row: 0 } as const;

/** Cubic-bezier control points, mirroring `--g-ease*`. */
export const GRAPHITE_EASINGS = {
  ease: [0.2, 0, 0, 1],
  out: [0.2, 0, 0, 1],
  quint: [0.2, 0, 0, 1],
  smooth: [0.2, 0, 0, 1],
  settle: [0.2, 0, 0, 1],
  soft: [0.2, 0, 0, 1],
  step: [0.2, 0, 0, 1],
  "in-out": [0.2, 0, 0, 1],
  reveal: [0.2, 0, 0, 1],
  in: [0.2, 0, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

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
