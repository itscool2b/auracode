/** Synthetic profile switches and cached status. No native account service or network. */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../orbit-shell.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProfileMeta } from "../bindings";
import { ProfileStatus } from "../components/chat/ProfileStatus";
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
  profileStatusFixture: {
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
      className="orbit-theme"
      data-theme="dark"
      style={{
        padding: 40,
        minHeight: "100vh",
        background: "var(--o-pane)",
        color: "var(--o-text-1)",
      }}
    >
      <h1>Workspace identity</h1>
      <section
        aria-label="Synthetic profile selection"
        style={{ display: "flex", gap: 8, marginBottom: 32 }}
      >
        {profiles.map((value) => (
          <button
            key={value.id}
            className="ui-button"
            type="button"
            onClick={() => setProfile(value)}
          >
            {value.display_name}
          </button>
        ))}
      </section>
      <aside
        aria-label="Workspace sidebar"
        style={{ width: 264, background: "var(--o-raised)", padding: 12, borderRadius: 12 }}
      >
        <ProfileStatus
          profile={profile}
          source={source}
          onSettings={() => calls.push("settings")}
          onDiagnostics={() => calls.push("diagnostics")}
        />
      </aside>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
