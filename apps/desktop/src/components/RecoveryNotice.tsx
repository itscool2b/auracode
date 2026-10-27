import { useState } from "react";
import { type DismissState, dismiss, SHOWN } from "../lib/dismiss";
import { acknowledgeRecovery } from "../lib/ipc";

/**
 * What the Dismiss button does: asks the shell to acknowledge the repair (the command takes no
 * path, so the page cannot pick which repair), reporting each step to `setState`, and calls
 * `onDismissed` once the shell confirmed.
 */
export function dismissRecovery(
  setState: (state: DismissState) => void,
  onDismissed: () => void,
): Promise<void> {
  return dismiss(acknowledgeRecovery, (next) => {
    setState(next);
    if (next.status === "dismissed") onDismissed();
  });
}

/**
 * The notice that the database was damaged and repaired, as an item of the notices list. Unlike
 * the others it comes back on every launch until it is dismissed here, because whatever the
 * repair could not save is only in the damaged copy it names.
 */
export function RecoveryNotice({
  message,
  onDismissed,
}: {
  readonly message: string;
  readonly onDismissed: () => void;
}) {
  const [state, setState] = useState<DismissState>(SHOWN);
  return (
    <RecoveryNoticeView
      message={message}
      state={state}
      onDismiss={() => {
        void dismissRecovery(setState, onDismissed);
      }}
    />
  );
}

/** What `RecoveryNotice` shows in `state`; separate so every state can be rendered on its own. */
export function RecoveryNoticeView({
  message,
  state,
  onDismiss,
}: {
  readonly message: string;
  readonly state: DismissState;
  readonly onDismiss: () => void;
}) {
  if (state.status === "dismissed") return null;
  const busy = state.status === "dismissing";
  return (
    <li className="notice">
      <span className="notice-mark" aria-hidden="true" />
      <div className="notice-body">
        <span className="notice-text">{message}</span>
        <button
          type="button"
          className="g-button g-button-ghost g-button-28 notice-action"
          disabled={busy}
          onClick={onDismiss}
        >
          {busy ? "Dismissing…" : "Dismiss"}
        </button>
        {state.status === "shown" && state.problem !== null ? (
          <span role="alert" className="notice-problem">
            {state.problem}
          </span>
        ) : null}
      </div>
    </li>
  );
}
