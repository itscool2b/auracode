import { Check, ChevronDown, Plus, Settings2, UserRound } from "lucide-react";
import { useState } from "react";
import type { SessionStatus } from "../../bindings";
import {
  type AgentAccountsApi,
  accountName,
  chatAccount,
  chooseChatAccount,
  MAIN_ACCOUNT,
  switchWaits,
  useAgentAccounts,
} from "../../lib/agentAccounts";
import { errorMessage } from "../../lib/errors";
import { AddAccountDialog } from "../setup/AddAccountDialog";
import { movePickerFocus } from "./PickerChoices";
import { closePopover, Popover } from "./Popover";

/**
 * The account this chat's agent signs in with (docs/agent-accounts.md), beside the access and
 * model pickers. Choosing another one starts the agent again on it and resumes the same
 * conversation; adding one signs in to it and moves the chat there straight away.
 */
export function AccountPicker({
  chatId,
  agentId,
  agentName,
  status,
  runningAccount,
  held,
  api,
  onManage,
}: {
  readonly chatId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly status: SessionStatus;
  /** The account the chat's process started on; `null`: the agent's own sign-in. */
  readonly runningAccount: string | null | undefined;
  /** Messages wait in the queue for the agent (a limit, a refused token). */
  readonly held: boolean;
  readonly api: AgentAccountsApi;
  readonly onManage?: () => void;
}) {
  const { accounts, error: loadError, cache } = useAgentAccounts(agentId, api);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!cache || accounts?.unavailable) return null;
  const current = chatAccount(accounts, status, runningAccount);
  const name = accounts ? accountName(accounts, current) : MAIN_ACCOUNT;
  const waits = switchWaits(status);
  /** The popover stays open while the switch runs, so its error shows where it was asked. */
  const choose = async (id: string | null, from?: Element) => {
    setBusy(true);
    setError(null);
    try {
      await chooseChatAccount(cache, { chatId, agentId, status, held }, id);
      if (from) closePopover(from, true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const rows: (string | null)[] = [
    null,
    ...(accounts?.accounts.map((account) => account.id) ?? []),
  ];
  return (
    <>
      <Popover
        label="Account"
        triggerLabel={`Account: ${name}`}
        className="chat-account-popover"
        onOpenChange={(open) => {
          if (open) {
            setError(null);
            void cache.refresh(agentId);
          }
        }}
        trigger={
          <>
            <UserRound size={14} aria-hidden="true" />
            <span className="chat-account-name">{name}</span>
            {busy ? <span className="chat-control-pending">Switching…</span> : null}
            <ChevronDown size={12} />
          </>
        }
      >
        <header className="chat-control-heading">
          <strong>{agentName} account</strong>
          <p>
            {waits
              ? "Switch after this turn finishes, or stop it first."
              : "Switching resumes this conversation on the other account. New chats use it too."}
          </p>
        </header>
        <fieldset
          className="picker-choices"
          aria-label={`${agentName} accounts`}
          onKeyDown={movePickerFocus}
        >
          {rows.map((id) => (
            <button
              key={id ?? "main"}
              type="button"
              aria-pressed={id === current}
              data-testid="picker-account-choice"
              data-picker-value={id ?? "main"}
              disabled={busy || waits || accounts === null}
              onClick={(event) => {
                if (id !== current) void choose(id, event.currentTarget);
              }}
            >
              <span className="picker-choice-copy">
                <strong>{accountName(accounts, id)}</strong>
                {id === null ? <small>The account {agentName} is signed in to</small> : null}
              </span>
              {id === current ? <Check size={14} aria-label="Selected" /> : null}
            </button>
          ))}
        </fieldset>
        <div className="chat-account-actions">
          <button
            type="button"
            className="g-button g-button-28"
            disabled={busy || accounts === null}
            onClick={(event) => {
              closePopover(event.currentTarget);
              setAdding(true);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            Add account
          </button>
          {onManage ? (
            <button
              type="button"
              className="g-button g-button-ghost g-button-28"
              onClick={(event) => {
                closePopover(event.currentTarget);
                onManage();
              }}
            >
              <Settings2 size={14} aria-hidden="true" />
              Manage
            </button>
          ) : null}
        </div>
        {error || loadError ? (
          <p className="chat-account-error ui-error" role="alert">
            {error ?? loadError}
          </p>
        ) : null}
      </Popover>
      {adding ? (
        <AddAccountDialog
          agentId={agentId}
          agentName={agentName}
          api={api}
          accounts={accounts}
          after={waits ? "listed" : "switch"}
          onClose={() => setAdding(false)}
          onAdded={async (next, id) => {
            cache.set(agentId, next);
            if (!waits) await chooseChatAccount(cache, { chatId, agentId, status, held }, id);
            setAdding(false);
          }}
        />
      ) : null}
    </>
  );
}
