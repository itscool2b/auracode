import type { AgentBrandId } from "../brand";
import type { OrbState } from "../orb/states";

/*
 * The Orbit mark, as numbers (visual-language.md, section 5). A 1px body is the workspace; the agent
 * is a square satellite on its own orbit around it. The orbit's tilt and shape are the agent's
 * identity; what the satellite does is the agent's state. Everything here is a pure function of the
 * playhead, the turn's activity and the agent's signature, so `?t=` renders the same frame every time
 * and every mark of one agent moves in step.
 *
 * Coordinates: an orbit is drawn in its own frame with y up (angles counterclockwise from the
 * rightmost point), rotated by the tilt, then flipped into the SVG's y-down space. The far half of an
 * orbit is the one with sin(angle) > 0: where it crosses the body, the body's fill hides it.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export type SatelliteMotion = "smooth" | "steps" | "rising" | "kepler";

export interface OrbitSignature {
  /** A tilted ellipse, or a concentric circle seen face on. */
  readonly kind: "ellipse" | "ring";
  /** Degrees, counterclockwise from horizontal. */
  readonly tilt: number;
  /** Semi-major axis as a share of the canvas. */
  readonly a: number;
  /** Shape: semi-minor over semi-major. */
  readonly k: number;
  /** The orbit's centre, moved along its own major axis, as a share of the canvas. */
  readonly shift: number;
  readonly motion: SatelliteMotion;
  /** One revolution, ms. */
  readonly period: number;
  /** 1 counterclockwise, -1 clockwise (OpenCode alone). */
  readonly direction: 1 | -1;
  readonly satellites: 1 | 2;
  /** An agent with no signature: the whole orbit dashed, the satellite hollow. */
  readonly unknown: boolean;
}

const BASE: OrbitSignature = {
  kind: "ellipse",
  tilt: 0,
  a: 0.42,
  k: 0.3,
  shift: 0,
  motion: "smooth",
  period: 3000,
  direction: 1,
  satellites: 1,
  unknown: false,
};

/** Every agent flies its own orbit (section 5.3). */
export const SIGNATURES: Readonly<Record<AgentBrandId, OrbitSignature>> = {
  // Inclined at the launch latitude of Cape Canaveral.
  "claude-code": { ...BASE, tilt: 28.5, k: 0.34, period: 2400 },
  // Equatorial, stepping like a terminal cursor.
  codex: { ...BASE, k: 0.3, motion: "steps", period: 2400 },
  // Polar, perfectly even.
  pi: { ...BASE, tilt: 90, k: 0.3, period: 3000 },
  "oh-my-pi": { ...BASE, tilt: 90, k: 0.3, period: 3000, satellites: 2 },
  // Steep, faster on the rising half.
  antigravity: { ...BASE, tilt: 62, k: 0.36, motion: "rising", period: 2000 },
  // Molniya: swung out to the lower right, fast near the body, slow far out.
  grok: { ...BASE, tilt: -35, a: 0.36, k: 0.42, shift: 0.12, motion: "kepler", period: 2400 },
  // A ring seen face on.
  cursor: { ...BASE, kind: "ring", k: 1, period: 4000 },
  // Retrograde: the only clockwise orbit.
  opencode: { ...BASE, tilt: -62, k: 0.36, period: 1800, direction: -1 },
  // A transfer orbit, shifted right, fast.
  hermes: { ...BASE, a: 0.38, k: 0.4, shift: 0.1, period: 1400 },
  generic: { ...BASE, unknown: true },
};

/** An agent's signature; anything unknown (or an Object member like "constructor") is generic. */
export function signatureOf(agent: string): OrbitSignature {
  return Object.hasOwn(SIGNATURES, agent)
    ? ((SIGNATURES as Readonly<Record<string, OrbitSignature>>)[agent] ?? SIGNATURES.generic)
    : SIGNATURES.generic;
}

/** Where a satellite rests: the front of its orbit, 40 degrees above the rightmost point. */
export const PARKED_ANGLE = 40 * DEG;

/** The orbit's own frame turned into SVG space (y down), for a canvas of `size` px. */
export function orbitPoint(signature: OrbitSignature, angle: number, size: number) {
  const a = signature.a * size;
  const b = signature.kind === "ring" ? a : a * signature.k;
  const tilt = signature.tilt * DEG;
  const ex = a * Math.cos(angle) + signature.shift * size;
  const ey = b * Math.sin(angle);
  const x = ex * Math.cos(tilt) - ey * Math.sin(tilt);
  const y = ex * Math.sin(tilt) + ey * Math.cos(tilt);
  return { x: size / 2 + x, y: size / 2 - y };
}

