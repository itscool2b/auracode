/**
 * How the seal and turtle silhouettes in creaturePaths.ts are drawn. Not part of the runtime: the
 * constants there are this module's output, and creatures.test.ts fails if they drift. To change
 * a creature, edit its points here and run `node packages/ui/scripts/creature-paths.ts`.
 *
 * Each creature is a body outline plus parts (flippers, head, tail) set off from it by an even gap,
 * the way the logo separates its two animals. A part's root edge follows the body's outline pushed
 * out by the gap, so the gap is exact at any size, and the whole creature is one even-odd path of
 * absolute M, C and Z commands: no masks, no ids, rasterisable by the site's build tools. Outlines
 * are centripetal Catmull-Rom splines through hand-placed points, so every curve is smooth.
 */

export type Point = readonly [number, number];
type Segment = readonly [Point, Point, Point, Point];

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const length = (a: Point) => Math.hypot(a[0], a[1]);

/**
 * Centripetal Catmull-Rom through `points`, as cubic Bezier segments. Open curves extend their ends
 * by reflection, so the first and last tangents point along the first and last chords.
 */
export function spline(points: readonly Point[], closed: boolean): Segment[] {
  const n = points.length;
  const at = (i: number): Point => {
    if (closed) return points[((i % n) + n) % n] as Point;
    if (i < 0) return sub(scale(points[0] as Point, 2), points[1] as Point);
    if (i >= n) return sub(scale(points[n - 1] as Point, 2), points[n - 2] as Point);
    return points[i] as Point;
  };
  const segments: Segment[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const d1 = Math.max(1e-6, Math.sqrt(length(sub(p1, p0))));
    const d2 = Math.max(1e-6, Math.sqrt(length(sub(p2, p1))));
    const d3 = Math.max(1e-6, Math.sqrt(length(sub(p3, p2))));
    // Tangents of the centripetal parameterisation (Yuksel et al.), scaled to the middle chord.
    const m1 = scale(
      add(
        sub(scale(sub(p1, p0), 1 / d1), scale(sub(p2, p0), 1 / (d1 + d2))),
        scale(sub(p2, p1), 1 / d2),
      ),
      d2,
    );
    const m2 = scale(
      add(
        sub(scale(sub(p2, p1), 1 / d2), scale(sub(p3, p1), 1 / (d2 + d3))),
        scale(sub(p3, p2), 1 / d3),
      ),
      d2,
    );
    segments.push([p1, add(p1, scale(m1, 1 / 3)), sub(p2, scale(m2, 1 / 3)), p2]);
  }
  return segments;
}

function bezier(s: Segment, t: number): Point {
  const u = 1 - t;
  const [a, b, c, d] = s;
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ];
}

/** Points along segments, `steps` per segment, without repeating shared ends. */
export function sample(segments: readonly Segment[], steps = 24): Point[] {
  const out: Point[] = [];
  for (const s of segments) for (let k = 0; k < steps; k++) out.push(bezier(s, k / steps));
  const last = segments[segments.length - 1];
  if (last) out.push(last[3]);
  return out;
}

/** Twice the signed area: positive when the polygon runs clockwise on screen (y down). */
function signedArea(polygon: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area;
}

function nearest(polyline: readonly Point[], target: Point): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  polyline.forEach((p, i) => {
    const d = length(sub(p, target));
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}

/**
 * The shorter stretch of a closed outline between the points nearest `from` and `to`, pushed
 * outward by `gap`: the root edge of a part.
 */
function rootEdge(outline: readonly Point[], from: Point, to: Point, gap: number): Point[] {
  const ring = outline.slice(0, -1);
  const n = ring.length;
  const clockwise = signedArea(ring) > 0;
  const i = nearest(ring, from);
  const j = nearest(ring, to);
  // Walk the shorter way round, whichever direction that is.
  const forward = (j - i + n) % n;
  const step = forward <= n - forward ? 1 : -1;
  const out: Point[] = [];
  for (let k = i; ; k = (k + step + n) % n) {
    const prev = ring[(k - 1 + n) % n] as Point;
    const next = ring[(k + 1) % n] as Point;
    const tangent = sub(next, prev);
    const unit = scale(tangent, 1 / Math.max(1e-9, length(tangent)));
    // Clockwise on screen, the outward normal is the tangent turned a quarter anticlockwise.
    const normal: Point = clockwise ? [unit[1], -unit[0]] : [-unit[1], unit[0]];
    out.push(add(ring[k] as Point, scale(normal, gap)));
    if (k === j) break;
  }
  return out;
}

/** Every `step`-th point and the last, so a root edge is a handful of spline points. */
function thin(points: readonly Point[], step: number): Point[] {
  const out = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1] as Point;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

const fmt = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};

function toPath(segments: readonly Segment[]): string {
  const first = segments[0];
  if (!first) return "";
  let d = `M${fmt(first[0][0])} ${fmt(first[0][1])}`;
  for (const [, b, c, e] of segments)
    d += `C${fmt(b[0])} ${fmt(b[1])} ${fmt(c[0])} ${fmt(c[1])} ${fmt(e[0])} ${fmt(e[1])}`;
  return `${d}Z`;
}

