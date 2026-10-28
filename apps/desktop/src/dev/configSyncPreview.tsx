/** Synthetic configuration sync exercise. Never opens real provider roots or Account stores. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigSyncPanel } from "../components/settings/ConfigSyncPanel";
import type { ConfigSyncApi } from "../lib/config-sync/api";
import type { ConfigSyncItem, ConfigSyncPreview } from "../lib/config-sync/bindings";
import type { VendorApi } from "../lib/config-vendor/api";
import "../components/settings/settings.css";

declare global {
  interface Window {
    configSyncCalls: string[];
  }
}

const base = (id: string, label: string, provider: ConfigSyncItem["provider"]): ConfigSyncItem => ({
  id,
  label,
  provider,
  scope: "portable",
  operation: "apply",
  first_link: false,
  device_only: false,
  skipped: false,
  detail: null,
  hold: null,
  removed_upstream: false,
});

/**
 * Every per-agent edge case as it reaches the review, one item each, so the grouped panel and its
 * holds can be read and checked. The sentences are the ones Rust's hold_sentence writes.
 */
function agentItems(paused: readonly string[]): ConfigSyncItem[] {
  return [
    {
      ...base("claude-plugin", "settings.json · enabledPlugins / tools@team", "claude"),
      operation: "wait",
      hold: { kind: "marketplace_missing", marketplace: "team", source: null },
      detail:
        "The marketplace team is not added on this device, and the other device did not sync where it comes from. Add it with the agent first.",
    },
    {
      ...base("claude-rules", "rules/review.md", "claude"),
      operation: "apply",
    },
    {
      ...base("claude-skill", "skills/release", "claude"),
      operation: "conflict",
      detail: null,
    },
    {
      ...base("codex-plugin", "config.toml · plugins / docs@openai / enabled", "codex"),
      operation: "wait",
      hold: { kind: "needs_version", feature: "plugins", minimum: "0.162.1", found: "0.150.0" },
      detail:
        "The agent here (0.150.0) is older than 0.162.1, which plugins need. Update the agent, then review again.",
    },
    {
      ...base("codex-mcp", "config.toml · mac-tool", "codex"),
      scope: "macos",
      operation: "wait",
      hold: { kind: "device_specific", platform: "macos" },
      detail:
        "This item uses macOS paths. It stays with devices on that system and is never applied here.",
    },
    {
      ...base("codex-share", "config.toml · share-tool", "codex"),
      operation: "wait",
      hold: { kind: "foreign_path", path: "\\\\server\\share\\tool.exe" },
      detail:
        "The command \\\\server\\share\\tool.exe is a network, device or relative path, so it is not looked up or written here. It stays with the device it came from.",
    },
    {
      ...base("codex-missing", "config.toml · home-tool", "codex"),
      operation: "wait",
      hold: { kind: "missing_path", path: "~/bin/home-tool" },
      detail:
        "The command ~/bin/home-tool does not exist on this device, so this server is not written here.",
    },
    {
      ...base("codex-removed", "rules/old.rules", "codex"),
      operation: "apply",
      removed_upstream: true,
    },
    {
      ...base("pi-package", "settings.json · packages", "pi"),
      operation: "wait",
      skipped: true,
      hold: {
        kind: "retained",
        reason:
          "The install exited with code 1. Its declaration was restored to how it was. Other items are unchanged.",
      },
      detail:
        "The install exited with code 1. Its declaration was restored to how it was. Other items are unchanged.",
    },
    {
      ...base("pi-prompt", "prompts/release.md", "pi"),
      operation: "wait",
      hold: paused.includes("pi") ? { kind: "sync_paused" } : { kind: "agent_missing" },
      detail: paused.includes("pi")
        ? "Sync is off for this agent on this device. Turn it on to apply this item."
        : "This agent is not installed on this device. The item waits here and is applied once it is.",
    },
  ];
}

