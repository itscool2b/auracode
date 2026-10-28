/** Synthetic UI harness. This module is loaded only by the development preview entry point. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentEntry, ProjectSummary, SetupSnapshot } from "../bindings";
import { ProjectDialog } from "../components/chat/ProjectDialog";
import { AgentsScreen } from "../components/setup/AgentsScreen";
import { Onboarding } from "../components/setup/Onboarding";
import { AppStore } from "../lib/chat/appStore";
import { FakeTransport } from "../lib/chat/testing";
import { DEFAULT_GENERAL, type SetupApi } from "../lib/setup";
import { InstallApiContext } from "../lib/setup-actions/api";
import { WorkspaceStore } from "../lib/workspace";
import { cloneFixture } from "./cloneFixture";
import { installFixture } from "./installFixture";

const install = installFixture();

const params = new URLSearchParams(location.search);
const missing = params.has("missing");
const agents: AgentEntry[] = [
  "hermes",
  "claude",
  "codex",
  "antigravity",
  "cursor",
  "grok",
  "omp",
  "opencode",
  "pi",
].map((id, index) => ({
  id,
  name:
    [
      "Hermes",
      "Claude Code",
      "Codex",
      "Antigravity",
      "Cursor",
      "Grok Build",
      "oh-my-pi",
      "OpenCode V1",
      "Pi",
    ][index] ?? id,
  description: "Synthetic detection fixture. No vendor command can run here.",
  availability:
    missing || !["claude", "codex", "pi"].includes(id)
      ? { state: "missing", reason: "Not installed in this fixture." }
      : {
          state: "ready",
          version:
            ({ claude: "2.1.310", codex: "0.162.1", pi: "0.70.0" } as Record<string, string>)[id] ??
            "1.0.0",
          path: `C:/fixture/${id}`,
        },
  launch: id,
  needs_download: false,
  last_verified: "2026-10-26",
  // Claude Code has a newer release: the Agents page's calm update line and its Update action.
  harness:
    id === "claude" && !missing
      ? {
          state: "update_available" as const,
          version: "2.1.310",
          latest: "2.1.314",
          source: "npm latest",
          checked_at: null,
        }
      : null,
}));
// `?detect` resolves one agent per detection poll, so rows can be seen settling one by one.
let resolved = params.has("detect") ? 0 : agents.length;
const detected = (): AgentEntry[] =>
  agents.map((agent, index) =>
    index < resolved ? agent : { ...agent, availability: { state: "checking" } },
  );
const transport = new FakeTransport({
  agentsList: async () => {
    const value = detected();
    resolved = Math.min(agents.length, resolved + 1);
    return value;
  },
  agentsRefresh: async () => {
    resolved = agents.length;
    return agents;
  },
  pickFolder: async () => "C:/fixture/Orbit",
});
const app = new AppStore(transport);
// `?preview=clone`, `clone-running` and `clone-error` open the first-project step on the clone,
// filled in, and started for the last two; `setup` clones to completion when asked.
const mode = params.get("preview") ?? "setup";
const cloneMode = mode.startsWith("clone");
const cloneCalls: string[] = [];
const clone = {
  api: cloneFixture(
    mode === "clone-running" ? "running" : mode === "clone-error" ? "error" : "ready",
    cloneCalls,
  ),
  draft: cloneMode
    ? {
        remote: "https://github.com/auracode/orbit",
        parent: "C:\\Users\\fixture\\code",
        start: mode !== "clone",
      }
    : undefined,
};
const initial: SetupSnapshot = {
  cold_start: !cloneMode,
  notice: null,
  preferences: {
    revision: 0,
    step: cloneMode ? "project" : "welcome",
    motion: "full",
    completed: false,
    first_project_id: null,
    general: { ...DEFAULT_GENERAL },
  },
};
// Each clone preview starts from its own saved setup, apart from the walk-through's.
const storageKey = cloneMode ? `setup-fixture-${mode}` : "setup-fixture";
let stored: SetupSnapshot = JSON.parse(
  sessionStorage.getItem(storageKey) ?? JSON.stringify(initial),
);
const persist = () => sessionStorage.setItem(storageKey, JSON.stringify(stored));
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
  setupFixture: {
    methods: () => transport.methods(),
    projects: () => projects.length,
    folders: () => projects.map((project) => project.folders[0]?.path),
    cloneCalls: () => [...cloneCalls],
  },
});

function Preview() {
  const [view, setView] = useState(
    mode === "agents" || mode === "agents-installing"
      ? "agents"
      : mode === "new-project"
        ? "new-project"
        : "setup",
  );
  const [restart, setRestart] = useState(false);
  if (view === "new-project")
    return (
      <main className="setup-shell g-root">
        <ProjectDialog
          project={null}
          store={workspace}
          transport={transport}
          agents={agents}
          cloneApi={clone.api}
          onClose={() => setView("done")}
        />
      </main>
    );
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
      clone={clone}
      onDone={() => setView("done")}
      onDemo={() => setView("demo")}
      onAccount={() => {
        setRestart(false);
        setView("account");
      }}
    />
  );
}
/** Waits for a button by its accessible name, as a person would find it, then presses it. */
async function press(name: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const button = [...document.querySelectorAll("button")].find(
      (node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === name,
    );
    if (button && !button.disabled) {
      button.click();
      return;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
}

export function mountSetupPreview(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <InstallApiContext.Provider value={install}>
        <Preview />
      </InstallApiContext.Provider>
    </StrictMode>,
  );
  // `?preview=agents-installing`: Grok Build's reviewed install, started, with npm at work.
  if (mode === "agents-installing")
    void press("Install Grok Build").then(() => press("Start installation"));
}
