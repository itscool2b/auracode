import { type ReactNode, useId, useState } from "react";
import type { EnvStatus, StorageStatus } from "../../bindings";
import { type DismissState, SHOWN } from "../../lib/dismiss";
import type { AgentEditState } from "../../lib/projectMemory";
import { dismissRecovery } from "../RecoveryNotice";

/** An agent's direct edit to project memory, as the window's banner shows it. */
export interface MemoryEditBanner {
  readonly key: string;
  /** "Claude Code in Fix the login flow updated project memory for auracode." */
  readonly text: string;
  readonly state: AgentEditState;
  /** Opens Customize > Project memory on the edit, with its changes. */
  readonly onReview?: () => void;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

/** The sentence a storage problem shows, or `null` while saving runs. */
export function storageBanner(storage: StorageStatus | null): string | null {
  if (storage === null) return null;
  switch (storage.state.state) {
    case "ok":
      return null;
    case "paused":
      return storage.state.reason === "disk_full"
        ? "The disk is full. auracode paused saving and the agents are waiting. Free some space; nothing is lost unless you quit now."
        : "auracode's database is busy (another program is using it). auracode paused saving and the agents are waiting; nothing is lost unless you quit now.";
    case "failed":
      return storage.state.message;
  }
}

/** The sentence an environment fallback shows, or `null` when the login shell's env is in use. */
export function envBanner(env: EnvStatus | null): string | null {
  if (env?.state.state !== "fallback") return null;
  return `auracode couldn't read your shell's environment (${env.state.reason}), so agents start with a basic one and may not find their tools.`;
}

/**
 * The window's banners: saving paused or failed, the environment fallback with Retry, the
 * database repair notice (dismissable for good), startup notices (dismissable for now), agents'
 * direct edits to project memory, with Review and Undo, and agents' newer releases (`updates`,
 * their rows), each until its X for this run of auracode.
 */
export function Banners({
  storage,
  env,
  onRetryEnv,
  recoveryNotice,
  onRecoveryDismissed,
  notices,
  memoryEdits = [],
  updates = [],
}: {
  readonly storage: StorageStatus | null;
  readonly env: EnvStatus | null;
  readonly onRetryEnv: () => void;
  readonly recoveryNotice: string | null;
  readonly onRecoveryDismissed: () => void;
  readonly notices: readonly string[];
  readonly memoryEdits?: readonly MemoryEditBanner[];
  readonly updates?: readonly ReactNode[];
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const storageText = storageBanner(storage);
  const envText = envBanner(env);
  const shown = notices.filter((notice) => !dismissed.has(notice));
  if (
    storageText === null &&
    envText === null &&
    recoveryNotice === null &&
    shown.length === 0 &&
    memoryEdits.length === 0 &&
    updates.length === 0
  ) {
    return null;
  }
  return (
    <ul className="chat-banners" aria-label="Notices">
      {storageText !== null ? (
        <li
          className="chat-banner"
          data-level={storage?.state.state === "failed" ? "error" : "warning"}
        >
          <span role="status">{storageText}</span>
        </li>
      ) : null}
      {envText !== null ? (
        <li className="chat-banner" data-level="warning">
          <span>{envText}</span>
          <button type="button" className="g-button g-button-28" onClick={onRetryEnv}>
            Retry
          </button>
        </li>
      ) : null}
      {recoveryNotice !== null ? (
        <RecoveryBanner message={recoveryNotice} onDismissed={onRecoveryDismissed} />
      ) : null}
      {shown.map((notice) => (
        <li key={notice} className="chat-banner">
          <span>{notice}</span>
          <button
            type="button"
            className="g-button g-button-ghost g-button-28"
            onClick={() => setDismissed((current) => new Set([...current, notice]))}
          >
            Dismiss
          </button>
        </li>
      ))}
      {memoryEdits.map((edit) => (
        <MemoryEditBannerView key={edit.key} edit={edit} />
      ))}
      {updates}
    </ul>
  );
}

/**
 * An agent's direct edit to project memory: a calm notice that never blocks the chat. Review opens
 * the edit's changes; Undo restores what it replaced as a new revision of the person's.
 */
export function MemoryEditBannerView({ edit }: { readonly edit: MemoryEditBanner }) {
  const text = useId();
  const { state } = edit;
  return (
    <li className="chat-banner" data-testid="memory-edit-banner">
      <span id={text} role="status">
        {edit.text}
        {state.status === "failed" ? (
          <span role="alert" className="ui-error">
            {" "}
            {state.message}
          </span>
        ) : null}
      </span>
      {edit.onReview && state.status !== "undone" ? (
        <button
          type="button"
          className="g-button g-button-28"
          aria-describedby={text}
          disabled={state.status === "undoing"}
          onClick={edit.onReview}
        >
          Review
        </button>
      ) : null}
      {state.status === "shown" || state.status === "undoing" ? (
        <button
          type="button"
          className="g-button g-button-28"
          aria-describedby={text}
          disabled={state.status === "undoing"}
          onClick={edit.onUndo}
        >
          {state.status === "undoing" ? "Undoing…" : "Undo"}
        </button>
      ) : null}
      <button
        type="button"
        className="g-button g-button-ghost g-button-28"
        aria-describedby={text}
        disabled={state.status === "undoing"}
        onClick={edit.onDismiss}
      >
        Dismiss
      </button>
    </li>
  );
}

/**
 * The database repair notice: it shows on every launch until dismissed here, because whatever the
 * repair could not save is only in the damaged copy it names. The shell must confirm first.
 */
export function RecoveryBanner({
  message,
  onDismissed,
}: {
  readonly message: string;
  readonly onDismissed: () => void;
}) {
  const [state, setState] = useState<DismissState>(SHOWN);
  return (
    <RecoveryBannerView
      message={message}
      state={state}
      onDismiss={() => {
        void dismissRecovery(setState, onDismissed);
      }}
    />
  );
}

/** What `RecoveryBanner` shows in `state`. */
export function RecoveryBannerView({
  message,
  state,
  onDismiss,
}: {
  readonly message: string;
  readonly state: DismissState;
  readonly onDismiss: () => void;
}) {
  if (state.status === "dismissed") return null;
  return (
    <li className="chat-banner" data-level="warning">
      <span>
        {message}
        {state.status === "shown" && state.problem !== null ? (
          <span role="alert" className="ui-error">
            {" "}
            {state.problem}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        className="g-button g-button-ghost g-button-28"
        disabled={state.status === "dismissing"}
        onClick={onDismiss}
      >
        {state.status === "dismissing" ? "Dismissing…" : "Dismiss"}
      </button>
    </li>
  );
}