/** The angle of the orbit's highest point on screen: where a waiting satellite goes. */
export function topAngle(signature: OrbitSignature): number {
  if (signature.kind === "ring") return Math.PI / 2;
  const tilt = signature.tilt * DEG;
  // Maximise y' = a cos(t) sin(tilt) + b sin(t) cos(tilt).
  return Math.atan2(signature.k * Math.cos(tilt), Math.sin(tilt));
}

/** True on the far half of the orbit, the half the body can hide. */
export function isFarSide(signature: OrbitSignature, angle: number): boolean {
  return signature.kind === "ellipse" && Math.sin(angle) > 1e-9;
}

/** Below this canvas size the body is a filled node, not a hollow circle (section 5.2). */
export const SMALL_MARK = 48;

/**
 * The body's radius for a canvas of `size` px (section 5.2): always well inside the narrowest
 * orbit's minor axis (0.126 S for k 0.30), so every orbit reads as a line around a node. A node the
 * size of the minor axis turned the ellipse into a capsule outline with a hole: pills and eyes at
 * 14 to 24px, a thermometer at 56. From 48px it is a small hollow node, like the X Card's; below
 * 48px it is a filled dot.
 */
export function bodyRadius(size: number): number {
  return size < SMALL_MARK ? 0.06 * size : 0.09 * size;
}

/** The satellite's side: max(4, round(0.18 S)), capped at 10px. */
export function satelliteSide(size: number): number {
  return Math.min(10, Math.max(4, Math.round(0.18 * size)));
}

/** Just above the body, where a waiting satellite parks when its orbit's apex is too low. */
export function abovePoint(size: number): { readonly x: number; readonly y: number } {
  return { x: size / 2, y: size / 2 - bodyRadius(size) - satelliteSide(size) * 0.75 };
}

/** Just below the body, where a failed satellite drops. */
export function belowPoint(size: number): { readonly x: number; readonly y: number } {
  return { x: size / 2, y: size / 2 + bodyRadius(size) + satelliteSide(size) * 0.75 };
}

/**
 * Where a waiting satellite rests: the top of its orbit, unless that point lies on or inside the
 * body (Codex's flat orbit, Hermes, any unknown agent), where the diamond would vanish behind the
 * node. Then it parks just above the body, in front of everything.
 */
export function waitingPoint(
  signature: OrbitSignature,
  size: number,
): { readonly x: number; readonly y: number; readonly onOrbit: boolean; readonly angle: number } {
  const angle = topAngle(signature);
  const apex = orbitPoint(signature, angle, size);
  const reach = Math.hypot(apex.x - size / 2, apex.y - size / 2);
  if (reach >= bodyRadius(size) + satelliteSide(size) / 2) return { ...apex, onOrbit: true, angle };
  return { ...abovePoint(size), onOrbit: false, angle };
}

