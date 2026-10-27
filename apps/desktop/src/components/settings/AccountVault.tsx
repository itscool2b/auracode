import { useEffect, useId, useRef, useState } from "react";
import type { AccountVaultStatus } from "../../lib/account/bindings";
import { type AccountVaultApi, accountVaultApi } from "../../lib/account/vault";
import { errorMessage } from "../../lib/errors";

export function AccountVault({
  api = accountVaultApi,
  onUnlocked,
}: {
  readonly api?: AccountVaultApi;
  readonly onUnlocked: () => void;
}) {
  const [status, setStatus] = useState<AccountVaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const acting = useRef(false);
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    void api.status().then(
      (value) => {
        if (mounted.current) setStatus(value);
      },
      (failure) => {
        if (mounted.current) setError(errorMessage(failure));
      },
    );
    return () => {
      mounted.current = false;
    };
  }, [api]);
  const submit = async () => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    const secret = passphrase;
    setPassphrase("");
    setConfirmation("");
    try {
      const next = await api.unlock(secret, creating);
      if (mounted.current) {
        setStatus(next);
        setCreating(false);
        if (next.mode === "passphrase_unlocked") onUnlocked();
      }
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      acting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const form = creating || (status?.mode === "passphrase_locked" && !status.can_create);
  return (
    <section className="account-card" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Secure storage</h3>
      {status?.mode === "native" ? (
        <p>
          Your account keys use this computer's secure storage. You can explicitly choose an
          encrypted passphrase store if it is unavailable.
        </p>
      ) : null}
      {status?.mode === "restart_required" ? (
        <p role="status">
          The passphrase store is ready. Quit and reopen auracode to use it. Current account
          services stay in place until then.
        </p>
      ) : null}
      {status?.mode === "passphrase_unlocked" ? (
        <p role="status">Your passphrase store is unlocked until auracode closes.</p>
      ) : null}
      {status?.mode === "passphrase_locked" ? (
        <p>
          Unlock your selected passphrase store. Account data remains encrypted while it is locked.
        </p>
      ) : null}
      {status?.can_create && !creating ? (
        <button
          className="g-button"
          type="button"
          disabled={busy}
          onClick={() => setCreating(true)}
        >
          Use a passphrase store
        </button>
      ) : null}
      {form ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {creating ? (
            <p>
              Choose a passphrase you can retain. Existing OS-stored accounts remain there; restore
              access to each account with device approval or its recovery key to use this store.
              Forgetting this passphrase can lock its local data.
            </p>
          ) : null}
          <label htmlFor={`${id}-passphrase`}>Passphrase</label>
          <input
            id={`${id}-passphrase`}
            className="g-input"
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            minLength={12}
            maxLength={1024}
            value={passphrase}
            disabled={busy}
            onChange={(event) => setPassphrase(event.currentTarget.value)}
            required
          />
          {creating ? (
            <>
              <label htmlFor={`${id}-confirm`}>Confirm passphrase</label>
              <input
                id={`${id}-confirm`}
                className="g-input"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.currentTarget.value)}
                required
              />
            </>
          ) : null}
          <div className="account-actions">
            <button
              className="g-button g-button-primary"
              type="submit"
              disabled={busy || passphrase.length < 12 || (creating && passphrase !== confirmation)}
            >
              {busy
                ? "Opening secure storage…"
                : creating
                  ? "Create passphrase store"
                  : "Unlock store"}
            </button>
            {creating ? (
              <button
                className="g-button g-button-ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setCreating(false);
                  setPassphrase("");
                  setConfirmation("");
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
      {!status && !error ? (
        <p role="status" className="settings-footnote">
          Checking storage selection…
        </p>
      ) : null}
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
