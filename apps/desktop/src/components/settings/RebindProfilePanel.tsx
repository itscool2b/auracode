import { useId, useState } from "react";
import type { ProfileMeta } from "../../bindings";
import type { AccountStatus } from "../../lib/account/bindings";
import { type AccountRebindApi, accountRebindApi } from "../../lib/account/rebind";
import { errorMessage } from "../../lib/errors";

/** Listing is metadata-only; only the explicit Restore action checks an existing encrypted DB. */
export function RebindProfilePanel({
  api = accountRebindApi,
  profileId = null,
  disabled = false,
  onStatus,
}: {
  readonly api?: AccountRebindApi;
  readonly profileId?: string | null;
  readonly disabled?: boolean;
  readonly onStatus: (value: AccountStatus) => void;
}) {
  const [choices, setChoices] = useState<ProfileMeta[] | null>(null);
  const [selected, setSelected] = useState(profileId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      setChoices(
        (await api.list()).filter(
          (profile) => profile.kind === "account" && (!profileId || profile.id === profileId),
        ),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      onStatus(await api.restore(selected));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-row" aria-labelledby={`${id}-title`}>
      <div className="settings-row-text">
        <div>
          <h3 id={`${id}-title`} className="settings-row-label">
            Restore an existing workspace
          </h3>
          <p>
            Your account key is here, but this secure store has no saved workspace. Choose the
            Account workspace it belongs to; nothing is moved or replaced.
          </p>
        </div>
      </div>
      {choices === null ? (
        <button
          className="g-button g-button-outline g-button-28"
          type="button"
          disabled={busy || disabled}
          onClick={() => void open()}
        >
          Choose existing workspace
        </button>
      ) : null}
      {choices !== null || error ? (
        <div className="settings-span settings-form">
          {choices !== null ? (
            <>
              <label className="settings-field" htmlFor={`${id}-profile`}>
                Existing Account workspace
              </label>
              <select
                id={`${id}-profile`}
                className="g-select account-short-input"
                value={selected}
                disabled={busy || disabled || !!profileId}
                onChange={(event) => setSelected(event.currentTarget.value)}
              >
                <option value="">Choose a workspace</option>
                {choices.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.display_name} · {profile.id}
                  </option>
                ))}
              </select>
              {choices.length === 0 ? (
                <p className="settings-note">
                  No matching Account workspace was found. Existing files were preserved.
                </p>
              ) : null}
              <button
                type="button"
                className="g-button g-button-primary g-button-28"
                disabled={busy || disabled || !choices.some((profile) => profile.id === selected)}
                onClick={() => void restore()}
              >
                Restore workspace binding
              </button>
            </>
          ) : null}
          {error ? (
            <p className="settings-alert" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
