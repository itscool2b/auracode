import { describe, expect, it, vi } from "vitest";
import type { AgentEntry, ChatSummary, HarnessStatus } from "../bindings";
import { availableUpdates, UpdateNotices, workingChats } from "./agentUpdates";

const agent = (id: string, harness: HarnessStatus | null, path?: string): AgentEntry =>
  ({
    id,
    name: id === "claude" ? "Claude Code" : id,
    harness,
    installation: path ? { launch_path: path } : null,
  }) as unknown as AgentEntry;

const available = (version: string, latest: string): HarnessStatus => ({
  state: "update_available",
  version,
  latest,
  source: "npm",
  checked_at: 1,
});

describe("agent updates", () => {
  it("lists only agents with a newer release, keyed by that release", () => {
    const updates = availableUpdates([
      agent("claude", available("2.1.310", "2.1.400"), "C:\\bin\\claude.exe"),
      agent("codex", { state: "up_to_date", version: "1.0.0", checked_at: 1 }),
      agent("pi", { state: "unknown", version: "0.3.0", reason: "Offline." }),
      agent("cursor", { state: "checking" }),
      agent("grok", { state: "not_installed" }),
      agent("hermes", null),
    ]);
    expect(updates).toEqual([
      {
        agentId: "claude",
        name: "Claude Code",
        version: "2.1.310",
        latest: "2.1.400",
        path: "C:\\bin\\claude.exe",
        key: "claude@2.1.400",
      },
    ]);
    expect(availableUpdates(null)).toEqual([]);
  });

  it("counts the agent's chats with a turn under way, and no others", () => {
    const chat = (agent_id: string, status: ChatSummary["status"]) =>
      ({ agent_id, status }) as ChatSummary;
    const chats = [
      chat("claude", "running"),
      chat("claude", "starting"),
      chat("claude", "ready"),
      chat("claude", "stopped"),
      chat("codex", "running"),
    ];
    expect(workingChats(chats, "claude")).toBe(2);
    expect(workingChats(null, "claude")).toBe(0);
  });

  it("remembers a dismissed release for this run, telling its listeners once", () => {
    const notices = new UpdateNotices();
    const listener = vi.fn();
    notices.subscribe(listener);
    const before = notices.getSnapshot();
    notices.dismiss("claude@2.1.400");
    notices.dismiss("claude@2.1.400");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(notices.getSnapshot()).not.toBe(before);
    expect(notices.getSnapshot().has("claude@2.1.400")).toBe(true);
    // A newer release is a new notice.
    expect(notices.getSnapshot().has("claude@2.1.401")).toBe(false);
    // A restart starts with nothing dismissed.
    expect(new UpdateNotices().getSnapshot().size).toBe(0);
  });
});
