import { describe, expect, it } from "vitest";
import { DISCOVERY } from "../fixture/discovery";
import type { DiscoveryTimeline } from "../fixture/types";
import { AGENTS } from "../fixture/workspace";
import { discoveryCounts, reduceDiscovery } from "./discovery";
import { eventsAt } from "./transcript";

const at = (seconds: number) =>
  reduceDiscovery(DISCOVERY, eventsAt(DISCOVERY.events, seconds * 1000), AGENTS);

describe("reduceDiscovery", () => {
  it("lists every candidate as looking before the scan reports anything", () => {
    const idle = reduceDiscovery(DISCOVERY, 0, AGENTS);
    expect(idle.status).toBe("idle");
    expect(idle.agents.map((agent) => agent.id)).toEqual(AGENTS.map((agent) => agent.id));
    expect(idle.agents.every((agent) => agent.status === "looking")).toBe(true);
    expect(idle.startedAt).toBeNull();
  });

  it("finds agents one by one, with where they live and whether they are signed in", () => {
    const early = at(0.9);
    expect(early.status).toBe("scanning");
    expect(early.locations).toEqual(["PATH", "~/.local/bin", "/opt/homebrew/bin"]);
    expect(discoveryCounts(early)).toEqual({ found: 2, missing: 0, looking: 5 });
    expect(early.agents[0]).toMatchObject({
      id: "claude-code",
      name: "Claude Code",
      status: "found",
      path: "~/.local/bin/claude",
      version: "2.1.310",
      signedIn: true,
      at: 500,
    });
    const antigravity = at(1.6).agents.find((agent) => agent.id === "antigravity");
    expect(antigravity).toMatchObject({ status: "found", signedIn: false });
  });

  it("reports missing agents with a command that installs them, then finishes", () => {
    const done = at(3);
    expect(done.status).toBe("done");
    expect(done.finishedAt).toBe(2600);
    expect(discoveryCounts(done)).toEqual({ found: 5, missing: 2, looking: 0 });
    expect(done.agents.find((agent) => agent.id === "cursor")).toMatchObject({
      status: "missing",
      installCommand: "curl https://cursor.com/install -fsS | bash",
      at: 2300,
    });
    expect(done.agents.find((agent) => agent.id === "grok")?.name).toBe("Grok Build");
  });

  it("counts what a finished scan never reported as missing, and keeps agents it did not expect", () => {
    const timeline: DiscoveryTimeline = {
      candidates: ["claude-code", "pi"],
      events: [
        { at: 0, event: { type: "scan_started", locations: ["PATH"] } },
        {
          at: 10,
          event: {
            type: "agent_found",
            agent: "opencode",
            path: "/usr/bin/opencode",
            version: "1.0.0",
            signedIn: true,
          },
        },
        { at: 20, event: { type: "scan_finished" } },
      ],
      duration: 20,
    };
    const done = reduceDiscovery(timeline);
    expect(done.agents.map((agent) => [agent.id, agent.status])).toEqual([
      ["claude-code", "missing"],
      ["pi", "missing"],
      ["opencode", "found"],
    ]);
    // Names come from the brand when the workspace does not list the agent.
    expect(done.agents[2]?.name).toBe("OpenCode");
    expect(done.agents[0]?.at).toBe(20);
  });

  it("is pure: the same events give the same model, and a negative count means nothing yet", () => {
    expect(at(1.6)).toEqual(at(1.6));
    expect(reduceDiscovery(DISCOVERY, -3, AGENTS).status).toBe("idle");
  });
});
