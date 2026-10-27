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
    <section className="settings-row" aria-labelledby={`${id}-title`}>
      <div className="settings-row-text">
        <div>
          <h3 id={`${id}-title`} className="settings-row-label">
            Remove from this device
          </h3>
          <p>
            {localActive
              ? "Permanently erases an Account workspace and its keys here. Signing out does not."
              : "Switch to Local first so your managed configuration is restored safely."}
          </p>
        </div>
      </div>
      {!localActive ? (
        <button
          className="g-button g-button-outline g-button-28"
          type="button"
          disabled={busy || disabled}
          onClick={() => void run(onLocal)}
        >
          Switch to Local before removing
        </button>
      ) : (
        <button
          className="g-button g-button-outline g-button-28"
          type="button"
          disabled={busy || disabled}
          onClick={() => void run(load)}
        >
          Review accounts on this device
        </button>
      )}
      {(localActive && items?.length) || items?.length === 0 || notice || (error && !review) ? (
        <div className="settings-span account-step">
          {localActive && items?.length ? (
            <ul className="account-sublist">
              {items.map((item) => (
                <li key={item.profile_id}>
                  <div>
                    <strong>{item.display_name}</strong>
                    <p>{item.pending ? "Removal needs completion" : "Stored on this computer"}</p>
                  </div>
                  <button
                    className="g-button g-button-outline g-button-28"
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
          {items?.length === 0 ? (
            <p className="settings-note">
              No mapped Account workspaces remain in this data folder.
            </p>
          ) : null}
          {notice ? (
            <p className="settings-note" role="status">
              {notice}
            </p>
          ) : null}
          {error && !review ? (
            <p className="settings-alert" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {review ? (
        <Modal
          title="Remove this Account from the device"
          size="md"
          className="account-device-dialog"
          closeDisabled={busy}
          onClose={() => setReview(null)}
        >
          <div className="account-dialog">
            {error ? (
              <p className="settings-error" role="alert">
                {error}
              </p>
            ) : null}
            <dl className="account-facts">
              <dt>Workspace</dt>
              <dd>{review.display_name}</dd>
              <dt>Id</dt>
              <dd>
                <code>{review.profile_id}</code>
              </dd>
              <dt>Not synced</dt>
              <dd>
                {review.pending_changes === null
                  ? "Unknown. Any local-only data will be lost."
                  : `${review.pending_changes} changes will be lost.`}
              </dd>
            </dl>
            <p>
              {review.other_profiles} other mapped workspace(s) in this data folder are kept. Other
              data folders that use this secure-store bundle lose key access; their files stay and
              need your recovery key to reopen.
            </p>
            <p>
              Cloud data, sessions in other running app instances, agent credentials and
              configuration files are not touched.
            </p>
            {review.resuming ? (
              <p>
                A removal is already recorded and some files may be gone. Continue to finish
                removing the key and cleaning up.
              </p>
            ) : null}
            <label className="settings-check">
              <input
                type="checkbox"
                checked={understood}
                disabled={busy}
                onChange={(event) => setUnderstood(event.currentTarget.checked)}
              />
              I understand that local data and key access will be lost
            </label>
            <label className="settings-field" htmlFor={`${id}-confirmation`}>
              Type REMOVE to erase this workspace and key
            </label>
            <input
              id={`${id}-confirmation`}
              className="g-input"
              value={confirmation}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
            />
            <div className="g-dialog-actions">
              <button
                type="button"
                className="g-button"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Close review
              </button>
              {review.resuming ? (
                <button
                  type="button"
                  className="g-button g-button-ghost"
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
                className="g-button g-button-danger"
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
