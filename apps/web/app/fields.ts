/**
 * Settings for the website's dither fields, shared by the components that draw them live and by the
 * build step that writes their no-JavaScript fallback images (scripts/dither-fallbacks.ts), so the
 * static frame and the first live frame come from the same numbers.
 */

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
}

export interface FieldFallback {
  /** Path under the site root, served from build/client. */
  readonly file: string;
  /** Layout the image is rendered for, in CSS px. One image pixel is one cell. */
  readonly width: number;
  readonly height: number;
  readonly clearing: FieldClearing;
}

/** The hero stage: bright at the edges, thinned to black behind the headline. */
export const STAGE_FIELD: FieldSettings = {
  cell: 4,
  density: 0.48,
  accent: 0.02,
  palette: "standard",
  seed: 0x6a09e667,
};

/** The product frame's field, which dissolves into the screenshot. */
export const FRAME_FIELD: FieldSettings = {
  cell: 4,
  density: 0.48,
  accent: 0.016,
  palette: "standard",
  seed: 0xbb67ae85,
};

/** The stage's clearing at the 1440px desktop layout, used until the copy is measured. */
export const STAGE_CLEARING: FieldClearing = { x: 0.5, y: 0.27, rx: 0.6, ry: 0.32 };

export const STAGE_FALLBACK: FieldFallback = {
  file: "images/dither-stage.png",
  width: 1440,
  height: 1480,
  clearing: STAGE_CLEARING,
};

/** The quiet band behind the closing statement. */
export const CLOSING_FIELD: FieldSettings = {
  cell: 4,
  density: 0.5,
  accent: 0.012,
  palette: "quiet",
  seed: 0x3c6ef372,
};

export const CLOSING_CLEARING: FieldClearing = { x: 0.5, y: 0.5, rx: 0.4, ry: 0.7 };

export const CLOSING_FALLBACK: FieldFallback = {
  file: "images/dither-closing.png",
  width: 1440,
  height: 560,
  clearing: CLOSING_CLEARING,
};

/** The giant footer wordmark, formed from a bright field. */
export const FOOTER_FIELD: FieldSettings = {
  cell: 4,
  density: 0.34,
  accent: 0.02,
  palette: "bright",
  seed: 0xa54ff53a,
};

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
