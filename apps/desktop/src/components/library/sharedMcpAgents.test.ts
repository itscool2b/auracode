import { describe, expect, it } from "vitest";
import { agentsSummary, SHARED_MCP_AGENTS } from "./SharedMcpPanel";

const known = [
  { id: "claude", name: "Claude Code", installed: true },
  { id: "codex", name: "Codex", installed: false },
];

describe("a shared MCP server's agents", () => {
  it("reads as every agent when it names none", () => {
    expect(agentsSummary(null, known)).toBe("Every agent");
    expect(agentsSummary(undefined, known)).toBe("Every agent");
  });

  it("names the chosen agents, and an ID this device does not know as itself", () => {
    expect(agentsSummary(["claude", "codex"], known)).toBe("Claude Code, Codex");
    expect(agentsSummary(["future-agent"], known)).toBe("future-agent");
  });

  it("offers only agents whose launches take shared servers", () => {
    expect(SHARED_MCP_AGENTS.has("claude")).toBe(true);
    expect(SHARED_MCP_AGENTS.has("antigravity")).toBe(false);
    expect(SHARED_MCP_AGENTS.has("oh-my-pi")).toBe(false);
  });
});
