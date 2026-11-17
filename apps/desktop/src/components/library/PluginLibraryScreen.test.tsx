import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentPlugins } from "../../bindings";
import { pluginFixture } from "../../dev/pluginLibraryPreview";
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
      onVendor={noop}
      onOpen={noop}
      onHistory={noop}
      onRefresh={noop}
    />,
  );
}

describe("Plugin library", () => {
  it("lists Grok's plugins and marketplaces and adds a marketplace where its list is", () => {
    const html = section("live", "grok");
    expect(html).toContain("xAI Official");
    expect(html).toContain("xai-org/plugin-marketplace");
    expect(html).toContain("Available from your marketplaces");
    expect(html).toContain('data-testid="add-marketplace"');
    expect(html).toMatch(/Add marketplace<\/button>/);
  });

  it("calls Hermes taps skill sources and adds one there", () => {
    const html = section("live", "hermes");
    expect(html).toContain("Skill sources");
    expect(html).toContain("team/skills");
    expect(html).toMatch(/Add skill source<\/button>/);
    expect(html).toContain("browser-firecrawl");
  });

  it("offers no Add where the agent cannot add a marketplace", () => {
    expect(section("live", "cursor")).not.toContain('data-testid="add-marketplace"');
  });

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
  });

  it("offers no switch to sync an agent's plugins between devices", () => {
    for (const agent of ["claude", "codex", "opencode"]) {
      const html = section("plugins", agent);
      expect(html).not.toContain('role="switch"');
      expect(html).not.toContain("across devices");
    }
  });
});
