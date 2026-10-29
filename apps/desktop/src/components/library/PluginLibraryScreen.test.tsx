import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentPlugins } from "../../bindings";
import { pluginFixture } from "../../dev/pluginLibraryPreview";
import type { ConfigSyncItem } from "../../lib/config-sync/bindings";
import { AgentGroup, groups } from "../settings/ConfigSyncPanel";
import { AgentSection } from "./PluginLibraryScreen";

const NOW = Date.UTC(2026, 9, 28, 12, 0);
const noop = () => {};

function section(mode: string, agentId: string, override: Partial<AgentPlugins> = {}) {
  const agent = pluginFixture(mode).agents.find((entry) => entry.agent_id === agentId);
  if (!agent) throw new Error(agentId);
  return renderToStaticMarkup(
    <AgentSection
      agent={{ ...agent, ...override }}
      busy={null}
      now={() => NOW}
      onUpdate={noop}
      onSync={noop}
      onVendor={noop}
      onOpen={noop}
      onHistory={noop}
      onRefresh={noop}
    />,
  );
}

describe("Plugin library", () => {
  it("keeps an initial checking section distinct from an uninstalled agent", () => {
    const html = section("plugins", "claude", {
      installed: false,
      updated_at: null,
      harness: { state: "checking" },
    });
    expect(html).toContain("Checking installation…");
    expect(html).not.toContain("Not installed here");
  });

  it("shows one agent's own features, where they came from and when", () => {
    const html = section("plugins", "claude");
    for (const text of [
      "Claude Code",
      "Plugins",
      "Marketplaces",
      "Slash commands",
      "Subagents",
      "Hooks",
      "From claude plugin list --json --available",
      "Updated 4 minutes ago",
      "Up to date on 2.1.312.",
      "Showing 3 of 3599.",
      "Add plugin",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Instructions");
    expect(html).not.toContain("AGENTS.md");
    // One primary action per page.
    expect(html.match(/g-button-primary/g)?.length).toBe(1);
  });

  it("alerts calmly about an update and the reread that followed a version change", () => {
    const html = section("plugins-update", "claude");
    expect(html).toContain("Claude Code 2.1.314 is available. This device has 2.1.312.");
    expect(html).toContain("Update Claude Code to 2.1.314");
    expect(html).toContain("so its plugins were read again");
  });

  it("says plainly when the CLI listing failed and shows what the files declare", () => {
    const html = section("plugins-failed", "codex");
    expect(html).toContain("marketplace cache is corrupt. Showing the last available entries.");
    expect(html).toContain("data-failed");
    expect(html).toContain("tools");
    expect(html).toContain("Keeps 1 field on this device");
    expect(html).not.toContain("TOKEN=");
  });

  it("says when an agent has no plugin system and what it supports instead", () => {
    const html = section("plugins-pi", "pi");
    expect(html).toContain("Pi has no plugin marketplace.");
    expect(html).toContain("Packages");
    expect(html).toContain("Prompt templates");
    expect(html).toContain("Add package");
    expect(html).toContain("Off on this device.");
    const opencode = section("plugins", "opencode");
    expect(opencode).toContain("Configuration sync covers Claude Code, Codex and Pi.");
    expect(opencode).not.toContain('role="switch"');
  });
});

describe("Configuration sync by agent", () => {
  const item = (
    id: string,
    provider: ConfigSyncItem["provider"],
    extra: Partial<ConfigSyncItem> = {},
  ) =>
    ({
      id,
      label: id,
      provider,
      scope: "portable",
      operation: "apply",
      first_link: false,
      device_only: false,
      skipped: false,
      detail: null,
      hold: null,
      removed_upstream: false,
      ...extra,
    }) as ConfigSyncItem;

  it("groups items by agent and counts only ready ones for Apply all", () => {
    const grouped = groups([
      item("a", "pi"),
      item("b", "claude"),
      item("c", null),
      item("d", "claude", {
        operation: "wait",
        hold: { kind: "missing_path", path: "~/bin/tool" },
        detail: "The command ~/bin/tool does not exist on this device.",
      }),
    ]);
    expect(grouped.map(([provider]) => provider)).toEqual(["claude", "pi", "shared"]);
    const [, claude] = grouped[0] ?? ["claude", []];
    const html = renderToStaticMarkup(
      <AgentGroup
        provider="claude"
        items={claude}
        paused={false}
        busy={false}
        onSync={noop}
        onApplyAll={noop}
        onDeviceOnly={noop}
        onReview={noop}
      />,
    );
    expect(html).toContain("Claude Code");
    expect(html).toContain("Apply all 1");
    expect(html).toContain("Command not on this device");
    expect(html).toContain("Sync Claude Code on this device");
  });

  it("names every hold and a removal from another device", () => {
    const held = [
      item("missing", "codex", { operation: "wait", hold: { kind: "agent_missing" } }),
      item("removed", "codex", { removed_upstream: true }),
      item("share", "codex", {
        operation: "wait",
        hold: { kind: "foreign_path", path: "\\\\server\\share\\x" },
      }),
      item("old", "codex", {
        operation: "wait",
        hold: { kind: "needs_version", feature: "plugins", minimum: "0.162.1", found: "0.150.0" },
      }),
      item("offline", "codex", { operation: "wait", hold: { kind: "offline" } }),
    ];
    const html = renderToStaticMarkup(
      <AgentGroup
        provider="codex"
        items={held}
        paused
        busy={false}
        onSync={noop}
        onApplyAll={noop}
        onDeviceOnly={noop}
        onReview={noop}
      />,
    );
    for (const text of [
      "Waiting for the agent",
      "Removed on another device",
      "Kept on its own device",
      "Needs a newer agent",
      "Offline",
      "Sync is off on this device",
    ])
      expect(html).toContain(text);
    expect(html).toContain("Apply all 1");
  });
});
