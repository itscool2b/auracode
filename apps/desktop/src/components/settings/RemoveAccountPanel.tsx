import { useId, useRef, useState } from "react";
import type {
  AccountRemovalCandidate,
  AccountRemovalReview,
  AccountStatus,
} from "../../lib/account/bindings";
import { type AccountRemovalApi, accountRemovalApi } from "../../lib/account/removal";
import { errorMessage } from "../../lib/errors";
import { Modal } from "../chat/Modal";
export function RemoveAccountPanel({
  api = accountRemovalApi,
  localActive,
  disabled = false,
  onLocal,
  onStatus,
}: {
  readonly api?: AccountRemovalApi;
  readonly localActive: boolean;
  readonly disabled?: boolean;
  readonly onLocal: () => Promise<void>;
  readonly onStatus: (value: AccountStatus) => void;
}) {
  const [items, setItems] = useState<AccountRemovalCandidate[] | null>(null);
  const [review, setReview] = useState<AccountRemovalReview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const acting = useRef(false);
  const id = useId();
  const run = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  const load = async () => setItems(await api.list());
  const open = async (profileId: string) => {
    setReview(await api.preview(profileId));
    setConfirmation("");
    setUnderstood(false);
  };
  const apply = async () => {
    if (!review) return;
    const token = review.token;
    setReview(null);
    setConfirmation("");
    setUnderstood(false);
    try {
      onStatus(await api.apply(token, confirmation));
      setNotice(
        "Removed this workspace and its auracode account key from this device. Cloud data and other profile files were not changed.",
      );
    } finally {
      await load();
    }
  };
  return (
    <section className="settings-section account-card" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Remove from this device</h3>
      <p>
        This is separate from signing out. It permanently erases a selected local Account workspace
        and auracode's account and device key bundle.
      </p>
      {!localActive ? (
        <>
          <p>
            Switch to Local first so your managed configuration is restored safely. If recovery
            cannot finish, removal stays unavailable.
          </p>
          <button
            className="ui-button"
            type="button"
            disabled={busy || disabled}
            onClick={() => void run(onLocal)}
          >
            Switch to Local before removing
          </button>
        </>
      ) : (
        <button
          className="ui-button"
          type="button"
          disabled={busy || disabled}
          onClick={() => void run(load)}
        >
          Review accounts on this device
        </button>
      )}
      {localActive && items ? (
        <ul className="account-devices">
          {items.map((item) => (
            <li key={item.profile_id}>
              <div>
                <strong>{item.display_name}</strong>
                <p>{item.pending ? "Removal needs completion" : "Stored on this computer"}</p>
              </div>
              <button
                className="ui-button"
                type="button"
                disabled={busy || disabled}
                onClick={() => void run(() => open(item.profile_id))}
              >
                {item.pending ? "Review pending removal" : "Review removal"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {items?.length === 0 ? <p>No mapped Account workspaces remain in this data folder.</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error && !review ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {review ? (
        <Modal
          title="Remove this Account from the device"
          className="account-device-dialog"
          closeDisabled={busy}
          onClose={() => setReview(null)}
        >
          <div className="account-card account-removal-body">
            {error ? (
              <p className="settings-error" role="alert">
                {error}
              </p>
            ) : null}
            <h3>{review.display_name}</h3>
            <p>
              Selected workspace: <code>{review.profile_id}</code>
            </p>
            <p>
              {review.pending_changes === null
                ? "The number of changes not yet synced is unknown. Any remaining local-only data will be lost."
                : `${review.pending_changes} changes have not yet synced and will be lost.`}
            </p>
            <p>
              {review.other_profiles} other mapped workspace(s) in this data folder are kept. Other
              isolated data folders using this same secure-store bundle will lose key access; their
              files stay untouched and need your recovery key to reopen.
            </p>
            <p>
              This does not delete cloud data or revoke sessions in other running app instances.
              Existing agent credentials and configuration files are untouched.
            </p>
            {review.resuming ? (
              <p>
                A removal is already recorded. Some files may already be gone. Continue to finish
                key and cleanup removal.
              </p>
            ) : null}
            <label className="account-check">
              <input
                type="checkbox"
                checked={understood}
                disabled={busy}
                onChange={(event) => setUnderstood(event.currentTarget.checked)}
              />
              I understand that local data and key access will be lost
            </label>
            <label htmlFor={`${id}-confirmation`}>
              Type REMOVE to erase this workspace and key
            </label>
            <input
              id={`${id}-confirmation`}
              className="ui-input"
              value={confirmation}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
            />
            <div className="account-actions">
              <button
                type="button"
                className="ui-button"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Close review
              </button>
              {review.resuming ? (
                <button
                  type="button"
                  className="ui-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      onStatus(await api.cancel(review.token));
                      setReview(null);
                      await load();
                      setNotice(
                        "The unstarted removal was cancelled. No workspace files were erased.",
                      );
                    })
                  }
                >
                  Cancel unstarted removal
                </button>
              ) : null}
              <button
                type="button"
                className="ui-button"
                data-kind="danger"
                disabled={busy || disabled || !understood || confirmation !== "REMOVE"}
                onClick={() => void run(apply)}
              >
                Permanently remove from device
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
