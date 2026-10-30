/**
 * Development-only Plugin library fixtures. They read no native configuration, run no agent and
 * no CLI. Modes: `plugins` (Claude Code's live listings), `plugins-pi` (an agent without a plugin
 * system), `plugins-update` (an update is available and the version changed), `plugins-failed`
 * (Codex's CLI listing failed and its files answer instead).
 */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../shell.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { AgentPlugins, FeatureListing, PluginEntry, PluginLibrary } from "../bindings";
import { PluginLibraryScreen } from "../components/library/PluginLibraryScreen";
import type { LibraryApi } from "../lib/library/api";
import type { LibraryItem } from "../lib/library/bindings";
import type { PluginsApi } from "../lib/plugins/api";
import { syntheticVendor } from "./configSyncPreview";

declare global {
  interface Window {
    pluginsFixture: {
      calls: string[];
      finishProvider?: (agentId: string) => void;
      finish?: () => void;
      unmount?: () => void;
    };
  }
}

const NOW = Date.UTC(2026, 9, 28, 12, 0);

const entry = (key: string, extra: Partial<PluginEntry> = {}): PluginEntry => ({
  key,
  label: key.split("@")[0] ?? key,
  description: null,
  version: null,
  marketplace: key.includes("@") ? (key.split("@")[1] ?? null) : null,
  scope: "user",
  enabled: null,
  installed: true,
  kind: null,
  local_fields: [],
  library: null,
  ...extra,
});

const files = (
  feature: FeatureListing["feature"],
  reason: string,
  entries: PluginEntry[],
): FeatureListing => ({
  feature,
  state: { state: "files", reason },
  command: null,
  entries,
  available: [],
  available_total: 0,
});

const SKILLS = "No CLI lists skills, so these come from the agent's skills folder.";
const FOLDER = "The CLI has no listing for these, so they come from the agent's folder.";

