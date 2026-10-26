/** Development-only settings harness. No native process, updater, keychain or network request. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppInfo, SetupSnapshot, UpdateStatus } from "../bindings";
import { SettingsScreen } from "../components/settings/SettingsScreen";
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
  if (closed)
    return (
      <main className="orbit-theme" data-theme="dark">
        <h1>Back to workspace</h1>
      </main>
    );
  return (
    <SettingsScreen
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
