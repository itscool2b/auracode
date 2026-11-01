import { describe, expect, it } from "vitest";
import type { AgentAccounts } from "../bindings";
import { accountName, resetText, takesAccounts } from "./agentAccounts";

const accounts: AgentAccounts = {
  agent_id: "claude",
  accounts: [{ id: "a1", name: "Work", added_at: 0 }],
  active: "a1",
  unavailable: null,
};

describe("added agent accounts", () => {
  it("are Claude Code's, through either connection", () => {
    expect(takesAccounts("claude")).toBe(true);
    expect(takesAccounts("claude-acp")).toBe(true);
    expect(takesAccounts("codex")).toBe(false);
    expect(takesAccounts("mock")).toBe(false);
  });

  it("name the agent's own sign-in and an account that is gone", () => {
    expect(accountName(accounts, null)).toBe("Own sign-in");
    expect(accountName(accounts, "a1")).toBe("Work");
    expect(accountName(accounts, "gone")).toBe("A removed account");
    expect(accountName(null, "a1")).toBe("A removed account");
  });

  it("say when a limit resets, today or on its day", () => {
    const now = new Date(2026, 10, 1, 16, 40).getTime();
    const today = resetText(new Date(2026, 10, 1, 17, 30).getTime(), now);
    expect(today).toMatch(/^Resets at .*5.*30/);
    const later = resetText(new Date(2026, 10, 3, 9, 0).getTime(), now);
    expect(later).toMatch(/^Resets \S+ at /);
    expect(later).not.toMatch(/^Resets at/);
    expect(resetText(null, now)).toBeNull();
  });
});