export function pluginFixture(mode: string): PluginLibrary {
  const available = [
    ["frontend-design", "Frontend design skill for UI and UX work"],
    ["security-review", "Reviews a change for security issues before merge"],
    ["release-notes", "Drafts release notes from merged pull requests"],
  ].map(([name, description]) =>
    entry(`${name}@anthropic-plugin-directory`, {
      description: description ?? null,
      installed: false,
      version: "1.2.0",
      kind: "git-subdir",
    }),
  );
  const claude: AgentPlugins = {
    agent_id: "claude",
    name: "Claude Code",
    installed: true,
    version: "2.1.312",
    system: "marketplace",
    summary:
      "Plugins from marketplaces, plus skills, MCP servers, slash commands, subagents and hooks.",
    harness:
      mode === "plugins-update"
        ? {
            state: "update_available",
            version: "2.1.312",
            latest: "2.1.314",
            source: "npm latest",
            checked_at: NOW - 3_600_000,
          }
        : { state: "up_to_date", version: "2.1.312", checked_at: NOW - 3_600_000 },
    updated_at: NOW - 4 * 60_000,
    version_change: mode === "plugins-update" ? { from: "2.1.310", to: "2.1.312" } : null,
    sync: { state: "on" },
    notices: [],
    features: [
      {
        feature: "plugins",
        state: { state: "live" },
        command: "claude plugin list --json --available",
        entries: [
          entry("tools@team", { version: "1.0.0", enabled: true }),
          entry("review-kit@team", { version: "0.4.1", enabled: false }),
        ],
        available,
        available_total: 3599,
      },
      {
        feature: "marketplaces",
        state: { state: "live" },
        command: "claude plugin marketplace list --json",
        entries: [entry("team", { description: "owner/plugins", kind: "github" })],
        available: [],
        available_total: 0,
      },
      files("skills", SKILLS, [
        entry("review-changes", {
          library: {
            source_id: "user:claude",
            kind: "skill",
            key: "review-changes",
            revision: "synthetic",
          },
        }),
      ]),
      files(
        "mcp_servers",
        "`claude mcp list` connects to every server to check it, so these come from ~/.claude.json.",
        [entry("docs", { kind: "http" })],
      ),
      files("commands", FOLDER, [entry("ship"), entry("team:review")]),
      files("subagents", FOLDER, [entry("reviewer")]),
      files("hooks", FOLDER, [entry("PreToolUse")]),
    ],
  };
  const codex: AgentPlugins = {
    agent_id: "codex",
    name: "Codex",
    installed: true,
    version: "0.162.1",
    system: "marketplace",
    summary: "Plugins from marketplaces, plus MCP servers, skills, subagents and hooks.",
    harness: {
      state: "unknown",
      version: "0.162.1",
      reason:
        "GitHub stable release did not answer. You may be offline; auracode checks again later.",
    },
    updated_at: NOW - 60_000,
    version_change: null,
    sync: { state: "on" },
    notices: [],
    features: [
      {
        feature: "plugins",
        state: {
          state: "failed",
          reason: "`codex plugin list --json --available` failed: marketplace cache is corrupt.",
        },
        command: "codex plugin list --json --available",
        entries: [entry("tools@local-team", { kind: null })],
        available: [],
        available_total: 0,
      },
      {
        feature: "marketplaces",
        state: { state: "live" },
        command: "codex plugin marketplace list --json",
        entries: [entry("local-team", { kind: "local" })],
        available: [],
        available_total: 0,
      },
      {
        feature: "mcp_servers",
        state: { state: "live" },
        command: "codex mcp list --json",
        entries: [
          entry("private", {
            kind: "stdio",
            description: "node",
            enabled: true,
            local_fields: ["env/TOKEN"],
          }),
        ],
        available: [],
        available_total: 0,
      },
      files("skills", SKILLS, []),
      files("subagents", FOLDER, []),
      files("hooks", FOLDER, [entry("SessionStart")]),
    ],
  };
  const pi: AgentPlugins = {
    agent_id: "pi",
    name: "Pi",
    installed: true,
    version: "1.0.2",
    system: "packages",
    summary:
      "Pi has no plugin marketplace. It installs packages from npm or git, and reads skills, MCP servers and prompt templates from its folder.",
    harness: { state: "up_to_date", version: "1.0.2", checked_at: NOW - 7_200_000 },
    updated_at: NOW - 2 * 60_000,
    version_change: null,
    sync: { state: "off" },
    notices: [],
    features: [
      {
        feature: "packages",
        state: { state: "live" },
        command: "pi list --no-approve",
        entries: [
          entry("npm:pi-tools@1.0.0", { label: "npm:pi-tools@1.0.0", kind: "npm" }),
          entry("git:github.com/team/pi-ext@v1.2.0", {
            label: "git:github.com/team/pi-ext@v1.2.0",
            marketplace: null,
            kind: "git",
            description: "Some resources are filtered",
          }),
        ],
        available: [],
        available_total: 0,
      },
      files("skills", SKILLS, [entry("release-check")]),
      files(
        "mcp_servers",
        "`pi mcp list` starts every server to check it, so these come from mcp.json.",
        [],
      ),
      files("commands", FOLDER, [entry("release")]),
    ],
  };
  const opencode: AgentPlugins = {
    agent_id: "opencode",
    name: "OpenCode",
    installed: false,
    version: null,
    system: "declared",
    summary:
      "OpenCode loads npm plugins named in its config and local plugin files, plus MCP servers, skills, commands and agents.",
    harness: { state: "not_installed" },
    updated_at: null,
    version_change: null,
    sync: { state: "unsupported", reason: "Configuration sync covers Claude Code, Codex and Pi." },
    notices: [],
    features: [
      files(
        "plugins",
        "OpenCode installs its plugins and checks its servers whenever it runs, so auracode reads ~/.config/opencode instead.",
        [],
      ),
    ],
  };
  return {
    agents: [claude, codex, pi, opencode],
    notices: [
      "Cursor, Grok Build, Antigravity and Hermes are not listed: auracode has no reviewed way to read their extensions yet.",
    ],
  };
}

