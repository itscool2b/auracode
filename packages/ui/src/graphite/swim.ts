/**
 * How a Swimmers creature moves, as pure functions of time, so the motion is testable and the
 * server's first frame equals the browser's (visual language 4.16).
 *
 * A creature cruises one way across its layer at an eased speed (a turtle surges on each stroke and
 * glides between them, a seal swims more evenly), sways gently up and down, pitches a few degrees
 * with its path, and leaves one side fully before it comes back on the other. Every term is a sum
 * of sines started at zero, so velocity is smooth and the pose at t = 0 is exactly the anchor.
 */
import type { CreatureKind } from "./Creature";

export interface SwimmerSpec {
  readonly kind: CreatureKind;
  /** The creature's centre at rest, as fractions of the layer's width and height. */
  readonly x: number;
  readonly y: number;
  /** Width: px, or any CSS length (`clamp(96px, 20vw, 320px)`). */
  readonly size: number | string;
  /** 0 near (darkest, crisp) to 1 far (closer to the water's grey, softened). Default 0. */
  readonly depth?: number;
  /** Which way it swims and faces. Default "right". */
  readonly heading?: "right" | "left";
  /** Cruising speed in px a second. Default 9 for a turtle, 15 for a seal. */
  readonly speed?: number;
  /** Seconds into its own cycle at time 0, so creatures never move in step. Default 0. */
  readonly phase?: number;
  /** Resting tilt in degrees, clockwise. Default 0. */
  readonly tilt?: number;
  /** Extra class on the creature's wrapper, for per-breakpoint rules. */
  readonly className?: string;
}

export interface SwimPose {
  /** Offset from the anchor in px. */
  readonly dx: number;
  readonly dy: number;
  /** Degrees, clockwise. */
  readonly rotate: number;
}

interface Gait {
  /** Stroke period in seconds and how much the speed surges, as a fraction of cruising speed. */
  readonly stroke: number;
  readonly surge: number;
  /** Vertical sway: amplitude in px and period in seconds, plus a slower second wave. */
  readonly sway: number;
  readonly swayPeriod: number;
  readonly drift: number;
  readonly driftPeriod: number;
  /** How much of the path's slope becomes pitch. */
  readonly pitch: number;
  readonly speed: number;
}

export const GAITS: Readonly<Record<CreatureKind, Gait>> = {
  turtle: {
    stroke: 5.6,
    surge: 0.42,
    sway: 7,
    swayPeriod: 17,
    drift: 5,
    driftPeriod: 41,
    pitch: 0.3,
    speed: 9,
  },
  seal: {
    stroke: 3.4,
    surge: 0.18,
    sway: 9,
    swayPeriod: 13,
    drift: 6,
    driftPeriod: 37,
    pitch: 0.3,
    speed: 15,
  },
};

const TAU = Math.PI * 2;

/** sin(wt + p) - sin(p): a sine that starts at zero. */
const wave = (t: number, period: number, phase: number) =>
  Math.sin((TAU * t) / period + phase) - Math.sin(phase);
const waveRate = (t: number, period: number, phase: number) =>
  (TAU / period) * Math.cos((TAU * t) / period + phase);

/** Distance swum after `t` seconds: cruising, with each stroke's surge folded in. */
export function swumDistance(spec: SwimmerSpec, t: number): number {
  const gait = GAITS[spec.kind];
  const speed = spec.speed ?? gait.speed;
  const p = (TAU * (spec.phase ?? 0)) / gait.stroke;
  return speed * (t + ((gait.surge * gait.stroke) / TAU) * wave(t, gait.stroke, p));
}

/**
 * The pose at `t` seconds for a layer `width` by `height` px, with the creature `extent` px wide.
 * Across, it wraps between one full creature width (plus a margin) off each side, so the jump back
 * always happens out of sight.
 */
export function swimPose(spec: SwimmerSpec, t: number, width: number, extent: number): SwimPose {
  const gait = GAITS[spec.kind];
  const speed = spec.speed ?? gait.speed;
  const phase = spec.phase ?? 0;
  const direction = spec.heading === "left" ? -1 : 1;
  const anchor = spec.x * width;
  const margin = extent / 2 + 32;
  const span = width + 2 * margin;
  const travelled = anchor + direction * swumDistance(spec, t);
  const wrapped = ((((travelled + margin) % span) + span) % span) - margin;
  const swayPhase = (TAU * phase) / gait.swayPeriod;
  const driftPhase = (TAU * phase) / gait.driftPeriod + 1.3;
  const dy =
    gait.sway * wave(t, gait.swayPeriod, swayPhase) +
    gait.drift * wave(t, gait.driftPeriod, driftPhase);
  // The slope of the path at cruising speed, so a stroke's surge never jerks the nose; a share of
  // it becomes pitch.
  const vy =
    gait.sway * waveRate(t, gait.swayPeriod, swayPhase) +
    gait.drift * waveRate(t, gait.driftPeriod, driftPhase);
  const slope = (Math.atan2(vy, Math.max(1e-6, speed)) * 180) / Math.PI;
  return {
    dx: wrapped - anchor,
    dy,
    rotate: direction * gait.pitch * slope + (spec.tilt ?? 0),
  };
}

/**
 * How far a creature at (`x`, `y`) gives way to the pointer at (`px`, `py`): a smooth field that
 * is zero under the pointer and far from it and peaks `give` px at `reach` / sqrt(2), so moving the
 * pointer across a creature never flips it from one side to the other.
 */
export function giveWay(
  x: number,
  y: number,
  px: number,
  py: number,
  reach = 200,
  give = 22,
): { readonly x: number; readonly y: number } {
  const dx = x - px;
  const dy = y - py;
  const falloff = Math.exp(-(dx * dx + dy * dy) / (reach * reach));
  const k = give / ((reach / Math.SQRT2) * Math.exp(-0.5));
  return { x: dx * falloff * k, y: dy * falloff * k };
}

/** Moves `current` toward `target` with a time constant of `tau` seconds: eased, never a snap. */
export function ease(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / Math.max(1e-6, tau)));
}
