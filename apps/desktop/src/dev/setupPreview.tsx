/** Synthetic UI harness. This module is loaded only by the development preview entry point. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentEntry, ProjectSummary, SetupSnapshot } from "../bindings";
import { AgentsScreen } from "../components/setup/AgentsScreen";
import { Onboarding } from "../components/setup/Onboarding";
import { AppStore } from "../lib/chat/appStore";
import { FakeTransport } from "../lib/chat/testing";
import type { SetupApi } from "../lib/setup";
import { WorkspaceStore } from "../lib/workspace";

const params = new URLSearchParams(location.search);
const missing = params.has("missing");
const agents: AgentEntry[] = [
  "claude",
  "codex",
  "pi",
  "hermes",
  "cursor",
  "grok",
  "omp",
  "opencode",
  "antigravity",
].map((id, index) => ({
  id,
  name:
    [
      "Claude Code",
      "Codex",
      "Pi",
      "Hermes",
      "Cursor",
      "Grok Build",
      "oh-my-pi",
      "OpenCode",
      "Antigravity",
    ][index] ?? id,
  description: "Synthetic detection fixture. No vendor command can run here.",
  availability:
    missing || index > 2
      ? { state: "missing", reason: "Not installed in this fixture." }
      : {
          state: "ready",
          version: ["2.1.310", "0.162.1", "0.70.0"][index] ?? "1.0.0",
          path: `C:/fixture/${id}`,
        },
  launch: id,
  needs_download: false,
  last_verified: "2026-10-26",
}));
const transport = new FakeTransport({
  agentsList: async () => agents,
  agentsRefresh: async () => agents,
  pickFolder: async () => "C:/fixture/Orbit",
});
const app = new AppStore(transport);
const initial: SetupSnapshot = {
  cold_start: true,
  notice: null,
  preferences: {
    revision: 0,
    step: "welcome",
    motion: "full",
    completed: false,
    first_project_id: null,
  },
};
let stored: SetupSnapshot = JSON.parse(
  sessionStorage.getItem("setup-fixture") ?? JSON.stringify(initial),
);
const persist = () => sessionStorage.setItem("setup-fixture", JSON.stringify(stored));
const api: SetupApi = {
  snapshot: async () => {
    const value = structuredClone(stored);
    stored.cold_start = false;
    persist();
    return value;
  },
  apply: async (revision, action) => {
    if (sessionStorage.getItem("fail-setup") === "yes")
      throw new Error("Synthetic storage is full. Setup was not saved.");
    if (revision !== stored.preferences.revision) throw new Error("Setup changed in another view.");
    const next = structuredClone(stored);
    if (action.type === "visit") next.preferences.step = action.step;
    if (action.type === "motion") next.preferences.motion = action.value;
    if (action.type === "finish") next.preferences.completed = true;
    if (action.type === "project") next.preferences.first_project_id = action.project_id;
    if (action.type === "restart") {
      next.preferences.completed = false;
      next.preferences.step = "welcome";
    }
    next.preferences.revision++;
    stored = next;
    persist();
    return structuredClone(next);
  },
};
const projects: ProjectSummary[] = [];
const unsupported = async (): Promise<never> => {
  throw new Error("Unavailable in this UI fixture.");
};
const workspace = new WorkspaceStore({
  snapshot: async () => ({ projects: [...projects], chats: [] }),
  createProject: async ({ project, folder }) => {
    const value: ProjectSummary = {
      ...project,
      id: `project-${projects.length}`,
      created_at: 0,
      updated_at: 0,
      folders: [
        {
          id: "folder",
          project_id: `project-${projects.length}`,
          display_name: project.name,
          path: folder,
          folder_state: "ok",
          unavailable_reason: null,
          kind: "local",
          git_remote_url: null,
          git_default_branch: null,
        },
      ],
    };
    projects.push(value);
    return value;
  },
  updateProject: unsupported,
  addFolder: unsupported,
  rename: unsupported,
  pin: unsupported,
  archive: unsupported,
  move: unsupported,
  preview: unsupported,
  createChat: unsupported,
});
Object.assign(window, {
  setupFixture: { methods: () => transport.methods(), projects: () => projects.length },
});

function Preview() {
  const [view, setView] = useState(params.get("preview") === "agents" ? "agents" : "setup");
  const [restart, setRestart] = useState(false);
  if (view === "account")
    return (
      <main className="setup-shell">
        <h1>Account settings</h1>
        <button type="button" onClick={() => setView("setup")}>
          Back to setup
        </button>
      </main>
    );
  if (view === "agents")
    return (
      <AgentsScreen
        app={app}
        transport={transport}
        onBack={() => setView("done")}
        onSetup={() => {
          setRestart(true);
          setView("setup");
        }}
      />
    );
  if (view === "done")
    return (
      <main className="setup-shell">
        <h1>Workspace ready</h1>
        <button type="button" onClick={() => setView("agents")}>
          Agents
        </button>
      </main>
    );
  if (view === "demo")
    return (
      <main className="setup-shell">
        <h1>Local demo</h1>
        <p>No agent process or prompt was started.</p>
      </main>
    );
  return (
    <Onboarding
      api={api}
      app={app}
      transport={transport}
      workspace={workspace}
      restart={restart}
      onDone={() => setView("done")}
      onDemo={() => setView("demo")}
      onAccount={() => {
        setRestart(false);
        setView("account");
      }}
    />
  );
}
export function mountSetupPreview(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
