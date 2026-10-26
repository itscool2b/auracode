/**
 * Small sRGB helpers shared by the brand table, the orb renderer, and the CSS poster fallback.
 * Brand colours are authored as `#rrggbb` so they paste straight from a design tool; the renderer
 * needs them as 0..1 floats.
 */

/** An sRGB colour as 0..1 floats. */
export type Rgb = readonly [number, number, number];

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Mid grey: what a malformed colour renders as, so a typo dims an orb instead of crashing a frame. */
export const FALLBACK_RGB: Rgb = [0.5, 0.5, 0.5];

/** Parses `#rgb` or `#rrggbb` (the `#` is optional). Returns null for anything else. */
export function parseHexColor(input: string): Rgb | null {
  if (typeof input !== "string") return null;
  const match = HEX_COLOR.exec(input.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const full =
    digits.length === 3
      ? `${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
      : digits;
  const value = Number.parseInt(full, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Like parseHexColor, but never fails: malformed input yields `fallback`. */
export function hexToRgb(input: string, fallback: Rgb = FALLBACK_RGB): Rgb {
  return parseHexColor(input) ?? fallback;
}

function channelToHex(value: number): string {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
}

/** Formats 0..1 floats as lowercase `#rrggbb`, clamping out-of-range channels. */
export function rgbToHex(rgb: Rgb): string {
  return `#${channelToHex(rgb[0])}${channelToHex(rgb[1])}${channelToHex(rgb[2])}`;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Linear blend from `a` (t = 0) to `b` (t = 1) in sRGB space; t is clamped to 0..1. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** mixRgb for hex strings. */
export function mixHex(a: string, b: string, t: number): string {
  return rgbToHex(mixRgb(hexToRgb(a), hexToRgb(b), t));
}
