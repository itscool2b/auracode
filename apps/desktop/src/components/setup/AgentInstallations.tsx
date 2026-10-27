import { useId, useState } from "react";
import type { AgentInstallations as Installations } from "../../bindings";
import { type AgentInstallationsApi, agentInstallationsApi } from "../../lib/agentInstallations";
import { errorMessage } from "../../lib/errors";

export function AgentInstallations({
  agentId,
  onChanged,
  api = agentInstallationsApi,
}: {
  readonly agentId: string;
  readonly onChanged: () => void;
  readonly api?: AgentInstallationsApi;
}) {
  const group = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Installations | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const accept = (value: Installations) => {
    setValue(value);
    setChoice(value.preferred_path ?? value.candidates.find((item) => item.selected)?.path ?? null);
  };
  const load = async () => {
    setOpen(true);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      accept(await api.list(agentId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const save = async (path: string | null) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      accept(await api.select(agentId, path));
      setMessage("Executable choice saved. Running sessions keep their current process.");
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="setup-installations">
      <button
        type="button"
        className="g-button g-button-ghost g-button-28"
        disabled={busy}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : void load())}
      >
        {open ? "Hide executables" : "Choose executable"}
      </button>
      {open ? (
        <div className="setup-installations-panel">
          {busy ? (
            <p role="status" className="setup-footnote">
              Checking executables…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="setup-alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p role="status" className="setup-footnote">
              {message}
            </p>
          ) : null}
          {value?.notice ? (
            <p role="alert" className="setup-alert">
              {value.notice}
            </p>
          ) : null}
          {value ? (
            <fieldset disabled={busy || value.notice !== null}>
              <legend>
                Executable for new sessions
                <small>On this device, in discovery order.</small>
              </legend>
              {value.candidates.length === 0 ? (
                <p>No executables found. Install the vendor CLI, then refresh.</p>
              ) : null}
              {value.candidates.map((candidate) => (
                <label
                  key={candidate.path}
                  className="setup-executable"
                  data-unavailable={candidate.availability.state !== "ready" || undefined}
                >
                  <input
                    type="radio"
                    name={group}
                    value={candidate.path}
                    checked={choice === candidate.path}
                    disabled={candidate.availability.state !== "ready"}
                    onChange={() => setChoice(candidate.path)}
                  />
                  <span>
                    <code>{candidate.path}</code>
                    <small>
                      {candidate.source} ·{" "}
                      {candidate.availability.state === "ready"
                        ? (candidate.availability.version ?? "Version checked")
                        : candidate.availability.state === "checking"
                          ? "Checking"
                          : candidate.availability.reason}
                    </small>
                  </span>
                  {candidate.selected ? (
                    <span className="setup-executable-used">In use</span>
                  ) : null}
                </label>
              ))}
              {value.truncated ? (
                <p className="setup-footnote">
                  Only the first eight executables and 256 PATH folders are shown.
                </p>
              ) : null}
            </fieldset>
          ) : null}
          <div className="setup-executable-actions">
            {value ? (
              <>
                <button
                  type="button"
                  className="g-button g-button-28"
                  disabled={
                    busy ||
                    value.notice !== null ||
                    choice === null ||
                    choice === value.preferred_path ||
                    !value.candidates.some(
                      (item) => item.path === choice && item.availability.state === "ready",
                    )
                  }
                  onClick={() => void save(choice)}
                >
                  Use this executable
                </button>
                {value.preferred_path !== null ? (
                  <button
                    type="button"
                    className="g-button g-button-ghost g-button-28"
                    disabled={busy || value.notice !== null}
                    onClick={() => void save(null)}
                  >
                    Use environment default
                  </button>
                ) : (
                  <span>Using the environment override, then PATH order.</span>
                )}
              </>
            ) : null}
            <button
              type="button"
              className="g-button g-button-ghost g-button-28 setup-recheck"
              disabled={busy}
              onClick={() => void load()}
            >
              Check again
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
