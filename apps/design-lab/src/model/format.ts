/**
 * Number and label formats shared by every direction, so "Thought for 6s", "48s", "12.4k tokens"
 * and "$0.21" read the same everywhere. Directions choose where to show them, not how they round.
 */

/**
 * Elapsed time the way chat UIs show it: "0s", "6s", "48s", "1m 05s", "1h 02m". Whole seconds,
 * rounded down while running (a live counter never shows a second that has not passed yet).
 */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * A finished duration, rounded to the nearest second: "48s", "1m 05s". Under a second shows as
 * "<1s" rather than "0s", which would read as "did nothing".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 500) return "<1s";
  return formatElapsed(Math.round(ms / 1000) * 1000);
}

/**
 * Token and other counts: 950, 12.4k, 1.2M. Rounds before choosing the unit, so 999,950 is "1M",
 * not "1000k".
 */
export function formatCount(count: number): string {
  if (!Number.isFinite(count)) return "0";
  const sign = count < 0 ? "-" : "";
  const abs = Math.abs(count);
  const whole = Math.round(abs);
  if (whole < 1000) return `${whole === 0 ? "" : sign}${whole}`;
  const thousands = Math.round(abs / 100);
  if (thousands < 10_000) return `${sign}${trimZero((thousands / 10).toFixed(1))}k`;
  const millions = Math.round(abs / 100_000);
  return `${sign}${trimZero((millions / 10).toFixed(1))}M`;
}

function trimZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

/**
 * A cost: "$0.21", "$1.40", "$0.0034" (amounts under a cent keep four decimals so they never read
 * as free), "0.21 EUR" for other currencies. Null when there is no usable amount.
 */
export function formatCost(amount: number | null, currency: string): string | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  const decimals = amount > 0 && amount < 0.01 ? 4 : 2;
  const value = amount.toFixed(decimals);
  return currency.toUpperCase() === "USD" ? `$${value}` : `${value} ${currency}`;
}

/** "1 file", "2 files": a count with its noun, singular for exactly one. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** The last segment of a path: "packages/ui/src/orb/pacing.ts" is "pacing.ts". */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Everything before the last path segment, without the trailing slash; "" for a bare name. */
export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? "" : trimmed.slice(0, index);
}
