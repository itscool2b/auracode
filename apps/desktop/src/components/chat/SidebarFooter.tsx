import { Logo } from "@auracode/ui/graphite";
import { Settings } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { ProfileMeta } from "../../bindings";
import type { AccountSyncStatus } from "../../lib/account/bindings";
import {
  type AccountSyncSource,
  accountSyncSource,
  observeAccountSync,
  syncStatusLabel,
} from "../../lib/account/sync";
import { commandKey } from "./Keys";

/**
 * The foot of the sidebar, as calm as Grok's: the logo, the notifications bell and one Settings
 * button. Profiles, sync, agents and diagnostics live in Settings and the command palette. The one
 * thing that still shows here is an account whose sync needs a hand: a small dot on the button,
 * named in its label.
 */
export function SidebarFooter({
  profile,
  onSettings,
  notifications,
  source = accountSyncSource,
}: {
  readonly profile: ProfileMeta | null;
  readonly onSettings?: () => void;
  /** The notifications bell (`Notifications`), beside Settings. */
  readonly notifications?: ReactNode;
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
  // A status cached for another profile never shows for this one.
  const status = accountId !== null && cached?.id === accountId ? cached.value : null;
  const attention = status?.state === "error" || status?.state === "paused";
  return (
    <div className="chat-sidebar-footer">
      <Logo size={24} className="chat-sidebar-footer-logo" />
      <div className="chat-sidebar-footer-actions">
        {notifications}
        {onSettings ? (
          <button
            type="button"
            className="g-button g-button-ghost g-button-icon g-button-28 chat-sidebar-settings"
            aria-label={
              attention
                ? `Open settings, ${syncStatusLabel(status).toLowerCase()}`
                : "Open settings"
            }
            aria-keyshortcuts="Control+, Meta+,"
            data-tip={`Settings (${commandKey()} ,)`}
            data-attention={attention ? "" : undefined}
            data-testid="sidebar-settings"
            onClick={onSettings}
          >
            <Settings size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