export function mountConfigSyncPreview(container: HTMLElement, mode = "config-sync") {
  const parameters = new URLSearchParams(location.search);
  const scenario = mode === "plugin-sync" ? "agents" : parameters.get("case");
  window.configSyncCalls = [];
  let applied = false;
  let restored = false;
  const paused: string[] = ["pi"];
  const item: ConfigSyncItem = {
    ...base("fixture", "AGENTS.md", "codex"),
    operation: "conflict",
    first_link: true,
  };
  const marketplace: ConfigSyncPreview["vendor_steps"] = [
    { provider: "claude", kind: "marketplace", target: "owner/plugins" },
    { provider: "claude", kind: "plugin", target: "tools@team" },
  ];
  const api: ConfigSyncApi = {
    async inventory(after) {
      window.configSyncCalls.push(`inventory:${after ?? "first"}`);
      if (scenario === "agents")
        return {
          items: agentItems(paused),
          next_cursor: null,
          notices: [],
          offline: false,
          paused: [...paused],
        };
      return {
        items: after
          ? [{ ...item, id: "second", label: "rules/review.md", operation: "publish" }]
          : [{ ...item, operation: applied ? "in_sync" : "conflict" }],
        next_cursor: after ? null : "fixture",
        notices: ["One Codex item is waiting for its agent."],
        offline: false,
        paused: [],
      };
    },
    async history() {
      return [
        {
          id: "receipt",
          item_id: "fixture",
          label: "AGENTS.md",
          provider: "codex",
          status: restored
            ? "rolled_back"
            : scenario === "partial"
              ? "recovery_required"
              : "applied",
        },
      ];
    },
    async preview(id, choice) {
      window.configSyncCalls.push(`preview:${choice}`);
      if (scenario === "agents") {
        const chosen = agentItems(paused).find((entry) => entry.id === id) ?? item;
        const vendor = id === "claude-plugin";
        return {
          token: `${id}:${choice}`,
          item: vendor
            ? {
                ...chosen,
                hold: { kind: "marketplace_missing", marketplace: "team", source: "owner/plugins" },
              }
            : chosen,
          choice,
          base: null,
          local: null,
          remote: vendor ? "true" : "allow git\n",
          result: vendor ? "true" : "allow git\n",
          conflicts: [],
          deletes_item: chosen.removed_upstream,
          can_apply: !chosen.hold,
          warnings: vendor
            ? [
                "Review the full change before applying. Configuration can change what an agent executes.",
                "The marketplace team is not added on this device. Add it from owner/plugins, then install the plugin.",
              ]
            : chosen.detail
              ? [chosen.detail]
              : [],
          vendor_steps: vendor ? marketplace : [],
        };
      }
      return {
        token: `${id}:${choice}`,
        item: { ...item, operation: choice === "automatic" ? "conflict" : "merge" },
        choice,
        base: "Write focused changes.\n",
        local: "Write focused changes.\nCheck the final diff.\n",
        remote: "Write focused changes.\nExplain the result.\n",
        result:
          choice === "automatic"
            ? null
            : choice === "keep_local"
              ? "Write focused changes.\nCheck the final diff.\n"
              : "Write focused changes.\nExplain the result.\n",
        conflicts: choice === "automatic" ? ["AGENTS.md"] : [],
        deletes_item: scenario === "delete",
        can_apply: choice !== "automatic",
        warnings: [
          "This review expires after ten minutes. Changes remain encrypted in your Account profile.",
        ],
        vendor_steps: [],
      };
    },
    async cancel(token) {
      window.configSyncCalls.push(`cancel:${token}`);
    },
    async apply(token) {
      window.configSyncCalls.push(`apply:${token}`);
      if (scenario === "stale") throw new Error("This item changed after review. Review it again.");
      applied = true;
      return {
        item_id: "fixture",
        receipt_id: "receipt",
        completed: scenario !== "partial",
        message:
          scenario === "partial"
            ? "The local change needs recovery. Open History to restore it before retrying."
            : "Configuration saved to this Account profile.",
      };
    },
    async deviceOnly(_id, value) {
      window.configSyncCalls.push(`device:${value}`);
      item.device_only = value;
    },
    async rollback(id) {
      window.configSyncCalls.push(`rollback:${id}`);
      restored = true;
      return {
        item_id: "fixture",
        receipt_id: "restored",
        completed: true,
        message: "Local configuration restored. Review the item before synchronizing this change.",
      };
    },
    async applyAgent(agentId) {
      window.configSyncCalls.push(`apply-agent:${agentId}`);
      return [
        { item_id: "claude-rules", receipt_id: "r1", completed: true, message: "Saved." },
        {
          item_id: "claude-other",
          receipt_id: null,
          completed: false,
          message:
            "Configuration sync state could not be saved. Its previous merge base is retained.",
        },
      ];
    },
    async vendorFinish(token, succeeded, exitCode) {
      window.configSyncCalls.push(`vendor-finish:${token}:${succeeded}:${exitCode}`);
      return {
        item_id: "claude-plugin",
        receipt_id: succeeded ? null : "restore",
        completed: succeeded,
        message: succeeded
          ? "Installed with the agent's own command and saved to this Account profile."
          : `The install exited with code ${exitCode}. Its declaration was restored to how it was. Other items are unchanged.`,
      };
    },
    async setAgentSync(agentId, enabled) {
      window.configSyncCalls.push(`sync:${agentId}:${enabled}`);
      const index = paused.indexOf(agentId);
      if (enabled && index >= 0) paused.splice(index, 1);
      if (!enabled && index < 0) paused.push(agentId);
      return [...paused];
    },
  };
  createRoot(container).render(
    <StrictMode>
      <main className="settings-shell g-root">
        <div className="settings-main">
          <div className="settings-content">
            <h1>Configuration sync</h1>
            <ConfigSyncPanel
              active={scenario !== "local"}
              onAccount={() => window.configSyncCalls.push("account")}
              api={api}
              vendorApi={syntheticVendor}
            />
          </div>
        </div>
      </main>
    </StrictMode>,
  );
}

/** A vendor terminal that never runs anything, for the review's installer steps. */
export const syntheticVendor: VendorApi = {
  review: async (request) => ({
    token: "vendor-review",
    request,
    program: "C:/fixture/claude.exe",
    arguments: ["plugin", "install", request.target, "--scope", "user"],
    working_directory: "C:/fixture",
    config_directory: "C:/fixture/.claude",
    revision: "fixture",
    timeout_seconds: 600,
    notices: ["Synthetic fixture. No vendor command runs."],
  }),
  cancel: async () => {},
  terminal: () => ({
    reserve: async () => "vendor-terminal",
    start: async () => "vendor-terminal",
    read: async () => ({
      bytes: [...new TextEncoder().encode("Synthetic command finished.\r\n")],
      done: true,
      exit_code: 1,
      truncated: false,
    }),
    write: async () => {},
    resize: async () => {},
    close: async () => {},
  }),
};
