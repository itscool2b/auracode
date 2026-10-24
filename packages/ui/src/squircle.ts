/**
 * Apple-style continuous ("squircle") corners as an SVG path, for `clip-path: path(...)`.
 *
 * WebKit has no `corner-shape`, so both engines draw squircles from the same generated path.
 *
 * Construction, per corner with radius R and smoothing s in [0, 1]:
 * - A plain rounded corner jumps from zero curvature (the edge) to 1/R (the arc) at the tangent
 *   point. That jump is what makes it look "pasted on".
 * - Here the corner starts earlier, p = (1 + s)R from the corner along each edge. The middle of the
 *   corner stays a circular arc of the same circle, but only 90°(1 - s) of it; each end is replaced
 *   by a cubic Bezier.
 * - Each Bezier's first three control points lie on the edge, so it leaves the edge with zero
 *   curvature. Its last leg points along the arc's tangent (G1), and its middle control point is
 *   placed so its end curvature equals 1/R (G2). Curvature therefore ramps smoothly from 0 to 1/R.
 *
 * With phi = 45°·s (the arc angle given up at each end), in a corner-local frame where x runs along
 * the incoming edge (negative before the corner) and y along the outgoing edge:
 *   start (-p, 0) -> C (-p + a, 0) (-(arc + c + d), 0) (-(arc + d), d)
 *   -> arc of radius R to (-d, arc + d)
 *   -> C (0, arc + c + d) (0, p - a) (0, p)
 * where d = R(1 - cos phi), c = R·tan(phi/2)·cos phi, arc = R(cos phi - sin phi),
 * b = 1.5·d² / (R·sin³ phi) from the curvature match, and a = p - arc - c - d - b.
 */

/** Smoothing used when none is given; close to iOS app icons. */
export const DEFAULT_SMOOTHING = 0.6;

/** Lengths describing one smoothed corner. See the module comment for what each one is. */
export interface CornerGeometry {
  /** Corner radius after clamping. */
  readonly radius: number;
  /** Smoothing actually applied: reduced when the edges are too short for the full amount. */
  readonly smoothing: number;
  /** Distance from the corner along each edge where the corner begins. */
  readonly p: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  /** Per-axis extent of the circular arc's chord. */
  readonly arc: number;
}

const EPSILON = 1e-9;

/**
 * Geometry of one corner whose radius and smoothing must fit in `budget`, the length of edge
 * available to it (half the shorter side). Smoothing is given up before radius: a corner whose
 * radius already fills its budget becomes a plain circular arc, which is what makes pills round.
 */
export function cornerGeometry(radius: number, smoothing: number, budget: number): CornerGeometry {
  const room = Number.isFinite(budget) && budget > 0 ? budget : 0;
  // An infinite radius means "as round as possible" (like border-radius: 9999px); NaN means none.
  const r = radius > 0 ? Math.min(radius, room) : 0;
  if (r <= EPSILON) return { radius: 0, smoothing: 0, p: 0, a: 0, b: 0, c: 0, d: 0, arc: 0 };

  const requested = Number.isFinite(smoothing) ? Math.min(1, Math.max(0, smoothing)) : 0;
  const s = Math.max(0, Math.min(requested, room / r - 1));
  const p = (1 + s) * r;
  const phi = (Math.PI / 4) * s;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const arc = r * (cosPhi - sinPhi);

  if (phi <= EPSILON) return { radius: r, smoothing: 0, p, a: 0, b: 0, c: 0, d: 0, arc };

  const d = r * (1 - cosPhi);
  const c = r * Math.tan(phi / 2) * cosPhi;
  const b = (1.5 * d * d) / (r * sinPhi * sinPhi * sinPhi);
  const a = p - arc - c - d - b;
  return { radius: r, smoothing: s, p, a, b, c, d, arc };
}

/** Two decimals is a hundredth of a CSS px: invisible, and keeps the path string short. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

function sanitizeSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function rectPath(width: number, height: number): string {
  return `M0 0H${fmt(width)}V${fmt(height)}H0Z`;
}

/*
 * Corners in clockwise order (screen coordinates, y down). Each is [kx, ky, e1x, e1y, e2x, e2y]:
 * the corner point K, the direction of travel along the incoming edge e1, and along the outgoing
 * edge e2. A local point (x, y) maps to K + x·e1 + y·e2.
 */
const TOP_RIGHT = [1, 0, 1, 0, 0, 1] as const;
const BOTTOM_RIGHT = [1, 1, 0, 1, -1, 0] as const;
const BOTTOM_LEFT = [0, 1, -1, 0, 0, -1] as const;
const TOP_LEFT = [0, 0, 0, -1, 1, 0] as const;

type Corner = typeof TOP_RIGHT | typeof BOTTOM_RIGHT | typeof BOTTOM_LEFT | typeof TOP_LEFT;

function cornerSegment(corner: Corner, width: number, height: number, g: CornerGeometry): string {
  const [kx, ky, e1x, e1y, e2x, e2y] = corner;
  const ox = kx * width;
  const oy = ky * height;
  const pt = (x: number, y: number): string =>
    `${fmt(ox + x * e1x + y * e2x)} ${fmt(oy + x * e1y + y * e2y)}`;

  const { p, a, c, d, arc, radius } = g;
  const arcTo = `A${fmt(radius)} ${fmt(radius)} 0 0 1 `;
  // Without smoothing both transition curves collapse to points: a plain rounded corner.
  if (g.smoothing === 0) return `L${pt(-p, 0)}${arcTo}${pt(0, p)}`;

  const inner = arc + c + d;
  let out = `L${pt(-p, 0)}`;
  out += `C${pt(-p + a, 0)} ${pt(-inner, 0)} ${pt(-(arc + d), d)}`;
  // Fully smoothed corners have no arc left; an arc between identical points would be a no-op.
  if (arc > EPSILON) out += `${arcTo}${pt(-d, arc + d)}`;
  out += `C${pt(0, inner)} ${pt(0, p - a)} ${pt(0, p)}`;
  return out;
}

/**
 * An SVG path outlining a `width` x `height` box with continuous corners, starting at the top edge
 * and running clockwise. The radius is clamped to half the shorter side; smoothing is clamped to
 * 0..1. Zero, negative, or non-finite sizes give a plain rect path (empty when there is no area),
 * as does a zero radius.
 */
export function squirclePath(
  width: number,
  height: number,
  radius: number,
  smoothing: number = DEFAULT_SMOOTHING,
): string {
  const w = sanitizeSize(width);
  const h = sanitizeSize(height);
  if (w === 0 || h === 0) return rectPath(w, h);

  const s = Number.isFinite(smoothing) ? smoothing : DEFAULT_SMOOTHING;
  const g = cornerGeometry(radius, s, Math.min(w, h) / 2);
  if (g.radius === 0) return rectPath(w, h);

  let path = `M${fmt(g.p)} 0`;
  path += cornerSegment(TOP_RIGHT, w, h, g);
  path += cornerSegment(BOTTOM_RIGHT, w, h, g);
  path += cornerSegment(BOTTOM_LEFT, w, h, g);
  path += cornerSegment(TOP_LEFT, w, h, g);
  return `${path}Z`;
}

/** squirclePath wrapped as a CSS `clip-path` value. */
export function squircleClipPath(
  width: number,
  height: number,
  radius: number,
  smoothing: number = DEFAULT_SMOOTHING,
): string {
  return `path("${squirclePath(width, height, radius, smoothing)}")`;
}
