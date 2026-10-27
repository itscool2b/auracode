/** Synthetic account transitions. This harness never calls the network, vault or native commands. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountPanel } from "../components/settings/AccountPanel";
import { type AccountApi, AccountCommandError } from "../lib/account/api";
import type { AccountDevice, AccountStatus, AccountSyncStatus } from "../lib/account/bindings";
import type { subscribeAccountSync } from "../lib/account/sync";
import "../components/settings/settings.css";

const stage = new URLSearchParams(location.search).get("stage");
const startsReady = ["ready-restricted", "sync-restricted", "sync-stale"].includes(stage ?? "");
const hasRetainedKey = startsReady || stage === "deleted" || stage === "restricted";
const calls: string[] = [];
const listeners = new Set<{ profile: string | null; update: (sync: AccountSyncStatus) => void }>();
const subscribeSync: typeof subscribeAccountSync = (profile, update) => {
  const listener = { profile, update };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
let holdStatus = false;
const pendingStatus: (() => void)[] = [];
let reinvited = false;
let state: AccountStatus = {
  access: startsReady
    ? "ready"
    : stage === "restricted"
      ? "invite_required"
      : stage === "deleted"
        ? "deleted"
        : stage === "pending"
          ? "pending_approval"
          : "signed_out",
  account_id: "fixture-account",
  device_id: "fixture-device",
  profile_id: hasRetainedKey ? "fixture-profile" : null,
  local_key_available: hasRetainedKey,
  approval_code: "THIS-DEVICE-1234",
  fingerprint: "1234 5678 90AB CDEF 1234 5678 90AB CDEF",
  sync: {
    state: "inactive",
    pending_changes: stage === "pending" ? 3 : null,
    last_sync_at: null,
    message: "Select the Account profile to sync.",
  },
};
const devices: AccountDevice[] = [
  {
    id: "fixture-device",
    name: "Current computer",
    platform: "windows",
    verification_code: "THIS-DEVICE-1234",
    current: true,
    created_at: 1,
    last_seen: 1,
    approved_at: 1,
    revoked_at: null,
  },
  {
    id: "recipient",
    name: "Other computer",
    platform: "macos",
    verification_code: "RECIPIENT-8392",
    current: false,
    created_at: 1,
    last_seen: 1,
    approved_at: null,
    revoked_at: null,
  },
];
const next = (access: AccountStatus["access"]) => {
  state = {
    ...state,
    access,
    local_key_available: access === "ready",
    profile_id: access === "ready" ? "fixture-profile" : null,
  };
  return structuredClone(state);
};
let prepared = false;
let verified = false;
let registered = stage === "pending";
const invitationError = () =>
  new AccountCommandError({
    code: "invite_required",
    message:
      "Cloud accounts, sync and transfers are invite-only during private preview. Local use remains free and works offline.",
    retry_after_seconds: null,
  });
const api: AccountApi = {
  config: async () => ({
    service_origin: "https://auracode.si",
    verification_url: "https://auracode.si/verify-device",
  }),
  status: async () => {
    calls.push("status");
    const value = structuredClone(state);
    if (holdStatus) return new Promise((resolve) => pendingStatus.push(() => resolve(value)));
    return value;
  },
  requestCode: async (_email, proof) => {
    if (proof !== "synthetic-proof") throw new Error("Verification proof is required.");
    if (stage === "invite-request") throw invitationError();
    return { id: "fixture-challenge", expires_in: 600, resend_after: 1 };
  },
  verifyCode: async (_challenge, code) => {
    if (stage === "invite-verify") throw invitationError();
    if (code !== "123456") throw new Error("That code is invalid.");
    verified = true;
    return next("verification_required");
  },
  refresh: async () => {
    calls.push("refresh");
    if (stage === "restricted") throw invitationError();
    if (startsReady) {
      reinvited = true;
      return next("ready");
    }
    return next(registered ? "verify_account_key" : verified ? "needs_device" : "signed_out");
  },
  register: async () => {
    registered = true;
    return next("needs_first_key");
  },
  prepareRecovery: async () => {
    prepared = true;
    return { id: "fixture-setup", recovery_key: "SYNTHETIC-RECOVERY-KEY-FOR-UI-TESTS" };
  },
  confirmRecovery: async () => {
    if (!prepared) throw new Error("Recovery setup expired.");
    prepared = false;
    return next("ready");
  },
  cancelSetup: async () => {
    prepared = false;
    return structuredClone(state);
  },
  recover: async (key) => {
    if (key !== "SYNTHETIC-RECOVERY-KEY-FOR-UI-TESTS")
      throw new Error("Recovery key does not match.");
    return next("ready");
  },
  confirmFingerprint: async (value) => {
    if (value !== state.fingerprint) throw new Error("Fingerprint does not match.");
    return next("ready");
  },
  devices: async () => {
    calls.push("devices");
    if (stage === "ready-restricted" && !reinvited) {
      state = { ...state, access: "invite_required" };
      throw invitationError();
    }
    return structuredClone(devices);
  },
  approve: async (id, code) => {
    if (id !== "recipient" || code !== "RECIPIENT-8392")
      throw new Error("The recipient code does not match. Compare it on the other device.");
    const recipient = devices.find((device) => device.id === id);
    if (!recipient) throw new Error("Unknown fixture device.");
    recipient.approved_at = Date.now();
    return next("ready");
  },
  revoke: async (id) => {
    const device = devices.find((item) => item.id === id);
    if (!device) throw new Error("Unknown fixture device.");
    device.revoked_at = Date.now();
    return next(device.current ? "denied" : "ready");
  },
  signOut: async () => ({ status: next("signed_out"), server_revoked: true }),
};
Object.assign(window, {
  accountAccessFixture: {
    calls: () => [...calls],
    restrictSync: (profile = "fixture-profile") => {
      state = {
        ...state,
        access: "invite_required",
        sync: { ...state.sync, state: "paused", message: invitationError().message },
      };
      holdStatus = stage === "sync-stale";
      for (const listener of listeners)
        if (listener.profile === profile) listener.update(state.sync);
    },
    releaseStatus: () => {
      holdStatus = false;
      for (const resolve of pendingStatus.splice(0)) resolve();
    },
  },
});
function Verification({ onToken }: { readonly onToken: (value: string) => void }) {
  return (
    <button
      className="g-button g-button-28"
      type="button"
      onClick={() => onToken("synthetic-proof")}
    >
      Complete synthetic verification
    </button>
  );
}
function Preview() {
  const [open, setOpen] = useState(true);
  return (
    <main className="settings-shell g-root">
      <div className="settings-main">
        <div className="settings-content">
          <header>
            <h1>Account</h1>
            <p>Profiles, sign-in, devices and recovery.</p>
          </header>
          {open ? (
            <AccountPanel
              api={api}
              deviceName="Current computer"
              Verification={Verification}
              activeProfileId={new URLSearchParams(location.search).get("active")}
              subscribeSync={subscribeSync}
            />
          ) : (
            <p>Account closed.</p>
          )}
          <button className="g-button g-button-ghost" type="button" onClick={() => setOpen(!open)}>
            {open ? "Close account" : "Open account"}
          </button>
        </div>
      </div>
    </main>
  );
}
export function mountAccountPreview(container: HTMLElement) {
  createRoot(container).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
