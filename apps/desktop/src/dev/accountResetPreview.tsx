import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ResetSyncPanel } from "../components/settings/ResetSyncPanel";
import type { AccountStatus } from "../lib/account/bindings";
import type { AccountResetApi } from "../lib/account/reset";
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../orbit-shell.css";
import "../components/settings/settings.css";
import "../components/settings/account.css";

const mode = new URLSearchParams(location.search).get("mode");
const initial: AccountStatus = {
  access: mode === "committed" ? "ready" : "pending_approval",
  account_id: "synthetic",
  device_id: "synthetic",
  profile_id: null,
  local_key_available: mode === "committed",
  approval_code: "123456",
  fingerprint: null,
  sync: { state: "inactive", pending_changes: null, last_sync_at: null, message: null },
};
function Preview() {
  const [status, setStatus] = useState(initial);
  const [calls, setCalls] = useState({ review: 0, confirm: 0, retry: 0, cancel: 0 });
  const [api] = useState<AccountResetApi>(() => {
    let pending = mode === "pending" || mode === "committed";
    return {
      status: async () => ({ pending, committed: mode === "committed" }),
      review: async () => {
        setCalls((value) => ({ ...value, review: value.review + 1 }));
        return {
          id: "synthetic-review",
          key_version: 8,
          records: 12,
          blobs: 3,
          other_devices: 2,
          recovery_key: "SYNTHETIC-RESET-RECOVERY-KEY",
        };
      },
      confirm: async (id, confirmation, retained) => {
        if (id !== "synthetic-review" || confirmation !== "RESET SYNC" || !retained)
          throw new Error("Explicit confirmation required.");
        pending = true;
        setCalls((value) => ({ ...value, confirm: value.confirm + 1 }));
        throw new Error("The response was unavailable. Your new key and request are retained.");
      },
      retry: async () => {
        setCalls((value) => ({ ...value, retry: value.retry + 1 }));
        pending = false;
        return { ...initial, access: "ready", local_key_available: true };
      },
      cancel: async () => {
        setCalls((value) => ({ ...value, cancel: value.cancel + 1 }));
        pending = false;
        return { ...initial, access: "verification_required" };
      },
      dismiss: async () => initial,
    };
  });
  return (
    <main
      className="orbit-theme settings-shell"
      data-theme="dark"
      style={{ display: "block", padding: 48, overflow: "auto" }}
    >
      <div className="account-panel">
        <h1>Account recovery</h1>
        <h2>Your account</h2>
        <ResetSyncPanel
          api={api}
          access={status.access}
          allowReview={!status.local_key_available}
          onStatus={setStatus}
        />
        <output aria-label="Reset calls">{JSON.stringify(calls)}</output>
        <output aria-label="Account access">{status.access}</output>
      </div>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
