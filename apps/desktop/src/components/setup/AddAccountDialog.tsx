import { useId, useState } from "react";
import type { AgentAccounts } from "../../bindings";
import type { AgentAccountsApi } from "../../lib/agentAccounts";
import { errorMessage } from "../../lib/errors";
import { Modal } from "../chat/Modal";
import { TerminalSheet } from "../TerminalSheet";
import "./accounts.css";

/**
 * Adds a Claude Code account: `claude setup-token` in the terminal sheet signs in to it in the
 * browser and prints a token, which the person pastes here with a name. The token goes straight
 * to Rust and secure storage; this dialog never shows it again.
 */
export function AddAccountDialog({
  agentId,
  agentName,
  api,
  onAdded,
  onClose,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly api: AgentAccountsApi;
  readonly onAdded: (accounts: AgentAccounts, name: string) => void;
  readonly onClose: () => void;
}) {
  const steps = useId();
  const hint = useId();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [terminal, setTerminal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const accounts = await api.add(agentId, name, token);
      setToken("");
      onAdded(accounts, name.trim().replace(/\s+/g, " "));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Add a ${agentName} account`}
      onClose={onClose}
      size="md"
      className="add-account"
      closeDisabled={busy}
    >
      <form
        className="add-account-form"
        aria-describedby={steps}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <ol id={steps} className="add-account-steps">
          <li>
            In your browser, sign in to claude.ai with the account you are adding. The token belongs
            to whichever account the browser approves.
          </li>
          <li>
            Get a token runs <code>claude setup-token</code>, {agentName}'s own sign-in. Approve it,
            then copy the token it prints.
          </li>
          <li>Paste the token below and name the account.</li>
        </ol>
        <div className="ui-row">
          <button
            type="button"
            className="g-button"
            disabled={busy}
            onClick={() => setTerminal(true)}
          >
            Get a token…
          </button>
          {note ? (
            <span className="ui-muted" role="status">
              {note}
            </span>
          ) : null}
        </div>
        <label className="ui-field">
          Name
          <input
            className="g-input"
            value={name}
            maxLength={40}
            placeholder="Work"
            autoComplete="off"
            required
            disabled={busy}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <div className="add-account-field">
          <label className="ui-field">
            Token
            <input
              className="g-input add-account-token"
              type="password"
              value={token}
              placeholder="sk-ant-oat01-…"
              autoComplete="off"
              spellCheck={false}
              required
              disabled={busy}
              aria-describedby={hint}
              onChange={(event) => setToken(event.currentTarget.value)}
            />
          </label>
          <small id={hint} className="ui-muted">
            Kept in this computer's secure storage. auracode never shows it again.
          </small>
        </div>
        {error ? (
          <p role="alert" className="ui-error">
            {error}
          </p>
        ) : null}
        <div className="g-dialog-actions">
          <button type="button" className="g-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="g-button g-button-primary"
            disabled={busy || !name.trim() || !token.trim()}
          >
            {busy ? "Adding…" : "Add account"}
          </button>
        </div>
      </form>
      {terminal ? (
        <TerminalSheet
          agentId={agentId}
          agentName={agentName}
          purpose="token"
          transport={api.tokenTerminal}
          onClose={() => setTerminal(false)}
          onFinished={(exitCode) =>
            setNote(
              exitCode === 0
                ? "Copy the token from the terminal, close it, and paste the token here."
                : "The token command did not finish. Open it again to retry.",
            )
          }
        />
      ) : null}
    </Modal>
  );
}
