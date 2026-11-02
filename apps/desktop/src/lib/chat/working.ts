import type { ToolKind } from "../../bindings";

/**
 * The working line's words (docs/design/visual-language.md): while an agent works and no text
 * streams, the tail of its turn says so with one playful verb at a time. The agent's reasoning is
 * never shown; these words stand in for it. Every choice is seeded by the turn, so a turn always
 * shows the same sequence (and a test can name it), and two turns read differently.
 */

/** What the agent's last call was doing, so the words can lean towards it. */
export type WorkingContext = "look" | "make" | "run" | null;

/** Thinking and planning: the default, and the half of every pick that does not lean. */
export const THINKING_VERBS = [
  "Pondering",
  "Noodling",
  "Mulling",
  "Musing",
  "Cogitating",
  "Percolating",
  "Brewing",
  "Simmering",
  "Marinating",
  "Scheming",
  "Plotting",
  "Conjuring",
  "Concocting",
  "Hatching",
  "Puzzling",
  "Ruminating",
  "Untangling",
  "Finagling",
] as const;

/** After a read, a search or a fetch. */
export const LOOKING_VERBS = [
  "Sleuthing",
  "Rummaging",
  "Spelunking",
  "Scouring",
  "Combing",
  "Foraging",
  "Perusing",
  "Digging",
] as const;

/** After an edit, a move or a deletion. */
export const MAKING_VERBS = [
  "Whittling",
  "Crafting",
  "Tinkering",
  "Polishing",
  "Sculpting",
  "Stitching",
  "Assembling",
  "Weaving",
] as const;

/** After a command. */
export const RUNNING_VERBS = [
  "Wrangling",
  "Herding bits",
  "Juggling",
  "Orchestrating",
  "Churning",
  "Cranking",
] as const;

/** How often a pick leans towards the context's own words. */
const LEAN = 0.6;

/** The rotation's pace: each verb stays between these, seeded per turn and step. */
export const ROTATION_MIN_MS = 2500;
export const ROTATION_MAX_MS = 3500;

/** FNV-1a: a turn's key as a 32-bit seed. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A number in [0, 1) fixed by `seed` and `step` (one round of mulberry32). */
function unit(seed: number, step: number): number {
  let t = (seed + Math.imul(step + 1, 0x6d2b79f5)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** `pool` in an order fixed by `seed` (Fisher-Yates on the seeded numbers). */
function shuffled(pool: readonly string[], seed: number): string[] {
  const order = [...pool];
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(unit(seed, 1000 + index) * (index + 1));
    [order[index], order[other]] = [order[other] as string, order[index] as string];
  }
  return order;
}

const POOLS: Readonly<Record<Exclude<WorkingContext, null>, readonly string[]>> = {
  look: LOOKING_VERBS,
  make: MAKING_VERBS,
  run: RUNNING_VERBS,
};

/** Each pool takes its own order from the turn's seed. */
const SALT: Readonly<Record<Exclude<WorkingContext, null>, number>> = {
  look: 0x9e3779b9,
  make: 0x85ebca6b,
  run: 0xc2b2ae35,
};

/**
 * The verb a turn shows at step `tick`. Each pool is walked in its own seeded order, one step per
 * tick, so a pool never names the same verb twice in a row; with a context, about three picks in
 * five come from its pool, the rest from the thinking words. The pools share no verb, so no tick
 * repeats the one before it.
 */
export function workingVerb(seed: number, tick: number, context: WorkingContext): string {
  const leaning = context !== null && unit(seed, tick * 2 + 1) < LEAN;
  const pool = leaning ? POOLS[context] : THINKING_VERBS;
  const salt = leaning ? SALT[context] : 0;
  const order = shuffled(pool, (seed ^ salt) >>> 0);
  const offset = Math.floor(unit((seed ^ salt) >>> 0, 7) * order.length);
  return order[(offset + tick) % order.length] as string;
}

/** How long the verb at step `tick` stays, between 2.5 and 3.5 seconds. */
export function rotationDelay(seed: number, tick: number): number {
  return ROTATION_MIN_MS + Math.floor(unit(seed, tick * 2) * (ROTATION_MAX_MS - ROTATION_MIN_MS));
}

/** The context a call of this kind sets. Thinking, mode changes and other tools set none. */
export function workingContext(kind: ToolKind | null | undefined): WorkingContext {
  switch (kind) {
    case "read":
    case "search":
    case "fetch":
      return "look";
    case "edit":
    case "delete":
    case "move":
      return "make";
    case "execute":
      return "run";
    default:
      return null;
  }
}

/** 0 s, 12 s, 1 min 5 s, 1 h 2 min: whole steps, so the count ticks once a second. */
export function formatElapsed(ms: number): string {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * When the UI first saw each turn working, by turn key: the elapsed time survives the working
 * line's row leaving and re-entering the virtual window, and the chat being reopened. Bounded.
 */
const firstSeen = new Map<string, number>();
const REMEMBERED_TURNS = 64;

export function workingSince(key: string, now: number): number {
  const known = firstSeen.get(key);
  if (known !== undefined) return known;
  firstSeen.set(key, now);
  if (firstSeen.size > REMEMBERED_TURNS) {
    const oldest = firstSeen.keys().next().value;
    if (oldest !== undefined) firstSeen.delete(oldest);
  }
  return now;
}
