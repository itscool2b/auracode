import { Cloud, HardDrive, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProfileMeta } from "../../bindings";
import type { AccountSyncStatus } from "../../lib/account/bindings";
import {
  type AccountSyncSource,
  accountSyncSource,
  observeAccountSync,
} from "../../lib/account/sync";
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

export function ProfileStatus({
  profile,
  onSettings,
  onDiagnostics,
  source = accountSyncSource,
}: {
  readonly profile: ProfileMeta | null;
  readonly onSettings?: () => void;
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
  const Icon = accountId ? Cloud : HardDrive;
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
  return (
    <div className="chat-account-row" data-profile-kind={profile?.kind ?? "unavailable"}>
      <span className="chat-account-avatar" aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="chat-account-identity">
        <strong title={profile?.display_name}>{profile?.display_name ?? "Workspace"}</strong>
        <small role="status" aria-live="polite" aria-atomic="true" title={detail}>
          {label}
        </small>
      </span>
      <button
        type="button"
        className="chat-icon-button"
        aria-label={onSettings ? "Open settings" : "Open diagnostics"}
        title={onSettings ? "Settings" : "Diagnostics"}
        onClick={(event) => {
          event.currentTarget.focus();
          (onSettings ?? onDiagnostics)();
        }}
      >
        <Settings2 size={16} />
      </button>
    </div>
  );
}
