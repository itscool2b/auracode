import { useState } from "react";
import type { EnvStatus, StorageStatus } from "../../bindings";
import { type DismissState, SHOWN } from "../../lib/dismiss";
import { dismissRecovery } from "../RecoveryNotice";

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
 * database repair notice (dismissable for good), and startup notices (dismissable for now).
 */
export function Banners({
  storage,
  env,
  onRetryEnv,
  recoveryNotice,
  onRecoveryDismissed,
  notices,
}: {
  readonly storage: StorageStatus | null;
  readonly env: EnvStatus | null;
  readonly onRetryEnv: () => void;
  readonly recoveryNotice: string | null;
  readonly onRecoveryDismissed: () => void;
  readonly notices: readonly string[];
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const storageText = storageBanner(storage);
  const envText = envBanner(env);
  const shown = notices.filter((notice) => !dismissed.has(notice));
  if (storageText === null && envText === null && recoveryNotice === null && shown.length === 0) {
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
    </ul>
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
