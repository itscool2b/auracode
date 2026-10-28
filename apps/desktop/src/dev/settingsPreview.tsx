/** Development-only settings harness. No native process, updater, keychain or network request. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppInfo, SetupSnapshot, UpdateStatus } from "../bindings";
import { SettingsScreen } from "../components/settings/SettingsScreen";
import { accountApi } from "../lib/account/api";
import type { AccountStatus } from "../lib/account/bindings";
import { accountResetApi } from "../lib/account/reset";
import { profileApi } from "../lib/profiles";
import type { SetupApi } from "../lib/setup";
import type { UpdatesApi } from "../lib/updates";

const info: AppInfo = {
  app_version: "0.1.0",
  tauri_version: "2.12.5",
  os: "windows",
  os_version: "11",
  arch: "x86_64",
  data_dir: "C:/fixture/auracode",
  device: null,
  profile: null,
  profile_locked: false,
  profile_switching: false,
  config_profile_recovery: null,
  db: null,
  glass: "none",
  launch: { type: "normal" },
  notices: [],
  recovery_notice: null,
  fatal: null,
};
const calls: string[] = [];
// `account=ready`: an approved Account profile with two devices, for reviewing the whole page.
if (new URLSearchParams(location.search).get("account") === "ready") {
  info.profile = { id: "work", kind: "account", display_name: "Work", created_at: 2 };
  profileApi.list = async () => [
    { id: "local", kind: "local", display_name: "Local", created_at: 1 },
    { id: "work", kind: "account", display_name: "Work", created_at: 2 },
  ];
  const ready: AccountStatus = {
    access: "ready",
    account_id: "fixture",
    device_id: "this",
    profile_id: "work",
    local_key_available: true,
    approval_code: null,
    fingerprint: "1234 5678 90AB CDEF 1234 5678 90AB CDEF",
    sync: { state: "idle", last_sync_at: Date.now() - 120_000, pending_changes: 0, message: null },
  };
  accountApi.config = async () => ({
    service_origin: "https://auracode.si",
    verification_url: "https://auracode.si/verify-device",
  });
  accountApi.status = async () => structuredClone(ready);
  accountApi.cancelSetup = async () => structuredClone(ready);
  accountApi.devices = async () => [
    {
      id: "this",
      name: "Studio PC",
      platform: "windows",
      verification_code: "THIS",
      current: true,
      created_at: 1,
      last_seen: Date.now() - 60_000,
      approved_at: 1,
      revoked_at: null,
    },
    {
      id: "laptop",
      name: "MacBook Air",
      platform: "macos",
      verification_code: "LAPTOP",
      current: false,
      created_at: 1,
      last_seen: Date.now() - 86_400_000,
      approved_at: 1,
      revoked_at: null,
    },
  ];
  accountResetApi.status = async () => ({ pending: false, committed: false });
}
const signInFixture = new URLSearchParams(location.search).has("signin");
if (signInFixture) {
  const account: AccountStatus = {
    access: new URLSearchParams(location.search).has("signed-out")
      ? "signed_out"
      : "needs_first_key",
    account_id: "fixture",
    device_id: "fixture",
    profile_id: null,
    local_key_available: false,
    approval_code: null,
    fingerprint: null,
    sync: { state: "inactive", last_sync_at: null, pending_changes: null, message: null },
  };
  accountApi.config = async () => ({
    service_origin: "https://auracode.si",
    verification_url: "https://auracode.si/verify-device",
  });
  accountApi.status = async () => structuredClone(account);
  accountApi.prepareRecovery = async () => ({
    id: "fixture",
    recovery_key: "SYNTHETIC-KEY-RETAINED-ACROSS-LINKS",
  });
  accountApi.cancelSetup = async () => {
    calls.push("cancelSetup");
    return structuredClone(account);
  };
}
const preferences: SetupSnapshot = {
  cold_start: false,
  notice: null,
  preferences: {
    revision: 0,
    step: "motion",
    motion: "full",
    completed: true,
    first_project_id: null,
  },
};
const setup: SetupApi = {
  snapshot: async () => structuredClone(preferences),
  apply: async (revision, action) => {
    calls.push("save");
    if (sessionStorage.getItem("settings-fail-save"))
      throw new Error("Preferences could not be saved. Your previous setting is unchanged.");
    if (revision !== preferences.preferences.revision)
      throw new Error("Preferences changed. Reload and retry.");
    if (action.type === "motion") preferences.preferences.motion = action.value;
    preferences.preferences.revision++;
    return structuredClone(preferences);
  },
};
let status: UpdateStatus = {
  channel: new URLSearchParams(location.search).has("staging") ? "staging" : "stable",
  phase: new URLSearchParams(location.search).has("unsigned") ? "disabled" : "idle",
  version: null,
  notes: null,
  downloaded_bytes: 0,
  total_bytes: null,
  message: null,
};
const updates: UpdatesApi = {
  status: async () => {
    calls.push("status");
    return structuredClone(status);
  },
  check: async () => {
    calls.push("check");
    status = {
      ...status,
      phase: "available",
      version: "0.2.0",
      notes: "Synthetic update fixture. No release is downloaded.",
    };
    return structuredClone(status);
  },
  download: async () => {
    calls.push("download");
    status = { ...status, phase: "downloading", total_bytes: 2048, downloaded_bytes: 1024 };
    await new Promise((done) => setTimeout(done, 800));
    status = { ...status, phase: "ready", downloaded_bytes: 2048 };
    return structuredClone(status);
  },
  install: async () => {
    calls.push("install");
    status = {
      ...status,
      phase: "waiting_for_idle",
      message: "A project terminal is open. Close it, then retry when ready.",
    };
    return structuredClone(status);
  },
};
Object.assign(window, {
  settingsFixture: { calls: () => [...calls], motion: () => preferences.preferences.motion },
});
function Preview() {
  const [closed, setClosed] = useState(false);
  const [entry, setEntry] = useState({ id: 0, email: "first@example.com" });
  Object.assign(window, {
    settingsNavigationFixture: {
      open: (email: string) => setEntry((previous) => ({ id: previous.id + 1, email })),
    },
  });
  if (closed)
    return (
      <main className="g-root">
        <h1>Back to workspace</h1>
      </main>
    );
  return (
    <SettingsScreen
      navigationId={String(entry.id)}
      initialPage={signInFixture ? "account" : "general"}
      initialEmail={signInFixture ? entry.email : ""}
      info={info}
      setup={setup}
      updates={updates}
      reveal={async () => {
        calls.push("reveal");
      }}
      onBack={() => setClosed(true)}
      onAgents={() => {
        calls.push("agents");
      }}
      onSetup={() => {
        calls.push("setup");
      }}
      onDiagnostics={() => {
        calls.push("diagnostics");
      }}
    />
  );
}
export function mountSettingsPreview(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
