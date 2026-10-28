import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentConnections, AgentEntry } from "../../bindings";
import { automaticChoice, ConnectionSetting, connectionDetail } from "./AgentRow";

const ready = { state: "ready", version: "Claude Code 2.1.310", path: "/bin/claude" } as const;
const missing = {
  state: "missing",
  reason: "Node.js 22 or newer is required (found none).",
} as const;

const connections: AgentConnections = {
  preferred: null,
  active: "claude",
  options: [
    {
      id: "claude",
      label: "Direct",
      description: "Your Claude Code, driven directly through its native control protocol.",
      availability: ready,
      launch: "claude -p",
      needs_download: false,
    },
    {
      id: "claude-acp",
      label: "ACP adapter",
      description: "Your Claude Code, driven through the claude-agent-acp adapter.",
      availability: ready,
      launch: "@agentclientprotocol/claude-agent-acp 0.95.0 with your claude",
      needs_download: true,
    },
  ],
};

const claude: AgentEntry = {
  id: "claude",
  name: "Claude Code",
  description: "Your Claude Code, driven directly through its native control protocol.",
  availability: ready,
  launch: "claude -p",
  needs_download: false,
  last_verified: "2026-10-26",
  connections,
};

const noop = async (): Promise<void> => {};

function options(html: string): [string, string, boolean][] {
  return [...html.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((match) => [
    match[1] ?? "",
    match[3] ?? "",
    (match[2] ?? "").includes("disabled"),
  ]);
}

describe("the Connection setting", () => {
  it("is one row: Automatic first, naming what it uses, then each connection", () => {
    const html = renderToStaticMarkup(
      <ConnectionSetting
        agent={claude}
        connections={connections}
        onConnection={noop}
        onError={() => {}}
      />,
    );
    expect(html).toContain('data-testid="agent-connection"');
    expect(html).toContain("<strong>Connection</strong>");
    expect(html).toContain("Applies to new chats. Automatic uses the first that can run here.");
    expect(html).toContain('aria-label="Claude Code connection"');
    expect(options(html)).toEqual([
      ["", "Automatic (Direct)", false],
      ["claude", "Direct", false],
      ["claude-acp", "ACP adapter", false],
    ]);
  });

  it("says when the adapter in use downloads, and offers no connection that cannot run", () => {
    const adapter = { ...connections, active: "claude-acp" };
    expect(automaticChoice(adapter)).toBe("Automatic (ACP adapter)");
    expect(connectionDetail(adapter)).toBe(
      "Applies to new chats. The ACP adapter downloads once, with its first chat.",
    );
    const noNode: AgentConnections = {
      ...connections,
      options: connections.options.map((option) =>
        option.id === "claude-acp" ? { ...option, availability: missing } : option,
      ),
    };
    const html = renderToStaticMarkup(
      <ConnectionSetting
        agent={claude}
        connections={noNode}
        onConnection={noop}
        onError={() => {}}
      />,
    );
    expect(options(html)[2]).toEqual(["claude-acp", "ACP adapter", true]);
    // A choice already made stays selectable, so the select can show it.
    const chosen = renderToStaticMarkup(
      <ConnectionSetting
        agent={claude}
        connections={{ ...noNode, preferred: "claude-acp", active: null }}
        onConnection={noop}
        onError={() => {}}
      />,
    );
    expect(options(chosen)[0]).toEqual(["", "Automatic", false]);
    expect(options(chosen)[2]).toEqual(["claude-acp", "ACP adapter", false]);
  });
});
