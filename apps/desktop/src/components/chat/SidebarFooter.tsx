import { Logo } from "@auracode/ui/graphite";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { commandKey } from "./Keys";

/**
 * The foot of the sidebar, as calm as Grok's: the logo, the notifications bell and one Settings
 * button. Profiles, agents and diagnostics live in Settings and the command palette.
 */
export function SidebarFooter({
  onSettings,
  notifications,
}: {
  readonly onSettings?: () => void;
  /** The notifications bell (`Notifications`), beside Settings. */
  readonly notifications?: ReactNode;
}) {
  return (
    <div className="chat-sidebar-footer">
      <Logo size={24} className="chat-sidebar-footer-logo" />
      <div className="chat-sidebar-footer-actions">
        {notifications}
        {onSettings ? (
          <button
            type="button"
            className="g-button g-button-ghost g-button-icon g-button-28 chat-sidebar-settings"
            aria-label="Open settings"
            aria-keyshortcuts="Control+, Meta+,"
            data-tip={`Settings (${commandKey()} ,)`}
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
