import { useEffect, useSyncExternalStore } from "react";
import {
  type AccountUsage,
  type AgentAccounts,
  type AgentUsage,
  commands,
  type SessionStatus,
} from "../bindings";
import { errorMessage } from "./errors";
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
  /** What each of the agent's accounts last reported about its usage limits. */
  usage(agentId: string): Promise<AgentUsage>;
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
  usage: (agentId) => settle(commands.agentUsage(agentId)),
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

/** What the agent's own sign-in (`claude /login`) is called beside the added accounts. */
export const MAIN_ACCOUNT = "Main account";

/** The name of the account an id names, or the agent's own sign-in for `null`. */
export function accountName(accounts: AgentAccounts | null, id: string | null): string {
  if (id === null) return MAIN_ACCOUNT;
  return accounts?.accounts.find((account) => account.id === id)?.name ?? "A removed account";
}

/** "Account 2", "Account 3": the first free default name, the main account being the first. */
export function nextAccountName(accounts: AgentAccounts | null): string {
  const taken = new Set(accounts?.accounts.map((account) => account.name.toLowerCase()) ?? []);
  let index = (accounts?.accounts.length ?? 0) + 2;
  while (taken.has(`account ${index}`)) index += 1;
  return `Account ${index}`;
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

export interface AccountsState {
  readonly accounts: AgentAccounts | null;
  readonly error: string | null;
  /** What each account last reported about its usage limits, if anything yet. */
  readonly usage: AgentUsage | null;
}

const EMPTY: AccountsState = { accounts: null, error: null, usage: null };

/** The usage an account (`null`: the agent's own sign-in) last reported. */
export function accountUsage(
  usage: AgentUsage | null,
  accountId: string | null,
): AccountUsage | null {
  return usage?.accounts.find((entry) => (entry.account_id ?? null) === accountId) ?? null;
}

/**
 * One api's accounts per agent, shared by every surface that shows them (the composer, the limit
 * card, the Agents page), so a change made in one shows in all of them at once.
 */
export class AccountsCache {
  private readonly entries = new Map<string, AccountsState>();
  private readonly listeners = new Set<() => void>();
  private readonly loads = new Map<string, Promise<void>>();

  constructor(readonly api: AgentAccountsApi) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot(agentId: string): AccountsState {
    return this.entries.get(agentId) ?? EMPTY;
  }

  /** Takes an answer the api gave, from any surface. */
  set(agentId: string, accounts: AgentAccounts): void {
    this.entries.set(agentId, { ...this.snapshot(agentId), accounts, error: null });
    this.emit();
    void this.refreshUsage(agentId);
  }

  /** Usage changes as chats run: every surface that shows it asks again when it opens. */
  refreshUsage(agentId: string): Promise<void> {
    if (typeof this.api.usage !== "function") return Promise.resolve();
    return this.api.usage(agentId).then(
      (usage) => {
        this.entries.set(agentId, { ...this.snapshot(agentId), usage });
        this.emit();
      },
      () => {},
    );
  }

  refresh(agentId: string): Promise<void> {
    const running = this.loads.get(agentId);
    if (running) return running;
    const load = this.api
      .list(agentId)
      .then(
        (accounts) => this.set(agentId, accounts),
        (reason) => {
          this.entries.set(agentId, { ...this.snapshot(agentId), error: errorMessage(reason) });
          this.emit();
          void this.refreshUsage(agentId);
        },
      )
      .finally(() => this.loads.delete(agentId));
    this.loads.set(agentId, load);
    return load;
  }

  /** Runs a change and shares its answer. A failure is the caller's to show. */
  async change(agentId: string, work: () => Promise<AgentAccounts>): Promise<AgentAccounts> {
    const accounts = await work();
    this.set(agentId, accounts);
    return accounts;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const caches = new WeakMap<AgentAccountsApi, AccountsCache>();

export function accountsCache(api: AgentAccountsApi): AccountsCache {
  let cache = caches.get(api);
  if (!cache) {
    cache = new AccountsCache(api);
    caches.set(api, cache);
  }
  return cache;
}

const noSubscribe = () => () => {};

/** The agent's accounts, loaded on first use and kept current across surfaces. */
export function useAgentAccounts(
  agentId: string,
  api: AgentAccountsApi | undefined,
): AccountsState & { readonly cache: AccountsCache | null } {
  const cache = api ? accountsCache(api) : null;
  const state = useSyncExternalStore(
    cache?.subscribe ?? noSubscribe,
    () => cache?.snapshot(agentId) ?? EMPTY,
    () => EMPTY,
  );
  useEffect(() => {
    void cache?.refresh(agentId);
  }, [cache, agentId]);
  return { ...state, cache };
}

/** A turn is under way: Claude Code cannot start again on another account until it ends. */
export function switchWaits(status: SessionStatus): boolean {
  return status === "running" || status === "cancelling" || status === "stopping";
}

/**
 * The account a chat is on: the one its process started with while it has one, otherwise the one
 * its next start uses.
 */
export function chatAccount(
  accounts: AgentAccounts | null,
  status: SessionStatus,
  running: string | null | undefined,
): string | null {
  const live = status === "starting" || status === "ready" || switchWaits(status);
  return live ? (running ?? null) : (accounts?.active ?? null);
}

/**
 * Moves a chat to an account. A chat with a process, or with messages held for an account, starts
 * again on it and resumes the same conversation; a stopped one starts on it next time. Either way
 * it becomes the account new chats use.
 */
export function chooseChatAccount(
  cache: AccountsCache,
  chat: {
    readonly chatId: string;
    readonly agentId: string;
    readonly status: SessionStatus;
    readonly held: boolean;
  },
  accountId: string | null,
): Promise<AgentAccounts> {
  const restart = chat.status === "starting" || chat.status === "ready" || chat.held;
  return cache.change(chat.agentId, () =>
    restart
      ? cache.api.switchChat(chat.chatId, chat.agentId, accountId)
      : cache.api.use(chat.agentId, accountId),
  );
}

/** "42%", "100%": a window's share used, whole; "unknown" when the agent gave no number. */
export function usedText(percent: number | null): string {
  return percent === null ? "unknown" : `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
}

/** "just now", "5 min ago", "3 h ago", "Nov 1": when an account last reported its usage. */
export function seenText(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}