/** An ellipse as four cubic segments (a hole when it sits inside the body: even-odd). */
function ellipse(cx: number, cy: number, rx: number, ry: number): Segment[] {
  const k = 0.5522847498;
  const p = (x: number, y: number): Point => [cx + x, cy + y];
  return [
    [p(rx, 0), p(rx, ry * k), p(rx * k, ry), p(0, ry)],
    [p(0, ry), p(-rx * k, ry), p(-rx, ry * k), p(-rx, 0)],
    [p(-rx, 0), p(-rx, -ry * k), p(-rx * k, -ry), p(0, -ry)],
    [p(0, -ry), p(rx * k, -ry), p(rx, -ry * k), p(rx, 0)],
  ];
}

/** Whether `p` lies inside `polygon` (even-odd). */
export function inside(polygon: readonly Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point;
    const b = polygon[j] as Point;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}

/** The distance from `p` to the nearest edge of `polygon`. */
export function distance(polygon: readonly Point[], p: Point): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    const ab = sub(b, a);
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) /
          Math.max(1e-9, ab[0] * ab[0] + ab[1] * ab[1]),
      ),
    );
    best = Math.min(best, length(sub(p, add(a, scale(ab, t)))));
  }
  return best;
}

/**
 * A flipper, a head or a tail: a spine from inside the body outward with a width at each spine
 * point, rounded at the end. `notch` dents the end inward by that much, for a hind flipper's
 * trailing edge.
 */
export interface LimbSpec {
  readonly spine: readonly Point[];
  readonly widths: readonly number[];
  readonly notch?: number;
}

/** A limb's outline: one side from root to tip, round the end, and the other side back. */
function limbOutline(limb: LimbSpec): Point[] {
  const segments = spline(limb.spine, false);
  const steps = 6;
  const points = sample(segments, steps);
  const width = (index: number) => {
    const at = index / steps;
    const k = Math.min(limb.widths.length - 2, Math.floor(at));
    const t = at - k;
    return (limb.widths[k] as number) * (1 - t) + (limb.widths[k + 1] as number) * t;
  };
  const left: Point[] = [];
  const right: Point[] = [];
  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)] as Point;
    const next = points[Math.min(points.length - 1, i + 1)] as Point;
    const tangent = sub(next, prev);
    const unit = scale(tangent, 1 / Math.max(1e-9, length(tangent)));
    const normal: Point = [-unit[1], unit[0]];
    const half = width(i) / 2;
    left.push(add(p, scale(normal, half)));
    right.push(sub(p, scale(normal, half)));
  });
  const end = points[points.length - 1] as Point;
  const before = points[points.length - 2] as Point;
  const direction = scale(sub(end, before), 1 / Math.max(1e-9, length(sub(end, before))));
  const tip = width(points.length - 1) / 2;
  const across: Point = [-direction[1], direction[0]];
  // A round end, or a notched one: two rounded corners with the dent between them.
  const cap: Point[] =
    limb.notch === undefined
      ? [add(end, scale(direction, tip))]
      : [
          add(add(end, scale(across, tip * 0.55)), scale(direction, tip * 0.35)),
          add(end, scale(direction, tip * 0.35 - limb.notch)),
          add(sub(end, scale(across, tip * 0.55)), scale(direction, tip * 0.35)),
        ];
  const every = (side: Point[]) => [
    ...side.filter((_, i) => i % 2 === 0 && i < side.length - 1),
    side[side.length - 1] as Point,
  ];
  return [...every(left), ...cap, ...every(right).reverse()];
}

export interface CreatureSpec {
  readonly viewBox: readonly [number, number];
  /** The body outline, either way round. */
  readonly body: readonly Point[];
  readonly limbs: readonly LimbSpec[];
  readonly eye?: {
    readonly cx: number;
    readonly cy: number;
    readonly rx: number;
    readonly ry: number;
  };
}

export interface BuiltCreature {
  readonly path: string;
  /** The body outline and each part's outline as dense polylines, for the geometry tests. */
  readonly body: Point[];
  readonly parts: Point[][];
}

/**
 * One even-odd path: the body, then each limb set off from it by `gap`, then the eye hole. A limb's
 * outline is cut back where it comes within 1.15 gaps of the body, and its root edge is the body's
 * outline between the cut ends, pushed out by exactly `gap`.
 */
export function buildCreature(spec: CreatureSpec, gap: number): BuiltCreature {
  const bodySegments = spline(spec.body, true);
  const body = sample(bodySegments, 48);
  const ring = body.slice(0, -1);
  const parts: Point[][] = [];
  let d = toPath(bodySegments);
  for (const limb of spec.limbs) {
    const outline = limbOutline(limb);
    const clear = (p: Point) => !inside(ring, p) && distance(ring, p) > gap * 1.15;
    let first = 0;
    while (first < outline.length && !clear(outline[first] as Point)) first++;
    let last = outline.length - 1;
    while (last > first && !clear(outline[last] as Point)) last--;
    const free = outline.slice(first, last + 1);
    const root = thin(rootEdge(body, free[free.length - 1] as Point, free[0] as Point, gap), 16);
    const segments = [
      ...spline(root, false),
      ...spline([root[root.length - 1] as Point, ...free, root[0] as Point], false),
    ];
    parts.push(sample(segments, 24));
    d += toPath(segments);
  }
  if (spec.eye) d += toPath(ellipse(spec.eye.cx, spec.eye.cy, spec.eye.rx, spec.eye.ry));
  return { path: d, body, parts };
}

