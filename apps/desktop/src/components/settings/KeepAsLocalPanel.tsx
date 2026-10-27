import { useState } from "react";
import type { KeepLocalPreview, KeepLocalResult } from "../../bindings";
import { type AccountPreservationApi, accountPreservationApi } from "../../lib/accountPreservation";
import { errorMessage } from "../../lib/errors";
import { Modal } from "../chat/Modal";
import "./local-import.css";
import "./keep-local.css";
import "./settings.css";

/** Mount only for Deleted with the matching retained Account profile unlocked. No automatic copy. */
export function KeepAsLocalPanel({
  api = accountPreservationApi,
  onOpen,
}: {
  readonly api?: AccountPreservationApi;
  readonly onOpen: (profileId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<KeepLocalPreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KeepLocalResult | null>(null);
  const preview = async () => {
    if (busy) return;
    setOpen(true);
    setBusy(true);
    setError(null);
    setReview(null);
    setAccepted(false);
    try {
      setReview(await api.preview());
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!review || !accepted || busy) return;
    const token = review.token;
    setReview(null);
    setAccepted(false);
    setBusy(true);
    setError(null);
    try {
      setResult(await api.apply(token));
      setOpen(false);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const activate = async () => {
    if (!result || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(result.profile_id);
    } catch (error) {
      setError(`The Local copy is saved. ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section local-import-panel" aria-labelledby="keep-local-title">
      <h3 id="keep-local-title">Keep your workspace</h3>
      <p>This account was deleted. Its encrypted workspace remains on this computer.</p>
      {!result ? (
        <button type="button" className="g-button" disabled={busy} onClick={() => void preview()}>
          Review Keep as Local
        </button>
      ) : (
        <>
          <p role="status">
            Saved {result.projects} project(s) and {result.chats} chat(s) in a separate Local
            profile.
            {result.missing_attachments > 0 &&
              ` ${result.missing_attachments} attachment(s) were unavailable and remain missing.`}
          </p>
          <button
            type="button"
            className="g-button"
            disabled={busy}
            onClick={() => void activate()}
          >
            Open Local copy
          </button>
        </>
      )}
      {!open && error && (
        <p role="alert" className="settings-alert">
          {error}
        </p>
      )}
      {open && (
        <Modal title="Keep a Local copy" onClose={() => setOpen(false)} closeDisabled={busy}>
          {busy && (
            <p role="status" className="settings-footnote">
              Preparing the Local copy…
            </p>
          )}
          {error && (
            <p role="alert" className="settings-alert">
              {error}
            </p>
          )}
          {review && (
            <>
              <p>
                {review.projects} project(s), {review.chats} chat(s), {review.turns} turn(s).
              </p>
              <ul className="local-import-notices">
                {review.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
              <label className="keep-local-consent">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={busy}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                I understand this separate Local copy is unencrypted.
              </label>
            </>
          )}
          <footer className="local-import-actions">
            <button
              type="button"
              className="g-button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            {review ? (
              <button
                type="button"
                className="g-button g-button-primary"
                disabled={busy || !accepted}
                onClick={() => void apply()}
              >
                Create Local copy
              </button>
            ) : (
              <button
                type="button"
                className="g-button"
                disabled={busy}
                onClick={() => void preview()}
              >
                Review again
              </button>
            )}
          </footer>
        </Modal>
      )}
    </section>
  );
}
