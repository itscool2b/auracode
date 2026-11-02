import { useState } from "react";
import type { AgentAccounts as Accounts } from "../../bindings";
import {
  type AgentAccountsApi,
  accountName,
  MAIN_ACCOUNT,
  useAgentAccounts,
} from "../../lib/agentAccounts";
import { errorMessage } from "../../lib/errors";
import { AddAccountDialog } from "./AddAccountDialog";
import "./accounts.css";

const ADDED = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * An agent's accounts on this device (docs/agent-accounts.md): the main account and the added
 * ones, the one new chats start on marked, Use to change it, Remove for an added one, and Add
 * account. Choosing here never restarts a running chat; the composer's account picker moves one.
 */
export function AgentAccounts({
  agentId,
  agentName,
  api,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly api: AgentAccountsApi;
}) {
  const { accounts, error: loadError, cache } = useAgentAccounts(agentId, api);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const change = async (work: () => Promise<Accounts>, done: string) => {
    if (!cache) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await cache.change(agentId, work);
      setMessage(done);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };
  const use = (id: string | null) =>
    change(
      () => api.use(agentId, id),
      `New ${agentName} chats start on ${accountName(accounts, id)}. Running chats keep theirs until you switch them or they start again.`,
    );
  const unavailable = accounts?.unavailable ?? null;
  const rows: (string | null)[] = [
    null,
    ...(accounts?.accounts.map((account) => account.id) ?? []),
  ];
  const shown = error ?? loadError ?? message;
  return (
    <div className="agent-accounts" data-testid="agent-accounts">
      <h2 className="agent-accounts-title">Accounts</h2>
      <p>
        Switch a chat's account from its composer. When an account reaches its usage limit, the chat
        continues on another one with the same conversation.
      </p>
      <ul className="agent-accounts-list" aria-label={`${agentName} accounts`}>
        {rows.map((id) => {
          const account = accounts?.accounts.find((entry) => entry.id === id) ?? null;
          const active = (accounts?.active ?? null) === id;
          const label = id === null ? MAIN_ACCOUNT : (account?.name ?? "");
          return (
            <li key={id ?? "main"} className="agent-account" data-active={active || undefined}>
              <span className="agent-account-name">{label}</span>
              <span className="agent-account-meta">
                {[
                  active ? "Used by new chats" : null,
                  id === null
                    ? `The account ${agentName} is signed in to`
                    : account
                      ? `Added ${ADDED.format(new Date(account.added_at))}`
                      : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {removing === id && account ? (
                <span className="agent-account-confirm">
                  <button
                    type="button"
                    className="g-button g-button-28"
                    disabled={busy}
                    onClick={() =>
                      void change(
                        () => api.remove(agentId, account.id),
                        `Removed ${account.name} and its token.`,
                      )
                    }
                  >
                    Remove {account.name}
                  </button>
                  <button
                    type="button"
                    className="g-button g-button-ghost g-button-28"
                    disabled={busy}
                    onClick={() => setRemoving(null)}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <span className="agent-account-actions">
                  {active ? null : (
                    <button
                      type="button"
                      className="g-button g-button-28"
                      aria-label={`Use ${label} for new chats`}
                      disabled={busy || accounts === null}
                      onClick={() => void use(id)}
                    >
                      Use
                    </button>
                  )}
                  {account ? (
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      aria-label={`Remove ${account.name}`}
                      disabled={busy}
                      onClick={() => setRemoving(account.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="agent-accounts-actions">
        <button
          type="button"
          className="g-button g-button-primary g-button-28"
          disabled={busy || accounts === null || unavailable !== null}
          onClick={() => setAdding(true)}
        >
          Add account
        </button>
        {unavailable ? <span className="setup-footnote">{unavailable}</span> : null}
      </div>
      {shown ? (
        <p
          className="agent-accounts-note"
          role={error || loadError ? "alert" : "status"}
          data-error={error || loadError ? true : undefined}
        >
          {shown}
        </p>
      ) : null}
      {adding ? (
        <AddAccountDialog
          agentId={agentId}
          agentName={agentName}
          api={api}
          accounts={accounts}
          onClose={() => setAdding(false)}
          onAdded={(next, _id, name) => {
            cache?.set(agentId, next);
            setAdding(false);
            setMessage(
              `Added ${name}. Choose Use to start new chats on it, or switch any chat to it from its composer.`,
            );
          }}
        />
      ) : null}
    </div>
  );
}
