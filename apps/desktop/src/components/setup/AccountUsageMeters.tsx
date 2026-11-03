import type { AccountUsage } from "../../bindings";
import { resetText, seenText, usedText } from "../../lib/agentAccounts";
import "./accounts.css";

/**
 * What an account last reported about its usage limits (docs/agent-accounts.md): each window
 * ("5 hours", "7 days", a model's own week) as a thin meter with its share used and reset, and
 * when the report came. `compact` is one line of shares, for the composer's account rows.
 */
export function AccountUsageMeters({
  usage,
  compact = false,
  now = Date.now(),
}: {
  readonly usage: AccountUsage | null;
  readonly compact?: boolean;
  readonly now?: number;
}) {
  if (!usage || usage.windows.length === 0)
    return compact ? null : (
      <p className="account-usage-none">No usage reported yet. It shows once a chat runs on it.</p>
    );
  const full = usage.windows.some((window) => (window.used_percent ?? 0) >= 100);
  if (compact)
    return (
      <small className="account-usage-line" data-full={full || undefined}>
        {usage.windows
          .slice(0, 3)
          .map((window) => `${window.label} ${usedText(window.used_percent)}`)
          .join(" · ")}
      </small>
    );
  return (
    <div className="account-usage" data-testid="account-usage">
      {usage.windows.map((window) => (
        <div
          key={window.label}
          className="account-usage-window"
          data-full={(window.used_percent ?? 0) >= 100 || undefined}
        >
          <span className="account-usage-label">{window.label}</span>
          <progress
            max={100}
            value={Math.max(0, Math.min(100, window.used_percent ?? 0))}
            aria-label={`${window.label} used`}
          />
          <span className="account-usage-value">
            {usedText(window.used_percent)}
            {window.resets_at ? ` · ${resetText(window.resets_at, now)?.replace(/\.$/, "")}` : ""}
          </span>
        </div>
      ))}
      <small className="account-usage-seen">As of {seenText(usage.observed_at, now)}</small>
    </div>
  );
}
