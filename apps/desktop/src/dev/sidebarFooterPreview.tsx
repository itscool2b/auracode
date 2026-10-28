/** The production sidebar footer with synthetic profile switches and cached sync status only. */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../shell.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProfileMeta } from "../bindings";
import { SidebarFooter } from "../components/chat/SidebarFooter";
import type { AccountSyncStatus } from "../lib/account/bindings";
import type { AccountSyncSource } from "../lib/account/sync";

const profiles: ProfileMeta[] = [
  { id: "local", kind: "local", display_name: "Local", created_at: 1 },
  { id: "work", kind: "account", display_name: "Work account", created_at: 1 },
  { id: "personal", kind: "account", display_name: "Personal account", created_at: 1 },
];
const calls: string[] = [];
const listeners: { id: string; update: (value: AccountSyncStatus) => void }[] = [];
const reads: ((value: [string, AccountSyncStatus] | null) => void)[] = [];
const source: AccountSyncSource = {
  subscribe: (id, update, ready) => {
    calls.push(`subscribe:${id}`);
    listeners.push({ id: id ?? "", update });
    ready?.();
    return () => calls.push(`stop:${id}`);
  },
  snapshot: () => {
    calls.push("snapshot");
    return new Promise((resolve) => reads.push(resolve));
  },
};
const status = (state: AccountSyncStatus["state"], pending = 0): AccountSyncStatus => ({
  state,
  pending_changes: pending,
  last_sync_at: 1_700_000_000_000,
  message:
    state === "paused" ? "Sign in again to resume sync. Saved work remains on this device." : null,
});
Object.assign(window, {
  sidebarFooterFixture: {
    calls: () => [...calls],
    resolve: (index: number, id: string) => reads[index]?.([id, status("idle")]),
    event: (id: string, state: AccountSyncStatus["state"], pending: number) => {
      for (const listener of listeners)
        if (listener.id === id) listener.update(status(state, pending));
    },
  },
});
function Fixture() {
  const [profile, setProfile] = useState(profiles[0] ?? null);
  return (
    <main
      className="g-root"
      data-theme="dark"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 32,
        padding: 40,
        minHeight: "100vh",
        boxSizing: "border-box",
        background: "var(--g-bg)",
        color: "var(--g-fg-1)",
      }}
    >
      <h1>Sidebar footer</h1>
      <section aria-label="Synthetic profile selection" style={{ display: "flex", gap: 8 }}>
        {profiles.map((value) => (
          <button
            key={value.id}
            className="g-button"
            type="button"
            onClick={() => setProfile(value)}
          >
            {value.display_name}
          </button>
        ))}
      </section>
      <aside
        className="chat-sidebar"
        aria-label="Sidebar"
        style={{ width: 264, height: 160, boxSizing: "border-box", paddingTop: 0 }}
      >
        <div style={{ flex: 1 }} />
        <SidebarFooter
          profile={profile}
          source={source}
          onSettings={() => calls.push("settings")}
        />
      </aside>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
