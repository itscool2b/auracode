import { Check, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import type { AccountUsage, SessionStatus } from "../../bindings";
import {
  type AgentAccountsApi,
  accountName,
  accountUsage,
  chatAccount,
  chooseChatAccount,
  MAIN_ACCOUNT,
  switchWaits,
  useAgentAccounts,
} from "../../lib/agentAccounts";
import { errorMessage } from "../../lib/errors";
import { AccountUsageMeters } from "../setup/AccountUsageMeters";
import { AddAccountDialog } from "../setup/AddAccountDialog";
import { movePickerFocus } from "./PickerChoices";
import { closePopover, Popover } from "./Popover";

/** The share of the account's fullest usage window, or `null` before any report. */
export function usagePeak(usage: AccountUsage | null): number | null {
  if (!usage?.windows.length) return null;
  return usage.windows.reduce((most, window) => Math.max(most, window.used_percent ?? 0), 0);
}

const RING_RADIUS = 10;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The chip's face: the account's initial in a disc, ringed by its fullest usage window, so the
 * composer says which account answers and how much of it is left without spelling either out.
 */
export function AccountAvatar({
  name,
  peak,
}: {
  readonly name: string;
  readonly peak: number | null;
}) {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";
  const share = peak === null ? null : Math.min(1, Math.max(0, peak / 100));
  return (
    <span
      className="chat-account-avatar"
      data-full={share !== null && share >= 1 ? "" : undefined}
      aria-hidden="true"
    >
      <svg
        className="chat-account-rings"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        focusable="false"
        aria-hidden="true"
      >
        <circle className="chat-account-ring-track" cx="12" cy="12" r={RING_RADIUS} />
        {share ? (
          <circle
            className="chat-account-ring"
            cx="12"
            cy="12"
            r={RING_RADIUS}
            strokeDasharray={`${share * RING_LENGTH} ${RING_LENGTH}`}
            transform="rotate(-90 12 12)"
          />
        ) : null}
      </svg>
      <span className="chat-account-initial">{initial}</span>
    </span>
  );
}

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
  const { accounts, error: loadError, usage, cache } = useAgentAccounts(agentId, api);
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
  const currentUsage = accountUsage(usage, current);
  const peak = usagePeak(currentUsage);
  return (
    <>
      <Popover
        label="Account"
        triggerLabel={`Account: ${name}`}
        tip={`Account: ${name}${peak === null ? "" : ` · ${Math.round(peak)}% used`}`}
        className={`chat-account-popover${busy ? " chat-account-busy" : ""}`}
        onOpenChange={(open) => {
          if (open) {
            setError(null);
            void cache.refresh(agentId);
          }
        }}
        trigger={
          <>
            <AccountAvatar name={name} peak={peak} />
            {busy ? <span className="chat-control-pending">Switching…</span> : null}
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
                {accountUsage(usage, id) ? (
                  <AccountUsageMeters compact usage={accountUsage(usage, id)} />
                ) : id === null ? (
                  <small>The account {agentName} is signed in to</small>
                ) : null}
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
