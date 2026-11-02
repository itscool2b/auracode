import { describe, expect, it } from "vitest";
import type { AgentAccounts } from "../bindings";
import {
  type AgentAccountsApi,
  accountName,
  accountsCache,
  chatAccount,
  chooseChatAccount,
  nextAccountName,
  resetText,
  takesAccounts,
} from "./agentAccounts";

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
    expect(accountName(accounts, null)).toBe("Main account");
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

  it("name a new account after the ones already there", () => {
    expect(nextAccountName(null)).toBe("Account 2");
    expect(nextAccountName(accounts)).toBe("Account 3");
    const taken = { ...accounts, accounts: [{ id: "a2", name: "Account 3", added_at: 0 }] };
    expect(nextAccountName(taken)).toBe("Account 4");
  });

  it("show the running process's account, else the one the next start uses", () => {
    expect(chatAccount(accounts, "ready", null)).toBeNull();
    expect(chatAccount(accounts, "running", "a1")).toBe("a1");
    expect(chatAccount(accounts, "stopped", null)).toBe("a1");
    expect(chatAccount(accounts, "failed", null)).toBe("a1");
  });

  it("restart a live or held chat on the chosen account, and only choose it for a stopped one", async () => {
    const calls: string[] = [];
    const api = {
      list: async () => accounts,
      use: async (_agent: string, id: string | null) => {
        calls.push(`use:${id}`);
        return { ...accounts, active: id };
      },
      switchChat: async (chat: string, _agent: string, id: string | null) => {
        calls.push(`switch:${chat}:${id}`);
        return { ...accounts, active: id };
      },
    } as unknown as AgentAccountsApi;
    const cache = accountsCache(api);
    const seen: (string | null | undefined)[] = [];
    cache.subscribe(() => seen.push(cache.snapshot("claude").accounts?.active));
    await chooseChatAccount(
      cache,
      { chatId: "c", agentId: "claude", status: "ready", held: false },
      null,
    );
    await chooseChatAccount(
      cache,
      { chatId: "c", agentId: "claude", status: "stopped", held: false },
      "a1",
    );
    await chooseChatAccount(
      cache,
      { chatId: "c", agentId: "claude", status: "stopped", held: true },
      null,
    );
    expect(calls).toEqual(["switch:c:null", "use:a1", "switch:c:null"]);
    expect(seen).toEqual([null, "a1", null]);
    expect(accountsCache(api)).toBe(cache);
  });
});