/** An SVG path for the orbit from `from` to `to` (radians, increasing), sampled finely enough. */
export function orbitArc(
  signature: OrbitSignature,
  from: number,
  to: number,
  size: number,
): string {
  const span = to - from;
  const steps = Math.max(8, Math.ceil((Math.abs(span) / TAU) * 96));
  const parts: string[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const point = orbitPoint(signature, from + (span * index) / steps, size);
    parts.push(`${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  }
  return parts.join(" ");
}

/* --------------------------------------------------------------------------- satellite travel */

const KEPLER_E = 0.6;

/** Kepler's equation, E - e sin E = M, three Newton steps (plenty for timing). */
export function eccentricAnomaly(mean: number, e = KEPLER_E): number {
  let estimate = mean + e * Math.sin(mean);
  for (let step = 0; step < 3; step += 1) {
    estimate -= (estimate - e * Math.sin(estimate) - mean) / (1 - e * Math.cos(estimate));
  }
  return estimate;
}

function trueAnomaly(mean: number, e = KEPLER_E): number {
  const ecc = eccentricAnomaly(mean, e);
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(ecc / 2), Math.sqrt(1 - e) * Math.cos(ecc / 2));
}

function meanFromTrue(nu: number, e = KEPLER_E): number {
  const ecc =
    2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  return ecc - e * Math.sin(ecc);
}

// Grok Build's periapsis is the end of the orbit nearest the body (angle pi, since the orbit is
// shifted toward +x); this offsets its mean anomaly so phase 0 is still the parked point.
const KEPLER_OFFSET = meanFromTrue(PARKED_ANGLE - Math.PI);

/** How far along its orbit a satellite is after `phase` revolutions from the parked point. */
export function travelAngle(signature: OrbitSignature, phase: number): number {
  const whole = Math.floor(phase);
  const frac = phase - whole;
  let swept: number;
  switch (signature.motion) {
    case "steps":
      swept = (Math.floor(frac * 12 + 1e-9) / 12) * TAU;
      break;
    case "rising": {
      // Speed 1 + 0.5 cos(u - u0), fastest across the rising half (around the rightmost point).
      const u = frac * TAU;
      const u0 = -PARKED_ANGLE;
      swept = u + 0.5 * (Math.sin(u - u0) - Math.sin(-u0));
      break;
    }
    case "kepler": {
      const mean = KEPLER_OFFSET + frac * TAU;
      const start = Math.PI + trueAnomaly(KEPLER_OFFSET);
      let end = Math.PI + trueAnomaly(mean);
      while (end < start - 1e-9) end += TAU;
      swept = end - start;
      break;
    }
    default:
      swept = frac * TAU;
  }
  return PARKED_ANGLE + signature.direction * (whole * TAU + swept);
}

/* ------------------------------------------------------------------------- activity over time */

/** What the agent was doing over a stretch of the timeline (ms). `to` null: still going. */
export interface ActivitySegment {
  readonly from: number;
  readonly to: number | null;
  readonly state: OrbState;
}

/** Moments that ring a ripple: a tool starting or ending, the agent starting to wait. */
export interface MarkTimeline {
  readonly segments: readonly ActivitySegment[];
  readonly ripples: readonly { readonly at: number; readonly tone: "ink" | "signal" }[];
  /** Characters streamed into messages so far, for the globe's data-driven turn. */
  readonly streamedChars: number;
}

export const IDLE_TIMELINE: MarkTimeline = { segments: [], ripples: [], streamedChars: 0 };

/** The state at `t`, and when it began. */
export function stateAt(timeline: MarkTimeline, t: number): { state: OrbState; since: number } {
  let found: { state: OrbState; since: number } = { state: "idle", since: 0 };
  for (const segment of timeline.segments) {
    if (segment.from > t) break;
    if (segment.to === null || t < segment.to)
      found = { state: segment.state, since: segment.from };
  }
  return found;
}

/** Revolutions travelled by `t`: thinking at two thirds of the agent's pace, streaming at full. */
export function travelPhase(timeline: MarkTimeline, signature: OrbitSignature, t: number): number {
  let ms = 0;
  for (const segment of timeline.segments) {
    if (segment.from >= t) break;
    const speed = segment.state === "streaming" ? 1 : segment.state === "thinking" ? 1 / 1.5 : 0;
    if (speed === 0) continue;
    const end = Math.min(t, segment.to ?? t);
    if (end > segment.from) ms += (end - segment.from) * speed;
  }
  return ms / signature.period;
}

/* ------------------------------------------------------------------------------- the frame */

export interface MarkFrame {
  readonly state: OrbState;
  /** The satellite's centre, px. */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** Behind the body: drawn under its fill. Never true for a waiting satellite. */
  readonly hidden: boolean;
  /** Turned 45 degrees into a diamond (waiting). */
  readonly diamond: boolean;
  readonly satelliteTone: "ink" | "signal" | "red";
  readonly orbitTone: "text-1" | "text-2" | "text-3";
  readonly orbitDashed: boolean;
  /** The 90 degrees of orbit behind a fast satellite (streaming). */
  readonly trail: boolean;
  /** The done check: how much of it is drawn (0 to 1) and how visible it is. */
  readonly checkDraw: number;
  readonly checkOpacity: number;
  /** A ripple around the satellite: 0 to 1 through its 620ms, or null. */
  readonly ripple: { readonly progress: number; readonly tone: "ink" | "signal" } | null;
}

const easeOut = (x: number): number => 1 - (1 - x) ** 3;
const standard = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export const RIPPLE_MS = 620;
const WAIT_GLIDE_MS = 300;
const ERROR_DROP_MS = 400;
const DONE_EASE_MS = 500;
const CHECK_DRAW_MS = 250;
const CHECK_HOLD_MS = 1600;
const CHECK_FADE_MS = 300;

/** The shortest signed turn from `from` to `to`. */
function shortest(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

/**
 * Everything a mark draws at `t`: where the satellite is and how it looks, the orbit's tone, the
 * check and the ripple. `reduced` parks every satellite and shows the state by geometry alone.
 */
export function markFrame(
  signature: OrbitSignature,
  timeline: MarkTimeline,
  t: number,
  size: number,
  reduced = false,
): MarkFrame {
  const { state, since } = stateAt(timeline, t);
  const resting = orbitPoint(signature, PARKED_ANGLE, size);
  // The orbit is the identity, so it is the brighter line: text-2 at rest, ink while the agent
  // streams or runs a tool (section 5.4). The body stays a quiet text-3 node.
  const base: MarkFrame = {
    state,
    x: resting.x,
    y: resting.y,
    angle: PARKED_ANGLE,
    hidden: false,
    diamond: false,
    satelliteTone: "ink",
    orbitTone: "text-2",
    orbitDashed: false,
    trail: false,
    checkDraw: 0,
    checkOpacity: 0,
    ripple: null,
  };
  const active = state === "thinking" || state === "streaming" || state === "tool";

  if (reduced) {
    if (active) return { ...base, orbitTone: "text-1" };
    if (state === "waiting") {
      // Only the satellite turns orange: one diamond is all the colour a wait spends.
      const rest = waitingPoint(signature, size);
      return {
        ...base,
        x: rest.x,
        y: rest.y,
        angle: rest.angle,
        diamond: true,
        satelliteTone: "signal",
        orbitTone: "text-3",
      };
    }
    if (state === "error") {
      return {
        ...base,
        ...belowPoint(size),
        satelliteTone: "red",
        orbitTone: "text-3",
        orbitDashed: true,
      };
    }
    if (state === "done") {
      const elapsed = t - since;
      const visible = elapsed < CHECK_HOLD_MS + CHECK_DRAW_MS;
      return { ...base, checkDraw: visible ? 1 : 0, checkOpacity: visible ? 1 : 0 };
    }
    return base;
  }

  const phase = travelPhase(timeline, signature, t);
  let angle = travelAngle(signature, phase);
  let frame: MarkFrame = { ...base, angle };

  if (state === "thinking" || state === "streaming" || state === "tool") {
    frame = {
      ...frame,
      orbitTone: state === "thinking" ? "text-2" : "text-1",
      trail: state === "streaming",
    };
  } else if (state === "waiting") {
    const fromAngle = travelAngle(signature, travelPhase(timeline, signature, since));
    const rest = waitingPoint(signature, size);
    const glide = easeOut(clamp01((t - since) / WAIT_GLIDE_MS));
    const waiting = {
      ...frame,
      diamond: glide >= 0.5,
      satelliteTone: "signal" as const,
      orbitTone: "text-3" as const,
    };
    if (rest.onOrbit) {
      angle = fromAngle + shortest(fromAngle, rest.angle) * glide;
      frame = { ...waiting, angle };
    } else {
      // Off the orbit: the satellite rises straight to its place above the body, in front of it.
      const from = orbitPoint(signature, fromAngle, size);
      return {
        ...waiting,
        angle: rest.angle,
        x: from.x + (rest.x - from.x) * glide,
        y: from.y + (rest.y - from.y) * glide,
        hidden: false,
        ripple: rippleAt(timeline, t),
      };
    }
  } else if (state === "error") {
    const start = orbitPoint(
      signature,
      travelAngle(signature, travelPhase(timeline, signature, since)),
      size,
    );
    const drop = standard(clamp01((t - since) / ERROR_DROP_MS));
    const end = belowPoint(size);
    return {
      ...frame,
      x: start.x + (end.x - start.x) * drop,
      y: start.y + (end.y - start.y) * drop,
      hidden: false,
      satelliteTone: "red",
      orbitTone: "text-3",
      orbitDashed: true,
    };
  } else if (state === "done") {
    const atDone = travelPhase(timeline, signature, since);
    const target = Math.ceil(atDone - 1e-9);
    const ease = easeOut(clamp01((t - since) / DONE_EASE_MS));
    angle = travelAngle(signature, atDone + (target - atDone) * ease);
    const elapsed = t - since;
    const checkDraw = easeOut(clamp01(elapsed / CHECK_DRAW_MS));
    const fade = clamp01((elapsed - CHECK_DRAW_MS - CHECK_HOLD_MS) / CHECK_FADE_MS);
    frame = { ...frame, angle, checkDraw, checkOpacity: elapsed < 0 ? 0 : 1 - fade };
  }

  const point = orbitPoint(signature, frame.angle, size);
  const inside = Math.hypot(point.x - size / 2, point.y - size / 2) < bodyRadius(size);
  return {
    ...frame,
    x: point.x,
    y: point.y,
    // A waiting satellite is the "needs you" signal: it is never drawn behind the body.
    hidden: state !== "waiting" && inside && isFarSide(signature, frame.angle),
    ripple: rippleAt(timeline, t),
  };
}

/** The ripple ringing at `t`, if any: the latest one still inside its 620ms. */
function rippleAt(timeline: MarkTimeline, t: number): MarkFrame["ripple"] {
  let ripple: MarkFrame["ripple"] = null;
  for (const entry of timeline.ripples) {
    const age = t - entry.at;
    if (age >= 0 && age < RIPPLE_MS) ripple = { progress: age / RIPPLE_MS, tone: entry.tone };
  }
  return ripple;
}
