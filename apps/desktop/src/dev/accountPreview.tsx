/** Synthetic account transitions. This harness never calls the network, vault or native commands. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountPanel } from "../components/settings/AccountPanel";
import type { AccountApi } from "../lib/account/api";
import type { AccountDevice, AccountStatus } from "../lib/account/bindings";
import "../components/settings/settings.css";

const stage = new URLSearchParams(location.search).get("stage");
let state: AccountStatus = {
  access: stage === "pending" ? "pending_approval" : "signed_out",
  account_id: "fixture-account",
  device_id: "fixture-device",
  profile_id: null,
  local_key_available: false,
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
const api: AccountApi = {
  config: async () => ({
    service_origin: "https://auracode.si",
    verification_url: "https://auracode.si/verify-device",
  }),
  status: async () => structuredClone(state),
  requestCode: async (_email, proof) => {
    if (proof !== "synthetic-proof") throw new Error("Verification proof is required.");
    return { id: "fixture-challenge", expires_in: 600, resend_after: 1 };
  },
  verifyCode: async (_challenge, code) => {
    if (code !== "123456") throw new Error("That code is invalid.");
    verified = true;
    return next("verification_required");
  },
  refresh: async () =>
    next(registered ? "verify_account_key" : verified ? "needs_device" : "signed_out"),
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
  devices: async () => structuredClone(devices),
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
function Verification({ onToken }: { readonly onToken: (value: string) => void }) {
  return (
    <button className="ui-button" type="button" onClick={() => onToken("synthetic-proof")}>
      Complete synthetic verification
    </button>
  );
}
function Preview() {
  const [open, setOpen] = useState(true);
  return (
    <main
      className="orbit-theme settings-shell"
      data-theme="dark"
      style={{ display: "block", overflow: "auto", padding: "36px 72px" }}
    >
      <div style={{ maxWidth: 650, margin: "0 auto" }}>
        <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: -1 }}>Account</h1>
        {open ? (
          <AccountPanel api={api} deviceName="Current computer" Verification={Verification} />
        ) : (
          <p>Account closed.</p>
        )}
        <button className="ui-button" type="button" onClick={() => setOpen(!open)}>
          {open ? "Close account" : "Open account"}
        </button>
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
