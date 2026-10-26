import { Modal } from "../chat/Modal";

export function SignOutDialog({
  pending,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  readonly pending: number | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Modal title="Sign out of auracode?" closeDisabled={busy} onClose={onCancel}>
      <div className="account-card">
        <p>
          {pending === null
            ? "Sync has not confirmed how many changes are waiting. Some of your work may exist only on this device."
            : pending > 0
              ? `The last sync report shows ${pending} ${pending === 1 ? "change" : "changes"} waiting to upload. Sign in again on this device to sync that work.`
              : "The last sync report had no changes waiting. Any work saved since that report will sync after you sign in again."}
        </p>
        <p>Your encrypted workspace stays on this device. Signing out pauses sync.</p>
        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="account-actions">
          <button className="ui-button" type="button" disabled={busy} onClick={onCancel}>
            Stay signed in
          </button>
          <button className="ui-button" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? "Signing out…" : "Sign out now"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
