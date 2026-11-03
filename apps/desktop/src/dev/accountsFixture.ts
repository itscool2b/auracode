/** In-memory added accounts for the browser fixtures. No token reaches anything native. */
import type { AgentAccounts } from "../bindings";
import type { AgentAccountsApi } from "../lib/agentAccounts";
import type { TerminalTransport } from "../lib/terminal";

/** A made-up token with the shape `claude setup-token` prints. It signs in to nothing. */
export const FIXTURE_TOKEN = `sk-ant-oat01-${"fixtureToken".repeat(8)}-AA`;

export interface AccountsFixture extends AgentAccountsApi {
  /** What the fixture was asked, in order. Tokens appear as their length only. */
  readonly calls: string[];
  /** The account the chat runs on after its last switch; `null`: the agent's own sign-in. */
  switched(): string | null | undefined;
}

export function createAccountsFixture(
  initial: readonly string[] = [],
  options: {
    unavailable?: string;
    /**
     * `missing`: the sign-in finishes without printing a token, so it has to be pasted. `code`:
     * it waits at "Paste code here" until Enter reaches the terminal, then prints the token.
     */
    tokenOutput?: "wrapped" | "missing" | "code";
  } = {},
): AccountsFixture {
  const calls: string[] = [];
  let next = 1;
  let switched: string | null | undefined;
  let state: AgentAccounts = {
    agent_id: "claude",
    accounts: initial.map((name) => ({
      id: `fixture-${next++}`,
      name,
      added_at: Date.UTC(2026, 9, 30 + next),
    })),
    active: null,
    unavailable: options.unavailable ?? null,
  };
  const answer = () => structuredClone(state);
  // `code`: whether the prompt was shown, and whether Enter has come since.
  let prompted = false;
  let entered = false;
  const tokenTerminal: TerminalTransport = {
    async reserve() {
      calls.push("token:reserve");
      return "token-fixture";
    },
    async start(id, agentId) {
      calls.push(`token:start:${agentId}`);
      return id;
    },
    async read() {
      if (options.tokenOutput === "code" && !entered) {
        const first = !prompted;
        prompted = true;
        if (!first) await new Promise((done) => setTimeout(done, 50));
        return {
          bytes: first
            ? Array.from(new TextEncoder().encode("Paste code here if prompted > "))
            : [],
          done: false,
          exit_code: null,
          truncated: false,
        };
      }
      // What claude setup-token prints once the browser approves: the token wrapped onto lines.
      const wrapped = FIXTURE_TOKEN.match(/.{1,40}/g)?.join("\r\n") ?? FIXTURE_TOKEN;
      const text =
        options.tokenOutput === "missing"
          ? "Browser didn't open? Use the url below to sign in\r\n\r\nSign-in finished.\r\n"
          : `✓ Long-lived authentication token created successfully!\r\n\r\nYour OAuth token (valid for 1 year):\r\n\r\n${wrapped}\r\n\r\nStore this token securely. You won't be able to see it again.\r\n`;
      return {
        bytes: Array.from(new TextEncoder().encode(text)),
        done: true,
        exit_code: 0,
        truncated: false,
      };
    },
    async write(_id, bytes) {
      if (bytes.includes(13)) {
        calls.push("token:enter");
        entered = true;
      }
    },
    async resize() {},
    async close() {
      calls.push("token:close");
    },
  };
  return {
    calls,
    switched: () => switched,
    tokenTerminal,
    async list(agentId) {
      calls.push(`list:${agentId}`);
      return answer();
    },
    async add(agentId, name, token) {
      const clean = token.replace(/\s+/g, "");
      calls.push(`add:${agentId}:${name}:${clean.length}`);
      if (state.unavailable) throw new Error(state.unavailable);
      if (!clean.startsWith("sk-ant-oat") || clean.length < 40)
        throw new Error(
          "Paste the whole token claude setup-token printed. It starts with sk-ant-oat.",
        );
      const named = name.trim().replace(/\s+/g, " ");
      if (state.accounts.some((account) => account.name.toLowerCase() === named.toLowerCase()))
        throw new Error(`An account named ${named} is already added. Choose another name.`);
      state = {
        ...state,
        accounts: [
          ...state.accounts,
          { id: `fixture-${next++}`, name: named, added_at: Date.UTC(2026, 10, 1) },
        ],
      };
      return answer();
    },
    async remove(agentId, accountId) {
      calls.push(`remove:${agentId}:${accountId}`);
      state = {
        ...state,
        accounts: state.accounts.filter((account) => account.id !== accountId),
        active: state.active === accountId ? null : state.active,
      };
      return answer();
    },
    async use(agentId, accountId) {
      calls.push(`use:${agentId}:${accountId ?? "own"}`);
      state = { ...state, active: accountId };
      return answer();
    },
    async usage(agentId) {
      // The main account near its week, the first added one at its session limit.
      const hour = 3_600_000;
      const now = Date.now();
      return {
        agent_id: agentId,
        accounts: [
          {
            account_id: null,
            windows: [
              { label: "5 hours", used_percent: 42, resets_at: now + 2 * hour },
              { label: "7 days", used_percent: 81, resets_at: now + 50 * hour },
            ],
            observed_at: now - 5 * 60_000,
          },
          ...(state.accounts[0]
            ? [
                {
                  account_id: state.accounts[0].id,
                  windows: [
                    { label: "5 hours", used_percent: 100, resets_at: now + hour },
                    { label: "7 days", used_percent: 18, resets_at: now + 120 * hour },
                  ],
                  observed_at: now - 2 * hour,
                },
              ]
            : []),
        ],
      };
    },
    async switchChat(chatId, agentId, accountId) {
      calls.push(`switch:${chatId}:${agentId}:${accountId ?? "own"}`);
      state = { ...state, active: accountId };
      switched = accountId;
      return answer();
    },
  };
}
