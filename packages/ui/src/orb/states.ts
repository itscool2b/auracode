import type { AgentBrand } from "../brand";
import { hexToRgb } from "../color";

/**
 * What an orb shows. The orb is live state, not decoration: each state maps to an energy level,
 * a speed, a frame rate, and optionally a tint, and changes glide rather than jump.
 */
export type OrbState = "idle" | "thinking" | "streaming" | "tool" | "waiting" | "error" | "done";

/** Every orb state, in lifecycle order. */
export const ORB_STATES: readonly OrbState[] = [
  "idle",
  "thinking",
  "streaming",
  "tool",
  "waiting",
  "error",
  "done",
];

/** Colour families an orb can lean toward. */
export type OrbTint = "none" | "amber" | "red";

/** Where an orb heads in a given state. */
export interface OrbStateTarget {
  /** 0..1: brightness, lobe size, warp strength. */
  readonly energy: number;
  /** Multiplier on the brand's base speed. */
  readonly speed: number;
  /** Multiplier on the brand's turbulence. */
  readonly turbulence: number;
  /** Frames per second once settled. Idle orbs run slow to save power. */
  readonly fps: number;
  readonly tint: OrbTint;
  /** 0..1: how far the palette leans toward the tint. */
  readonly tintAmount: number;
  /** Time constant of the glide into this state, ms. About three of these to settle. */
  readonly glideMs: number;
  /**
   * 0..1: amplitude of a slow breathing swing in energy (see PULSE_HZ). Waiting breathes so it reads
   * as waiting by motion alone, even on amber and gold brands where the amber tint barely shows.
   */
  readonly pulse: number;
}

const STATE_TARGETS: Readonly<Record<OrbState, OrbStateTarget>> = {
  // Breathing: dim, slow, cheap.
  idle: {
    energy: 0.2,
    speed: 0.35,
    turbulence: 0.8,
    fps: 24,
    tint: "none",
    tintAmount: 0,
    pulse: 0,
    glideMs: 420,
  },
  // Reasoning: bright and churning.
  thinking: {
    energy: 0.78,
    speed: 1,
    turbulence: 1.15,
    fps: 60,
    tint: "none",
    tintAmount: 0,
    pulse: 0,
    glideMs: 220,
  },
  // Writing the answer: steady flow, a little calmer than thinking.
  streaming: {
    energy: 0.62,
    speed: 0.8,
    turbulence: 0.95,
    fps: 60,
    tint: "none",
    tintAmount: 0,
    pulse: 0,
    glideMs: 260,
  },
  // Running a tool: the busiest, crispest state.
  tool: {
    energy: 0.88,
    speed: 1.25,
    turbulence: 1.3,
    fps: 60,
    tint: "none",
    tintAmount: 0,
    pulse: 0,
    glideMs: 180,
  },
  // Needs the user: amber, slow pulse. The tint is strong on purpose: "needs approval" has to read
  // at a glance on every brand, and a weaker mix turns violet or blue brands a muddy tan.
  waiting: {
    energy: 0.48,
    speed: 0.45,
    turbulence: 0.7,
    fps: 30,
    tint: "amber",
    tintAmount: 0.85,
    pulse: 0.22,
    glideMs: 320,
  },
  // Something broke: red, subdued, a little uneasy.
  error: {
    energy: 0.36,
    speed: 0.3,
    turbulence: 1.2,
    fps: 24,
    tint: "red",
    tintAmount: 0.82,
    pulse: 0,
    glideMs: 260,
  },
  // Finished: settles slowly to the calmest state.
  done: {
    energy: 0.14,
    speed: 0.25,
    turbulence: 0.6,
    fps: 24,
    tint: "none",
    tintAmount: 0,
    pulse: 0,
    glideMs: 900,
  },
};

/** Frequency of the waiting pulse: one slow breath every two seconds. */
export const PULSE_HZ = 0.5;

