import { Ellipsis } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProfileMeta } from "../../bindings";
import type { AccountSyncStatus } from "../../lib/account/bindings";
import {
  type AccountSyncSource,
  accountSyncSource,
  observeAccountSync,
} from "../../lib/account/sync";
import { commandKey } from "./Keys";
import { closePopover, Popover } from "./Popover";
import "./profile-status.css";

export function syncStatusLabel(status: AccountSyncStatus | null | undefined): string {
  if (status === undefined) return "Sync status loading";
  if (status === null) return "Sync status unavailable";
  const pending = status.pending_changes;
  const count = pending ? ` · ${pending} pending` : "";
  switch (status.state) {
    case "idle":
      return pending
        ? `${pending} ${pending === 1 ? "change" : "changes"} pending`
        : status.last_sync_at === null
          ? "Sync ready"
          : "Synced";
    case "syncing":
      return `Syncing${count}`;
    case "offline":
      return `Offline${count}`;
    case "paused":
      return `Sync paused${count}`;
    case "error":
      return `Sync needs attention${count}`;
    case "inactive":
      return `Sync inactive${count}`;
  }
}

/** One or two initials from the profile's name ("Local" L, "Work account" WA). */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  return letters.toUpperCase() || "?";
}

/**
 * The account row at the foot of the sidebar (Vercel's user row, Grok's avatar): round initials,
 * the profile's name on one line with its storage or sync state quietly under it, and a menu for
 * settings, agents and diagnostics.
 */
export function ProfileStatus({
  profile,
  onSettings,
  onAgents,
  onDiagnostics,
  source = accountSyncSource,
}: {
  readonly profile: ProfileMeta | null;
  readonly onSettings?: () => void;
  readonly onAgents?: () => void;
  readonly onDiagnostics: () => void;
  readonly source?: AccountSyncSource;
}) {
  const accountId = profile?.kind === "account" ? profile.id : null;
  const [cached, setCached] = useState<{
    id: string;
    value: AccountSyncStatus | null;
  } | null>(null);
  useEffect(() => {
    setCached(null);
    if (!accountId) return;
    return observeAccountSync(accountId, source, (value) => setCached({ id: accountId, value }));
  }, [accountId, source]);
  const status = cached?.id === accountId ? cached?.value : undefined;
  const label = accountId
    ? syncStatusLabel(status)
    : profile
      ? "Stored on this device"
      : "Profile unavailable";
  const detail = accountId
    ? [
        "Encrypted account workspace · Private cloud preview",
        status?.message,
        status?.last_sync_at
          ? `Last synced ${new Date(status.last_sync_at).toLocaleString()}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : undefined;
  const tone =
    status?.state === "error" || status?.state === "paused"
      ? "attention"
      : status?.state === "syncing"
        ? "live"
        : undefined;
  return (
    <div className="chat-account-row" data-profile-kind={profile?.kind ?? "unavailable"}>
      <span className="chat-account-avatar" aria-hidden="true">
        {initials(profile?.display_name)}
      </span>
      <span className="chat-account-identity">
        <strong title={profile?.display_name}>{profile?.display_name ?? "Workspace"}</strong>
        <small role="status" aria-live="polite" aria-atomic="true" title={detail} data-tone={tone}>
          {label}
        </small>
      </span>
      <Popover
        label="Account menu"
        tip="Settings and more"
        className="chat-account-menu"
        trigger={<Ellipsis size={16} />}
      >
        {onSettings ? (
          <button
            type="button"
            className="g-menu-item"
            aria-label="Open settings"
            aria-keyshortcuts="Control+, Meta+,"
            onClick={(event) => {
              closePopover(event.currentTarget);
              onSettings();
            }}
          >
            Settings
            <span className="g-menu-shortcut">{commandKey()} ,</span>
          </button>
        ) : null}
        {onAgents ? (
          <button
            type="button"
            className="g-menu-item"
            onClick={(event) => {
              closePopover(event.currentTarget);
              onAgents();
            }}
          >
            Agents
          </button>
        ) : null}
        <button
          type="button"
          className="g-menu-item"
          aria-label="Open diagnostics"
          onClick={(event) => {
            closePopover(event.currentTarget);
            onDiagnostics();
          }}
        >
          Diagnostics
        </button>
      </Popover>
    </div>
  );
}
