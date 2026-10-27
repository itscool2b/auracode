import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RebindProfilePanel } from "../components/settings/RebindProfilePanel";
import { RemoveAccountPanel } from "../components/settings/RemoveAccountPanel";
import { ResetSyncPanel } from "../components/settings/ResetSyncPanel";
import type { AccountStatus } from "../lib/account/bindings";
import type { AccountRebindApi } from "../lib/account/rebind";
import type { AccountRemovalApi } from "../lib/account/removal";
import type { AccountResetApi } from "../lib/account/reset";
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../shell.css";
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
  const [localActive, setLocalActive] = useState(mode !== "remove-account");
  const [removalCalls, setRemovalCalls] = useState({ list: 0, preview: 0, apply: 0, cancel: 0 });
  const [removalApi] = useState<AccountRemovalApi>(() => {
    let pending = false;
    let removed = false;
    let attempts = 0;
    return {
      list: async () => {
        setRemovalCalls((value) => ({ ...value, list: value.list + 1 }));
        return removed
          ? []
          : [{ profile_id: "synthetic-profile", display_name: "Retained account", pending }];
      },
      preview: async (profile_id) => {
        setRemovalCalls((value) => ({ ...value, preview: value.preview + 1 }));
        return {
          token: "synthetic-review",
          profile_id,
          display_name: "Retained account",
          other_profiles: 1,
          pending_changes: null,
          resuming: pending,
        };
      },
      apply: async (token, confirmation) => {
        if (token !== "synthetic-review" || confirmation !== "REMOVE")
          throw new Error("Review required");
        setRemovalCalls((value) => ({ ...value, apply: value.apply + 1 }));
        if (++attempts === 1) {
          pending = true;
          throw new Error("Removal did not finish. Review the pending removal to continue.");
        }
        pending = false;
        removed = true;
        return { ...initial, access: "signed_out" };
      },
      cancel: async () => {
        setRemovalCalls((value) => ({ ...value, cancel: value.cancel + 1 }));
        pending = false;
        return initial;
      },
    };
  });
  const [calls, setCalls] = useState({ review: 0, confirm: 0, retry: 0, cancel: 0 });
  const [rebindCalls, setRebindCalls] = useState({ list: 0, restore: 0 });
  const [rebindApi] = useState<AccountRebindApi>(() => {
    let attempts = 0;
    return {
      list: async () => {
        setRebindCalls((value) => ({ ...value, list: value.list + 1 }));
        return [
          {
            id: "synthetic-profile",
            kind: "account",
            display_name: "Retained account",
            created_at: 1,
          },
          { id: "local", kind: "local", display_name: "Local", created_at: 1 },
        ];
      },
      restore: async (id) => {
        setRebindCalls((value) => ({ ...value, restore: value.restore + 1 }));
        if (++attempts === 1)
          throw new Error("The key does not match. Existing files were preserved.");
        return { ...initial, access: "ready", profile_id: id, local_key_available: true };
      },
    };
  });
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
        {mode?.startsWith("remove") ? (
          <RemoveAccountPanel
            api={removalApi}
            localActive={localActive}
            onLocal={async () => setLocalActive(true)}
            onStatus={setStatus}
          />
        ) : mode === "rebind" ? (
          <RebindProfilePanel api={rebindApi} onStatus={setStatus} />
        ) : (
          <ResetSyncPanel
            api={api}
            access={status.access}
            allowReview={!status.local_key_available}
            onStatus={setStatus}
          />
        )}
        <output aria-label="Rebind calls">{JSON.stringify(rebindCalls)}</output>
        <output aria-label="Removal calls">{JSON.stringify(removalCalls)}</output>
        <output aria-label="Bound profile">{status.profile_id}</output>
        <output aria-label="Reset calls">{JSON.stringify(calls)}</output>
        <output aria-label="Account access">{status.access}</output>
      </div>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
