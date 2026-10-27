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
  density: 0.5,
  accent: 0.02,
  palette: "standard",
};

/** The stage's clearing at the 1440px desktop layout, used until the copy is measured. */
export const STAGE_CLEARING: FieldClearing = { x: 0.5, y: 0.25, rx: 0.5, ry: 0.27 };

export const STAGE_FALLBACK: FieldFallback = {
  file: "images/dither-stage.png",
  width: 1440,
  height: 1440,
  clearing: STAGE_CLEARING,
};

/** The quiet band behind the closing statement. */
export const CLOSING_FIELD: FieldSettings = {
  cell: 4,
  density: 0.46,
  accent: 0.012,
  palette: "quiet",
};

export const CLOSING_CLEARING: FieldClearing = { x: 0.5, y: 0.5, rx: 0.36, ry: 0.62 };

export const CLOSING_FALLBACK: FieldFallback = {
  file: "images/dither-closing.png",
  width: 1440,
  height: 520,
  clearing: CLOSING_CLEARING,
};

export const FIELD_FALLBACKS: readonly (FieldFallback & { readonly field: FieldSettings })[] = [
  { ...STAGE_FALLBACK, field: STAGE_FIELD },
  { ...CLOSING_FALLBACK, field: CLOSING_FIELD },
];
