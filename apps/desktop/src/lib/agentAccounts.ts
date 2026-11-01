import { type AgentAccounts, commands } from "../bindings";
import { settle } from "./ipc";
import { type TerminalTransport, terminalTransport } from "./terminal";

/** Added agent accounts (docs/agent-accounts.md). Rust owns the tokens: none comes back here. */
export interface AgentAccountsApi {
  list(agentId: string): Promise<AgentAccounts>;
  /** Adds an account from the token `claude setup-token` printed. It is not used until chosen. */
  add(agentId: string, name: string, token: string): Promise<AgentAccounts>;
  remove(agentId: string, accountId: string): Promise<AgentAccounts>;
  /** The account the agent's next starts sign in with; `null`: its own sign-in. */
  use(agentId: string, accountId: string | null): Promise<AgentAccounts>;
  /** Chooses the account, then starts this chat again on it and sends what was held. */
  switchChat(chatId: string, agentId: string, accountId: string | null): Promise<AgentAccounts>;
  /** The terminal sheet's transport for `claude setup-token`. */
  readonly tokenTerminal: TerminalTransport;
}

export const agentAccountsApi: AgentAccountsApi = {
  list: (agentId) => settle(commands.agentAccounts(agentId)),
  add: (agentId, name, token) => settle(commands.agentAccountAdd(agentId, name, token)),
  remove: (agentId, accountId) => settle(commands.agentAccountRemove(agentId, accountId)),
  use: (agentId, accountId) => settle(commands.agentAccountUse(agentId, accountId)),
  switchChat: (chatId, agentId, accountId) =>
    settle(commands.chatSwitchAccount(chatId, agentId, accountId)),
  tokenTerminal: {
    ...terminalTransport,
    start: (id, agentId, size) =>
      settle(commands.agentTokenStart(id, agentId, size.rows, size.cols)),
  },
};

/** The agents that take added accounts. Rust says why the others cannot. */
export function takesAccounts(agentId: string): boolean {
  return agentId === "claude" || agentId.startsWith("claude-");
}

/** The name of the account an id names, or the agent's own sign-in for `null`. */
export function accountName(accounts: AgentAccounts | null, id: string | null): string {
  if (id === null) return "Own sign-in";
  return accounts?.accounts.find((account) => account.id === id)?.name ?? "A removed account";
}

/** "resets at 5:30 PM", in the person's own clock; `null` without a time. */
export function resetText(resetsAt: number | null, now = Date.now()): string | null {
  if (resetsAt === null) return null;
  const at = new Date(resetsAt);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date(now).toDateString() === at.toDateString();
  return sameDay
    ? `Resets at ${time}.`
    : `Resets ${at.toLocaleDateString([], { weekday: "long" })} at ${time}.`;
}
