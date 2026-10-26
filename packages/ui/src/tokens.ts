/**
 * Numeric mirrors of tokens.css for code that needs numbers rather than `var(...)`: squircle clip
 * paths are computed in JS, and stacking decisions in JS need the same layer order as CSS.
 * tokens.test.ts fails if these drift from the stylesheet.
 */

/** Corner radii in CSS px, matching `--aura-radius-*`. */
export const radii = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  "2xl": 28,
} as const;

/** Glass elevation levels: 1 is a resting surface, 3 is a floating overlay. */
export type GlassElevation = 1 | 2 | 3;

/** Default corner radius per elevation. Floating things read softer, so they round more. */
export const elevationRadius: Readonly<Record<GlassElevation, number>> = {
  1: radii.md,
  2: radii.lg,
  3: radii.xl,
};

/** Stacking layers, bottom to top, matching `--aura-z-*`. */
export const zIndex = {
  field: 0,
  content: 1,
  sticky: 10,
  sidebar: 20,
  composer: 30,
  dropdown: 100,
  popover: 200,
  modal: 300,
  toast: 400,
  tooltip: 500,
  boot: 1000,
} as const;
