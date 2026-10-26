/** Synthetic recovery only. This entry never opens a native account or configuration store. */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../orbit-shell.css";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppInfo, ConfigProfileRecovery } from "../bindings";
import { AccountPanel } from "../components/settings/AccountPanel";
import { ConfigurationRecovery } from "../components/settings/ConfigurationRecovery";
import type { AccountApi } from "../lib/account/api";
import type { AccountStatus } from "../lib/account/bindings";

function AuthPreview({ mode }: { readonly mode: string }) {
  const [forbidden, setForbidden] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const api = useMemo(() => {
    let status: AccountStatus = {
      access:
        mode === "auth-pending"
          ? "pending_approval"
          : mode === "auth-new"
            ? "needs_first_key"
            : "ready",
      account_id: "fixture-account",
      device_id: "fixture-device",
      profile_id:
        mode === "auth-wrong" ? "other-profile" : mode === "auth-ready" ? "owner-profile" : null,
      local_key_available: mode === "auth-ready",
      approval_code: "123456",
      fingerprint: null,
      sync: { state: "paused", pending_changes: null, last_sync_at: null, message: null },
    };
    return new Proxy(
      {
        config: async () => ({
          service_origin: "https://auracode.si",
          verification_url: "https://auracode.si/verify-device",
        }),
        status: async () => status,
        recover: async () => {
          status = {
            ...status,
            access: "ready",
            profile_id: "owner-profile",
            local_key_available: true,
          };
          return status;
        },
      },
      {
        get(target, name) {
          if (name in target) return target[name as keyof typeof target];
          return async () => {
            setForbidden((value) => value + 1);
            throw new Error("Unexpected management call in recovery-only UI.");
          };
        },
      },
    ) as AccountApi;
  }, [mode]);
  return (
    <main className="orbit-theme settings-content">
      <h1>Recover account access</h1>
      <AccountPanel
        api={api}
        recoveryOnly
        recoveryProfileId="owner-profile"
        onActivate={async () => setUnlocked(true)}
        Verification={() => <span>Fixture verification</span>}
      />
      <output aria-label="Forbidden account calls" hidden>
        {forbidden}
      </output>
      {unlocked ? <p role="status">Selected account unlocked</p> : null}
    </main>
  );
}

function Preview() {
  const mode = new URLSearchParams(location.search).get("case");
  const [calls, setCalls] = useState(0);
  const [done, setDone] = useState(false);
  const recovery: ConfigProfileRecovery = {
    transaction: "fixture",
    owner_profile: "account",
    from_profile: "local",
    to_profile: "account",
    phase:
      mode === "unavailable"
        ? "unavailable"
        : mode === "finish"
          ? "finish_switch"
          : "restore_previous",
    detail:
      "A configuration switch was interrupted. Restore the previous profile's managed configuration before continuing.",
  };
  return done ? (
    <main className="orbit-theme settings-content">
      <h1>Recovery confirmed</h1>
    </main>
  ) : (
    <>
      <ConfigurationRecovery
        recovery={recovery}
        locked={mode === "locked"}
        onRecovered={() => setDone(true)}
        recoverConfiguration={async () => {
          setCalls((value) => value + 1);
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (mode === "conflict")
            throw new Error("A managed setting changed. Existing files were preserved.");
          return { config_profile_recovery: null } as AppInfo;
        }}
      />
      <output aria-label="Recovery calls" hidden>
        {calls}
      </output>
    </>
  );
}
const root = document.getElementById("root");
const mode = new URLSearchParams(location.search).get("case") ?? "";
if (root)
  createRoot(root).render(mode.startsWith("auth-") ? <AuthPreview mode={mode} /> : <Preview />);
