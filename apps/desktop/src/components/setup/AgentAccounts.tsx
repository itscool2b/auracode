import { useCallback, useEffect, useState } from "react";
import type { AgentAccounts as Accounts } from "../../bindings";
import type { AgentAccountsApi } from "../../lib/agentAccounts";
import { errorMessage } from "../../lib/errors";
import { Row } from "../settings/SettingsRow";
import { AddAccountDialog } from "./AddAccountDialog";
import "./accounts.css";

const ADDED = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * An agent's accounts on this device (docs/agent-accounts.md): which one its chats start on, the
 * added ones with Remove, and Add account. Choosing one never restarts a running chat; a chat
 * stopped by a usage limit offers to continue on another one itself.
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
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.list(agentId).then(setAccounts, (reason) => setError(errorMessage(reason)));
  }, [agentId, api]);
  useEffect(load, [load]);
  const change = async (work: () => Promise<Accounts>, done: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setAccounts(await work());
      setMessage(done);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };
  const unavailable = accounts?.unavailable ?? null;
  const active = accounts?.accounts.find((account) => account.id === accounts.active) ?? null;
  return (
    <div className="agent-accounts" data-testid="agent-accounts">
      <Row
        title="Account"
        detail="Chats sign in with it when they start. A running chat keeps its account until it starts again."
      >
        <select
          className="g-select settings-control settings-select"
          aria-label={`${agentName} account`}
          value={accounts?.active ?? ""}
          disabled={busy || accounts === null || accounts.accounts.length === 0}
          onChange={(event) => {
            const id = event.currentTarget.value || null;
            const name = accounts?.accounts.find((account) => account.id === id)?.name;
            void change(
              () => api.use(agentId, id),
              name
                ? `New ${agentName} starts sign in as ${name}.`
                : `New ${agentName} starts use its own sign-in.`,
            );
          }}
        >
          <option value="">Own sign-in</option>
          {accounts?.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </Row>
      {accounts && accounts.accounts.length > 0 ? (
        <ul className="agent-accounts-list" aria-label={`Added ${agentName} accounts`}>
          {accounts.accounts.map((account) => (
            <li key={account.id} className="agent-account">
              <span className="agent-account-name">{account.name}</span>
              <span className="agent-account-meta">
                {account.id === active?.id ? "In use · " : ""}Added{" "}
                {ADDED.format(new Date(account.added_at))}
              </span>
              {removing === account.id ? (
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
                <button
                  type="button"
                  className="g-button g-button-ghost g-button-28"
                  aria-label={`Remove ${account.name}`}
                  disabled={busy}
                  onClick={() => setRemoving(account.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="agent-accounts-actions">
        <button
          type="button"
          className="g-button g-button-28"
          disabled={busy || accounts === null || unavailable !== null}
          onClick={() => setAdding(true)}
        >
          Add account
        </button>
        <span className="setup-footnote">
          {unavailable ??
            "When an account hits its usage limit, its chats can continue on another one."}
        </span>
      </div>
      {error || message ? (
        <p
          className="agent-accounts-note"
          role={error ? "alert" : "status"}
          data-error={error ? true : undefined}
        >
          {error ?? message}
        </p>
      ) : null}
      {adding ? (
        <AddAccountDialog
          agentId={agentId}
          agentName={agentName}
          api={api}
          onClose={() => setAdding(false)}
          onAdded={(next, name) => {
            setAccounts(next);
            setAdding(false);
            setMessage(`Added ${name}. Choose it above, or from a chat at its usage limit.`);
          }}
        />
      ) : null}
    </div>
  );
}