export function mountPluginLibraryPreview(container: HTMLElement, mode: string) {
  window.pluginsFixture = { calls: [] };
  const calls = window.pluginsFixture.calls;
  const complete = pluginFixture(mode);
  let library = complete;
  const pending: {
    update: (value: PluginLibrary) => void;
    resolve: (value: PluginLibrary) => void;
  }[] = [];
  if (mode === "plugins-progressive") {
    library = {
      ...complete,
      agents: complete.agents.map((agent) => ({
        ...agent,
        installed: agent.agent_id === "pi" ? false : agent.installed,
        harness: { state: "checking" },
        updated_at: null,
        features: agent.features.map((feature) =>
          feature.command
            ? {
                ...feature,
                command: null,
                state: {
                  state: "files",
                  reason: "Reading the agent listing. Cached and file entries are available.",
                },
              }
            : feature,
        ),
      })),
    };
    window.pluginsFixture.finishProvider = (agentId) => {
      library = {
        ...library,
        agents: library.agents.map((agent) =>
          agent.agent_id === agentId
            ? (complete.agents.find((entry) => entry.agent_id === agentId) ?? agent)
            : agent,
        ),
      };
      for (const request of pending) request.update(library);
    };
    window.pluginsFixture.finish = () => {
      for (const request of pending) request.resolve(library);
    };
  }
  const api: PluginsApi = {
    snapshot: async (refresh, onUpdate = () => {}) => {
      calls.push(`snapshot:${refresh}`);
      if (mode === "plugins-progressive") {
        onUpdate(library);
        return new Promise((resolve) => pending.push({ update: onUpdate, resolve }));
      }
      return library;
    },
    setSync: async (agentId, enabled) => {
      calls.push(`sync:${agentId}:${enabled}`);
      library = {
        ...library,
        agents: library.agents.map((agent) =>
          agent.agent_id === agentId
            ? { ...agent, sync: { state: enabled ? "on" : "off" } }
            : agent,
        ),
      };
      return library.agents.filter((agent) => agent.sync.state === "off").map((a) => a.agent_id);
    },
    update: async (agentId) => {
      calls.push(`update:${agentId}`);
      library = {
        ...library,
        agents: library.agents.map((agent) =>
          agent.agent_id === agentId
            ? {
                ...agent,
                version: "2.1.314",
                harness: { state: "up_to_date", version: "2.1.314", checked_at: NOW },
                version_change: { from: "2.1.312", to: "2.1.314" },
              }
            : agent,
        ),
      };
    },
  };
  const item: LibraryItem = {
    item: { source_id: "user:claude", kind: "skill", key: "review-changes" },
    provider: "claude",
    scope: "user",
    label: "review-changes",
    relative_path: "skills/review-changes/SKILL.md",
    revision: "synthetic",
    bytes: 120,
    copy_blocked: null,
  };
  const libraryApi: LibraryApi = {
    snapshot: async () => ({
      items: [item],
      sources: ["claude", "codex", "pi"].map((provider) => ({
        id: `user:${provider}`,
        provider: provider as "claude",
        scope: "user" as const,
        available: true,
        message: null,
      })),
      notices: [],
    }),
    history: async () => [],
    preview: async () => ({
      item,
      text: "# Review changes\n\nRead the surrounding code before suggesting a change.\n",
      files: ["SKILL.md"],
      notices: [],
    }),
    prepare: async () => {
      throw new Error("Synthetic fixture: copies are not prepared here.");
    },
    cancel: async () => {},
    apply: async () => {
      throw new Error("Synthetic fixture.");
    },
    rollback: async () => {
      throw new Error("Synthetic fixture.");
    },
  };
  const initial = mode === "plugins-pi" ? "pi" : mode === "plugins-failed" ? "codex" : "claude";
  const root = createRoot(container);
  window.pluginsFixture.unmount = () => root.unmount();
  root.render(
    <StrictMode>
      <div className="pane-shell g-root">
        <PluginLibraryScreen
          initialAgent={initial}
          api={api}
          libraryApi={libraryApi}
          vendorApi={syntheticVendor}
          now={() => NOW}
          onBack={() => calls.push("back")}
          onAgents={() => calls.push("agents")}
        />
      </div>
    </StrictMode>,
  );
}
