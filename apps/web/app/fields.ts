/**
 * Settings for the website's dither fields, shared by the components that draw them live and by the
 * build step that writes their no-JavaScript fallback images (scripts/site-images.ts), so the
 * static frame and the first live frame come from the same numbers.
 */

import type { DitherSprite } from "@auracode/ui/graphite";
import { CLOSING_CREATURES, HERO_CREATURES } from "./creatures.ts";

export interface FieldClearing {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

export interface FieldSettings {
  /** CSS px per dither pixel. */
  readonly cell: number;
  readonly density: number;
  readonly accent: number;
  readonly palette: "quiet" | "standard" | "bright";
  /** Every field has its own seed, so no two fields on a page repeat a pattern. */
  readonly seed: number;
  /** How far the field gathers toward the left and right edges, 0 to 1. */
  readonly edges?: number;
  /** The brightest the field itself gets, so the creatures swimming through it stand out. */
  readonly ceiling?: number;
}

export interface FieldFallback {
  /** Path under the site root, served from build/client. */
  readonly file: string;
  /** Layout the image is rendered for, in CSS px. One image pixel is one cell. */
  readonly width: number;
  readonly height: number;
  readonly clearing: readonly FieldClearing[];
  readonly sprites?: readonly DitherSprite[];
}

/**
 * The hero stage: gathered toward the sides, calm behind the copy and along the product frame's
 * top edge, its brightest areas dithered rather than solid so the creatures read against it.
 */
export const STAGE_FIELD: FieldSettings = {
  cell: 4,
  density: 0.4,
  accent: 0.006,
  palette: "standard",
  seed: 0x5be0cd19,
  edges: 0.5,
  ceiling: 0.78,
};

/** The product frame's field, which dissolves into the screenshot. */
export const FRAME_FIELD: FieldSettings = {
  cell: 4,
  density: 0.48,
  accent: 0.008,
  palette: "standard",
  seed: 0xbb67ae85,
};

/**
 * The stage's clearings at the 1440px desktop layout, used until the copy is measured: one around
 * the headline, lead and button, one along the product frame's top edge and one that fades the
 * field out toward the stage's bottom edge.
 */
export const STAGE_CLEARING: readonly FieldClearing[] = [
  { x: 0.5, y: 0.212, rx: 0.301, ry: 0.205 },
  { x: 0.5, y: 0.436, rx: 0.625, ry: 0.16 },
  { x: 0.5, y: 1, rx: 1, ry: 0.168 },
];

export const STAGE_FALLBACK: FieldFallback = {
  file: "images/dither-stage.png",
  width: 1440,
  height: 1312,
  clearing: STAGE_CLEARING,
  sprites: HERO_CREATURES,
};

/** The dimmed field behind the replayed turn in the film card. */
export const FILM_FIELD: FieldSettings = {
  cell: 4,
  density: 0.62,
  accent: 0,
  palette: "quiet",
  seed: 0xb5c0fbcf,
  ceiling: 0.5,
};

/**
 * The closing panel: a dark field, so its turtle and seal are the brightest things in it, calm
 * behind the statement and thinning toward the panel's top and bottom edges.
 */
export const CLOSING_FIELD: FieldSettings = {
  cell: 4,
  density: 0.5,
  accent: 0.006,
  palette: "standard",
  seed: 0x3c6ef372,
  ceiling: 0.55,
};

export const CLOSING_CLEARING: readonly FieldClearing[] = [
  { x: 0.5, y: 0.5, rx: 0.36, ry: 0.62 },
  { x: 0.5, y: 0, rx: 1, ry: 0.16 },
  { x: 0.5, y: 1, rx: 1, ry: 0.16 },
];

/** On a phone the statement spans the width, so the calm does too. */
export const CLOSING_CLEARING_COMPACT: readonly FieldClearing[] = [
  { x: 0.5, y: 0.5, rx: 0.95, ry: 0.36 },
  { x: 0.5, y: 0, rx: 1, ry: 0.12 },
  { x: 0.5, y: 1, rx: 1, ry: 0.12 },
];

export const CLOSING_FALLBACK: FieldFallback = {
  file: "images/dither-closing.png",
  width: 1120,
  height: 476,
  clearing: CLOSING_CLEARING,
  sprites: CLOSING_CREATURES,
};

/** The giant footer logo, formed from a bright field. */
export const FOOTER_FIELD: FieldSettings = {
  cell: 4,
  density: 0.34,
  accent: 0.02,
  palette: "bright",
  seed: 0xa54ff53a,
};

/**
 * Before it forms, the footer logo's noise gathers in the middle of its box and thins toward the
 * edges, so it never reads as a square. Clearings calm only the noise, never the formed logo.
 */
export const FOOTER_CLEARING: readonly FieldClearing[] = [
  { x: 0, y: 0.5, rx: 0.28, ry: 1.2 },
  { x: 1, y: 0.5, rx: 0.28, ry: 1.2 },
  { x: 0.5, y: 0, rx: 1.2, ry: 0.24 },
];

/** The 404 numerals. */
export const ERROR_FIELD: FieldSettings = {
  cell: 4,
  density: 0.4,
  accent: 0.02,
  palette: "bright",
  seed: 0x510e527f,
};

export const FIELD_FALLBACKS: readonly (FieldFallback & { readonly field: FieldSettings })[] = [
  { ...STAGE_FALLBACK, field: STAGE_FIELD },
  { ...CLOSING_FALLBACK, field: CLOSING_FIELD },
];
