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
    <section className="settings-group account-card" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Restore an existing workspace</h3>
      <p>
        Your account key is available, but this secure store has no saved workspace binding. Choose
        the existing Account workspace to restore. Its encrypted identity must match this key. No
        conversations are moved or replaced.
      </p>
      {choices === null ? (
        <button
          className="ui-button"
          type="button"
          disabled={busy || disabled}
          onClick={() => void open()}
        >
          Choose existing workspace
        </button>
      ) : (
        <>
          <label htmlFor={`${id}-profile`}>Existing Account workspace</label>
          <select
            id={`${id}-profile`}
            className="ui-input"
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
            <p>No matching Account workspace was found. Existing files were preserved.</p>
          ) : null}
          <button
            type="button"
            className="ui-button"
            disabled={busy || disabled || !choices.some((profile) => profile.id === selected)}
            onClick={() => void restore()}
          >
            Restore workspace binding
          </button>
        </>
      )}
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
