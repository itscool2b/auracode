import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  AccountAccess,
  AccountResetReview,
  AccountResetStatus,
  AccountStatus,
} from "../../lib/account/bindings";
import { type AccountResetApi, accountResetApi } from "../../lib/account/reset";
import { errorMessage } from "../../lib/errors";

export function ResetSyncPanel({
  api = accountResetApi,
  access,
  disabled = false,
  allowReview = true,
  onStatus,
}: {
  readonly api?: AccountResetApi;
  readonly access: AccountAccess;
  readonly disabled?: boolean;
  readonly allowReview?: boolean;
  readonly onStatus: (status: AccountStatus) => void;
}) {
  const [pending, setPending] = useState<AccountResetStatus | null>(null);
  const [review, setReview] = useState<AccountResetReview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [retained, setRetained] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const mounted = useRef(false);
  const acting = useRef(false);
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    void access;
    let live = true;
    void api.status().then(
      (value) => {
        if (live) setPending(value);
      },
      (failure) => {
        if (live) setError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [api, access]);
  const run = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      try {
        const state = await api.status();
        if (mounted.current) setPending(state);
      } catch {}
      acting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const finish = async (operation: Promise<AccountStatus>) => {
    const status = await operation;
    if (mounted.current) {
      setReview(null);
      setConfirmation("");
      setRetained(false);
      onStatus(status);
    }
  };
  const locked = disabled || busy;
  const authenticated = !["signed_out", "expired", "denied", "deleted"].includes(access);
  if (!pending?.pending && !expanded)
    return allowReview ? (
      // X Money's chevron row: the whole row opens the reset review.
      <button
        className="settings-link"
        type="button"
        disabled={locked}
        onClick={() => setExpanded(true)}
      >
        <span>Lost every device and recovery key?</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    ) : null;
  if (!pending?.pending && !allowReview) return null;
  return (
    <section className="settings-row" aria-labelledby={`${id}-title`}>
      <div className="settings-row-text">
        <div>
          <h3 id={`${id}-title`} className="settings-row-label">
            Start encrypted sync again
          </h3>
          <p>
            Only when every approved device and your recovery key are lost. Reset permanently
            removes the encrypted cloud data and revokes your other devices; old conversations
            cannot be recovered. Local encrypted profiles stay on their computers.
          </p>
        </div>
      </div>
      <div className="settings-span account-step">
        {!authenticated ? (
          <p className="settings-note">Sign in again to verify your email before continuing.</p>
        ) : null}
        {pending?.pending ? (
          <>
            <p className="settings-note" role="status">
              A reset request is already saved. Its new key is kept until the result is verified,
              and retrying sends the same request.
            </p>
            <div className="settings-actions">
              <button
                className="g-button g-button-outline g-button-28"
                type="button"
                disabled={locked || !authenticated}
                onClick={() => void run(() => finish(api.retry()))}
              >
                {pending.committed ? "Finish reset locally" : "Retry saved reset"}
              </button>
              <button
                className="g-button g-button-ghost g-button-28"
                type="button"
                disabled={locked || !authenticated}
                onClick={() => void run(() => finish(api.cancel()))}
              >
                Cancel pending reset safely
              </button>
            </div>
          </>
        ) : null}
        {pending && !pending.pending && !review ? (
          <div className="settings-actions">
            <button
              className="g-button g-button-outline g-button-28"
              type="button"
              disabled={locked || access !== "pending_approval"}
              onClick={() =>
                void run(async () => {
                  const next = await api.review();
                  if (mounted.current) {
                    setReview(next);
                    setRetained(false);
                    setConfirmation("");
                  }
                })
              }
            >
              Review reset sync
            </button>
          </div>
        ) : null}
        {review && !pending?.pending ? (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => finish(api.confirm(review.id, confirmation, retained)));
            }}
          >
            <p className="settings-note">
              This removes {review.records} encrypted cloud records and {review.blobs} encrypted
              blobs, and revokes {review.other_devices} other devices. The new key generation is{" "}
              {review.key_version}. Your email check and this review must still be fresh when you
              confirm.
            </p>
            <label className="settings-field" htmlFor={`${id}-key`}>
              New recovery key
            </label>
            <textarea
              id={`${id}-key`}
              className="g-textarea account-secret"
              value={review.recovery_key}
              readOnly
              spellCheck={false}
            />
            <label className="settings-check">
              <input
                type="checkbox"
                checked={retained}
                disabled={locked}
                onChange={(event) => setRetained(event.currentTarget.checked)}
              />
              I saved this new recovery key somewhere safe
            </label>
            <label className="settings-field" htmlFor={`${id}-confirm`}>
              Type RESET SYNC to permanently remove the old cloud data
            </label>
            <input
              id={`${id}-confirm`}
              className="g-input account-short-input"
              value={confirmation}
              disabled={locked}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
            />
            <div className="settings-actions">
              <button
                className="g-button g-button-danger"
                type="submit"
                disabled={locked || !retained || confirmation !== "RESET SYNC"}
              >
                Permanently reset sync
              </button>
              <button
                className="g-button g-button-ghost"
                type="button"
                disabled={locked}
                onClick={() => void run(() => finish(api.dismiss()))}
              >
                Cancel review
              </button>
            </div>
          </form>
        ) : null}
        {error ? (
          <p className="settings-alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
