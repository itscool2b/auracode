import { useState } from "react";
import type { UsageLimit } from "../../bindings";
import {
  type AgentAccountsApi,
  accountName,
  resetText,
  useAgentAccounts,
} from "../../lib/agentAccounts";
import { errorMessage } from "../../lib/errors";
import { AddAccountDialog } from "../setup/AddAccountDialog";

/**
 * The agent said its usage limit is reached, or (`refused`) it refused an added account's token.
 * Its own words, then the way on: continue on another account, which starts the agent again on it
 * with the same session and sends the held message, or add one first. Waiting for a limit's reset
 * needs nothing here: Send in the queue retries.
 */
export function UsageLimitCard({
  limit,
  chatId,
  agentId,
  agentName,
  accountId,
  api,
  refused = false,
}: {
  readonly limit: UsageLimit;
  readonly chatId: string;
  readonly agentId: string;
  readonly agentName: string;
  /** The added account the agent last started on; `null`: its own sign-in. */
  readonly accountId: string | null;
  /** Absent for an agent that takes no added accounts. */
  readonly api?: AgentAccountsApi;
  readonly refused?: boolean;
}) {
  const { accounts, error: loadError, cache } = useAgentAccounts(agentId, api);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [failure, setError] = useState<string | null>(null);
  const error = failure ?? loadError;
  const others: (string | null)[] = accounts
    ? [null, ...accounts.accounts.map((account) => account.id)].filter((id) => id !== accountId)
    : [];
  const resets = /\breset/i.test(limit.message) ? null : resetText(limit.resets_at);
  // Another account is a way on unless none can be added here and the agent's own sign-in is the
  // one at its limit.
  const switchable =
    api !== undefined &&
    (accounts === null || accounts.unavailable === null || others.includes(null));
  const switchTo = (id: string | null) => {
    if (!api || !cache) throw new Error("Accounts are not available here.");
    return cache.change(agentId, () => api.switchChat(chatId, agentId, id));
  };
  const continueWith = async (id: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await switchTo(id);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };
  return (
    <div
      className="chat-block"
      data-kind={refused ? "account-refused" : "usage-limit"}
      data-testid={refused ? "account-refused-card" : "usage-limit-card"}
    >
      <div className="chat-block-head">
        <span className="chat-block-title" data-testid="usage-limit-message">
          {limit.message}
        </span>
      </div>
      <p className="chat-limit-text">
        {resets ? `${resets} ` : ""}
        {switchable
          ? `Your message waits in the queue. Continue on another account and ${agentName} picks up the same conversation.`
          : refused
            ? "Your message waits in the queue."
            : "Your message waits in the queue. Send it again once the limit resets."}
      </p>
      {api ? (
        <div className="ui-row">
          {others
            .filter((id) => id === null || accounts?.unavailable === null)
            .map((id, index) => (
              <button
                key={id ?? "own"}
                type="button"
                className={index === 0 ? "g-button g-button-primary" : "g-button"}
                disabled={busy}
                onClick={() => void continueWith(id)}
              >
                {id === null
                  ? "Continue with your main account"
                  : `Continue with ${accountName(accounts, id)}`}
              </button>
            ))}
          {accounts?.unavailable === null ? (
            <button
              type="button"
              className="g-button g-button-ghost"
              disabled={busy}
              onClick={() => setAdding(true)}
            >
              Add account…
            </button>
          ) : null}
        </div>
      ) : null}
      {accounts?.unavailable ? <span className="ui-muted">{accounts.unavailable}</span> : null}
      {error ? (
        <span role="alert" className="ui-error">
          {error}
        </span>
      ) : null}
      {adding && api ? (
        <AddAccountDialog
          agentId={agentId}
          agentName={agentName}
          api={api}
          onClose={() => setAdding(false)}
          accounts={accounts}
          after="switch"
          onAdded={async (_next, id) => {
            await switchTo(id);
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}