const mirrorY = (points: readonly Point[], axis: number): Point[] =>
  points.map(([x, y]) => [x, 2 * axis - y] as Point);

/*
 * A sea turtle seen from below, heading right (viewBox 240 by 220): a teardrop shell, a head set
 * off at the front, long sickle front flippers swept back as it glides, short paddle rear flippers
 * and a stub of a tail. Symmetric about y = 110.
 */
const TURTLE_AXIS = 110;
const TURTLE_SHELL_TOP: Point[] = [
  [174, 110],
  [170, 92],
  [159, 77],
  [142, 67],
  [120, 63],
  [97, 65],
  [76, 73],
  [59, 86],
  [48, 99],
  [43, 110],
];
const TURTLE_SHELL: Point[] = [
  ...TURTLE_SHELL_TOP,
  ...mirrorY(TURTLE_SHELL_TOP.slice(1, -1).reverse(), TURTLE_AXIS),
];

function turtleSpec(): CreatureSpec {
  const front: LimbSpec = {
    spine: [
      [140, 76],
      [140, 54],
      [131, 35],
      [114, 20],
      [93, 10],
      [72, 6],
    ],
    widths: [30, 31, 28, 21, 12, 4],
  };
  const rear: LimbSpec = {
    spine: [
      [66, 86],
      [52, 74],
      [39, 66],
      [27, 63],
    ],
    widths: [19, 22, 24, 19],
  };
  const mirror = (limb: LimbSpec): LimbSpec => ({
    ...limb,
    spine: mirrorY(limb.spine, TURTLE_AXIS),
  });
  const head: LimbSpec = {
    spine: [
      [160, 110],
      [176, 110],
      [190, 110],
      [201, 110],
      [208, 110],
    ],
    widths: [13, 19, 22, 21, 16],
  };
  const tail: LimbSpec = {
    spine: [
      [52, 110],
      [38, 110],
      [28, 110],
    ],
    widths: [10, 7, 2],
  };
  return {
    viewBox: [240, 220],
    body: TURTLE_SHELL,
    limbs: [head, front, mirror(front), rear, mirror(rear), tail],
  };
}

/*
 * A harbour seal from the side, swimming right (viewBox 320 by 130): a round head with a short
 * muzzle and an eye, a slight dip at the neck, a plump body thickest at the chest and tapering to
 * narrow hips, a fore flipper under the chest, and the two hind flippers held together behind,
 * fanned into a V with a dented trailing edge.
 */
function sealSpec(eyeScale: number): CreatureSpec {
  const body: Point[] = [
    [316, 62],
    [312, 54],
    [302, 48],
    [292, 38],
    [276, 30],
    [258, 31],
    [240, 33.5],
    [216, 32],
    [186, 32],
    [150, 37],
    [116, 46],
    [90, 56],
    [72, 63],
    [63, 71],
    [70, 80],
    [92, 88],
    [130, 97],
    [176, 101],
    [220, 99],
    [250, 90],
    [276, 80],
    [296, 73],
    [310, 69],
    [315, 66],
  ];
  const fore: LimbSpec = {
    spine: [
      [228, 90],
      [222, 106],
      [212, 118],
      [196, 127],
    ],
    widths: [24, 20, 14, 5],
  };
  const hindUpper: LimbSpec = {
    spine: [
      [72, 68],
      [54, 64],
      [36, 57],
      [20, 50],
    ],
    widths: [12, 14, 19, 24],
    notch: 1.5,
  };
  const hindLower: LimbSpec = {
    spine: [
      [72, 76],
      [54, 80],
      [36, 87],
      [20, 94],
    ],
    widths: [12, 14, 19, 24],
    notch: 1.5,
  };
  return {
    viewBox: [320, 130],
    body,
    limbs: [fore, hindUpper, hindLower],
    eye: { cx: 284, cy: 47, rx: 3.6 * eyeScale, ry: 4 * eyeScale },
  };
}

export const SEAL_SPEC = sealSpec(1);
export const SEAL_SMALL_SPEC = sealSpec(1.6);
export const TURTLE_SPEC = turtleSpec();

/** The gaps between body and limbs, in viewBox units, for the full and the small drawings. */
export const CREATURE_GAPS = { seal: 4, sealSmall: 9, turtle: 5, turtleSmall: 10 } as const;

export function buildCreaturePaths() {
  return {
    seal: buildCreature(SEAL_SPEC, CREATURE_GAPS.seal),
    sealSmall: buildCreature(SEAL_SMALL_SPEC, CREATURE_GAPS.sealSmall),
    turtle: buildCreature(TURTLE_SPEC, CREATURE_GAPS.turtle),
    turtleSmall: buildCreature(TURTLE_SPEC, CREATURE_GAPS.turtleSmall),
  };
}