/** The energy offset of a pulse of `amplitude` at time `nowMs`: a sine, zero at time zero. */
export function pulseOffset(amplitude: number, nowMs: number): number {
  if (!(amplitude > 0) || !Number.isFinite(nowMs)) return 0;
  return amplitude * Math.sin((2 * Math.PI * PULSE_HZ * nowMs) / 1000);
}

/** The target for `state`. Unknown values (from untyped callers) are treated as idle. */
export function orbStateTarget(state: OrbState): OrbStateTarget {
  return Object.hasOwn(STATE_TARGETS, state) ? STATE_TARGETS[state] : STATE_TARGETS.idle;
}

/**
 * Ramps the palette leans toward in tinted states. They share a brand palette's dark-to-bright
 * structure, so a tinted orb keeps its depth instead of flattening into one colour.
 */
export const TINT_RAMPS: Readonly<
  Record<Exclude<OrbTint, "none">, readonly [string, string, string, string]>
> = {
  amber: ["#2b1a04", "#8c5a0f", "#f5b544", "#ffe7b0"],
  red: ["#2b0606", "#8f1d1a", "#ff5a52", "#ffd3cf"],
};

/** Short words for screen readers, used to build an orb's default label. */
export const ORB_STATE_LABELS: Readonly<Record<OrbState, string>> = {
  idle: "idle",
  thinking: "thinking",
  streaming: "responding",
  tool: "using a tool",
  waiting: "waiting for approval",
  error: "error",
  done: "done",
};

/** Number of floats in a palette uniform: four RGB stops. */
export const PALETTE_FLOATS = 12;

/** Writes a brand palette as 12 floats (four RGB stops) into `out`. */
export function writeBrandPalette(out: Float32Array, brand: AgentBrand): Float32Array {
  for (let stop = 0; stop < 4; stop += 1) {
    const rgb = hexToRgb(brand.palette[stop as 0 | 1 | 2 | 3]);
    out[stop * 3] = rgb[0];
    out[stop * 3 + 1] = rgb[1];
    out[stop * 3 + 2] = rgb[2];
  }
  return out;
}

const TINT_FLOATS: Readonly<Record<Exclude<OrbTint, "none">, Float32Array>> = {
  amber: writeRampFloats(TINT_RAMPS.amber),
  red: writeRampFloats(TINT_RAMPS.red),
};

function writeRampFloats(ramp: readonly [string, string, string, string]): Float32Array {
  const out = new Float32Array(PALETTE_FLOATS);
  for (let stop = 0; stop < 4; stop += 1) {
    const rgb = hexToRgb(ramp[stop as 0 | 1 | 2 | 3]);
    out.set(rgb, stop * 3);
  }
  return out;
}

/**
 * Writes the palette an orb heads toward in `state`: the brand palette (12 floats from
 * writeBrandPalette) leaning toward the state's tint ramp. Allocation-free.
 */
export function writeTargetPalette(
  out: Float32Array,
  brandPalette: Float32Array,
  state: OrbState,
): Float32Array {
  const target = orbStateTarget(state);
  const tint = target.tint === "none" ? null : TINT_FLOATS[target.tint];
  const k = tint ? target.tintAmount : 0;
  for (let i = 0; i < PALETTE_FLOATS; i += 1) {
    const base = brandPalette[i] ?? 0;
    out[i] = tint ? base + ((tint[i] ?? base) - base) * k : base;
  }
  return out;
}

/**
 * Frame-rate independent exponential glide from `current` toward `target`: after `glideMs` it has
 * covered 63% of the distance, after three it is within 5%. It never overshoots, splitting a step
 * in two gives the same result, and a state change mid-glide simply continues from where the orb
 * is. A non-positive `dtMs` changes nothing; a non-positive `glideMs` snaps.
 */
export function glide(current: number, target: number, dtMs: number, glideMs: number): number {
  if (!Number.isFinite(current)) return target;
  if (!(dtMs > 0)) return current;
  if (!(glideMs > 0)) return target;
  const k = 1 - Math.exp(-dtMs / glideMs);
  return current + (target - current) * k;
}
