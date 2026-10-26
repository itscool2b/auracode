import type { AgentBrand } from "../brand";

/**
 * Layout and motion data for AuraField, kept free of React so it can be checked in tests: blob
 * loops stay within 20-40s, and their keyframes only ever touch `transform` (the compositor-only
 * property; blur stays constant, so no frame ever re-rasterises a blurred layer).
 */

/** How strongly the field glows. "alert" is the waiting-for-approval amber. */
export type AuraIntensity = "calm" | "active" | "alert";

export interface AuraLevel {
  /** Opacity of the brand layers. */
  readonly opacity: number;
  /** Scale of the brand layers: "active" swells slightly. */
  readonly scale: number;
  /** Opacity of the amber alert layer. */
  readonly alert: number;
}

export const AURA_INTENSITY: Readonly<Record<AuraIntensity, AuraLevel>> = {
  calm: { opacity: 0.55, scale: 1, alert: 0 },
  active: { opacity: 0.9, scale: 1.08, alert: 0 },
  // The brand dims so the amber reads as the dominant colour without the field going dark.
  alert: { opacity: 0.45, scale: 1.04, alert: 0.85 },
};

/** The level for `intensity`; unknown values (from untyped callers) are calm. */
export function auraLevel(intensity: AuraIntensity): AuraLevel {
  return Object.hasOwn(AURA_INTENSITY, intensity) ? AURA_INTENSITY[intensity] : AURA_INTENSITY.calm;
}

/** One Web Animations keyframe. Only transform moves; easing applies to the segment it starts. */
export type AuraKeyframe = { readonly transform: string; readonly easing: string };

export interface AuraBlob {
  readonly key: string;
  /** Any CSS colour: a brand hex or a token like `var(--aura-warning)`. */
  readonly color: string;
  /** Diameter in vmax, so the field scales with the window rather than its own box. */
  readonly size: number;
  /** Centre, as a percentage of the field. */
  readonly x: number;
  readonly y: number;
  readonly opacity: number;
  /** One full drift loop, ms. */
  readonly durationMs: number;
  /** How far into its loop the blob starts, so blobs never move in lockstep. */
  readonly phaseMs: number;
  readonly keyframes: readonly AuraKeyframe[];
}

/** A closed path for one blob: two waypoints of [dx %, dy %, scale], returning home each loop. */
type DriftPath = readonly [readonly [number, number, number], readonly [number, number, number]];

interface BlobLayout {
  readonly key: string;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly opacity: number;
  readonly durationMs: number;
  readonly phase: number;
  readonly path: DriftPath;
}

/*
 * Four blobs: a deep tone anchoring the bottom, the mid tone and the glow at the top corners, and a
 * faint highlight near the centre. Loop lengths are deliberately unrelated so the composition never
 * visibly repeats.
 */
const LAYOUT: Readonly<Record<"deep" | "mid" | "glow" | "highlight", BlobLayout>> = {
  deep: {
    key: "deep",
    size: 70,
    x: 60,
    y: 92,
    opacity: 0.6,
    durationMs: 23_000,
    phase: 0.35,
    path: [
      [4, -6, 1.05],
      [-6, -2, 0.97],
    ],
  },
  mid: {
    key: "mid",
    size: 62,
    x: 18,
    y: 22,
    opacity: 0.55,
    durationMs: 31_000,
    phase: 0.15,
    path: [
      [6, 4, 1.06],
      [-3, 7, 0.96],
    ],
  },
  glow: {
    key: "glow",
    size: 54,
    x: 84,
    y: 30,
    opacity: 0.42,
    durationMs: 37_000,
    phase: 0.55,
    path: [
      [-5, 5, 1.04],
      [-8, -3, 1.08],
    ],
  },
  highlight: {
    key: "highlight",
    size: 30,
    x: 42,
    y: 48,
    opacity: 0.16,
    durationMs: 29_000,
    phase: 0.8,
    path: [
      [7, -5, 1.1],
      [-4, 6, 0.94],
    ],
  },
};

const ALERT_LAYOUT: readonly BlobLayout[] = [
  {
    key: "alert-low",
    size: 58,
    x: 30,
    y: 80,
    opacity: 0.5,
    durationMs: 27_000,
    phase: 0.3,
    path: [
      [5, -4, 1.05],
      [-4, -7, 0.98],
    ],
  },
  {
    key: "alert-high",
    size: 46,
    x: 76,
    y: 18,
    opacity: 0.38,
    durationMs: 33_000,
    phase: 0.65,
    path: [
      [-6, 4, 1.06],
      [3, 6, 0.95],
    ],
  },
];

function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

function transformAt(dx: number, dy: number, scale: number): string {
  return `translate3d(${fmt(dx)}%, ${fmt(dy)}%, 0) scale(${fmt(scale)})`;
}

const MAX_DRIFT_LEAN = 8;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function toBlob(layout: BlobLayout, color: string, leanX: number, leanY: number): AuraBlob {
  const [first, second] = layout.path;
  const home = transformAt(0, 0, 1);
  return {
    key: layout.key,
    color,
    size: layout.size,
    x: layout.x,
    y: layout.y,
    opacity: layout.opacity,
    durationMs: layout.durationMs,
    phaseMs: Math.round(layout.durationMs * layout.phase),
    keyframes: [
      { transform: home, easing: "ease-in-out" },
      {
        transform: transformAt(first[0] + leanX, first[1] + leanY, first[2]),
        easing: "ease-in-out",
      },
      {
        transform: transformAt(second[0] + leanX, second[1] + leanY, second[2]),
        easing: "ease-in-out",
      },
      { transform: home, easing: "ease-in-out" },
    ],
  };
}

/**
 * The four light blobs for `brand`. Each loop leans toward the brand's drift direction, so
 * Antigravity's field rises and Hermes' sweeps sideways, like their orbs.
 */
export function auraBlobs(brand: AgentBrand): readonly AuraBlob[] {
  // Drift is y-up in orb space; CSS translate is y-down.
  const leanX = clamp(brand.motion.drift[0] * 30, MAX_DRIFT_LEAN);
  const leanY = clamp(-brand.motion.drift[1] * 30, MAX_DRIFT_LEAN);
  return [
    toBlob(LAYOUT.deep, brand.palette[1], leanX, leanY),
    toBlob(LAYOUT.mid, brand.palette[2], leanX, leanY),
    toBlob(LAYOUT.glow, brand.glow, leanX, leanY),
    toBlob(LAYOUT.highlight, brand.palette[3], leanX, leanY),
  ];
}

/** The amber blobs of the alert layer, in the warning token's colour. */
export const ALERT_BLOBS: readonly AuraBlob[] = ALERT_LAYOUT.map((layout) =>
  toBlob(layout, "var(--aura-warning)", 0, 0),
);
