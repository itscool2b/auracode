import type { StressConfig } from "../bindings";

/**
 * Stress-view settings in the `AURACODE_STRESS` format: `orbs=24,rate=200,aura=1,seconds=0`.
 *
 * Rust parses the environment variable at launch and passes the result in `app_info`. The stress
 * view shows its current settings in the same format (copy them to reproduce a run) and accepts
 * edits to that line, parsed here. The rules match `parse_stress_config` in
 * src-tauri/src/launch.rs exactly, and both test the same cases.
 */

export const DEFAULT_STRESS: StressConfig = { orbs: 6, rate: 200, aura: true, seconds: 0 };

export const STRESS_LIMITS = {
  orbs: { min: 1, max: 24 },
  rate: { min: 1, max: 5000 },
  seconds: { min: 0, max: 86_400 },
} as const;

/** Mirrors `MAX_STRESS_TOKENS` in src-tauri/src/demo.rs. */
export const MAX_STRESS_TOKENS = 500_000;

/** With `seconds=0` the view streams in turns of this length, back to back, until stopped. */
export const ROLLING_TURN_SECONDS = 30;

export type StressParse =
  | { readonly ok: true; readonly config: StressConfig }
  | { readonly ok: false; readonly error: string };

const TRUTHY = ["1", "true", "yes", "on"];
const FALSY = ["0", "false", "no", "off"];

function isIn(values: readonly string[], value: string): boolean {
  const lower = value.toLowerCase();
  return values.includes(lower);
}

type NumericKey = keyof typeof STRESS_LIMITS;

function parseBounded(key: NumericKey, value: string): number | string {
  const { min, max } = STRESS_LIMITS[key];
  const error = `${key} must be a whole number from ${min} to ${max}, not "${value}"`;
  if (!/^[0-9]+$/.test(value)) return error;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : error;
}

/**
 * Comma-separated `key=value` pairs (`orbs`, `rate`, `aura`, `seconds`) in any order, defaults for
 * the rest; a bare `1`/`true`/`yes`/`on` means all defaults. Keys are case-insensitive and
 * whitespace around entries is ignored. Out-of-range values are errors, not clamped: the settings
 * drive a power measurement.
 */
export function parseStressConfig(input: string): StressParse {
  const trimmed = input.trim();
  const config: { -readonly [K in keyof StressConfig]: StressConfig[K] } = { ...DEFAULT_STRESS };
  if (isIn(TRUTHY, trimmed)) return { ok: true, config };

  const seen = new Set<string>();
  for (const rawEntry of trimmed.split(",")) {
    const entry = rawEntry.trim();
    if (entry === "") continue;
    const equals = entry.indexOf("=");
    if (equals === -1) return { ok: false, error: `"${entry}" is not a key=value pair` };
    const rawKey = entry.slice(0, equals).trim();
    const value = entry.slice(equals + 1).trim();
    const key = rawKey.toLowerCase();
    if (key !== "orbs" && key !== "rate" && key !== "aura" && key !== "seconds") {
      return {
        ok: false,
        error: `unknown setting "${rawKey}" (expected orbs, rate, aura or seconds)`,
      };
    }
    if (seen.has(key)) return { ok: false, error: `"${key}" is set more than once` };
    seen.add(key);

    if (key === "aura") {
      if (isIn(TRUTHY, value)) config.aura = true;
      else if (isIn(FALSY, value)) config.aura = false;
      else return { ok: false, error: `aura must be 1 or 0, not "${value}"` };
      continue;
    }
    const parsed = parseBounded(key, value);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    config[key] = parsed;
  }
  return { ok: true, config };
}

/** Back in the `AURACODE_STRESS` format, e.g. for a copyable launch command. */
export function formatStressConfig(config: StressConfig): string {
  return `orbs=${config.orbs},rate=${config.rate},aura=${config.aura ? 1 : 0},seconds=${config.seconds}`;
}

/**
 * Tokens for one stress turn: `rate * seconds` for a timed run, or one rolling turn for an
 * open-ended one. Capped at what the shell accepts.
 */
export function stressTurnTokens(config: StressConfig): number {
  const seconds = config.seconds > 0 ? config.seconds : ROLLING_TURN_SECONDS;
  return Math.max(1, Math.min(MAX_STRESS_TOKENS, Math.round(config.rate * seconds)));
}
