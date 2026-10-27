import { Download, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { UPDATE_LABEL, type UpdatesApi, updateBusy } from "../../lib/updates";

export function UpdatePanel({ api }: { readonly api: UpdatesApi }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const alive = useRef(false);
  const operation = useRef(false);
  const epoch = useRef(0);

  useEffect(() => {
    alive.current = true;
    const request = ++epoch.current;
    api.status().then(
      (next) => {
        if (alive.current && epoch.current === request) setStatus(next);
      },
      (failure) => {
        if (alive.current && epoch.current === request) setError(errorMessage(failure));
      },
    );
    return () => {
      alive.current = false;
      epoch.current++;
    };
  }, [api]);

  const phase = status?.phase;
  useEffect(() => {
    if (!busy && (!phase || !updateBusy(phase))) return;
    let canceled = false;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      const request = epoch.current;
      api
        .status()
        .then(
          (next) => {
            if (!canceled && epoch.current === request) setStatus(next);
          },
          () => undefined,
        )
        .finally(() => {
          reading = false;
        });
    }, 500);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [api, busy, phase]);

  const run = async (action: "status" | "check" | "download" | "install") => {
    if (operation.current) return;
    operation.current = true;
    epoch.current++;
    setBusy(true);
    setError(null);
    setConfirm(false);
    try {
      const next = await api[action]();
      if (alive.current) setStatus(next);
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
    } finally {
      epoch.current++;
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const working = busy || (phase !== undefined && updateBusy(phase));
  return (
    <section className="settings-section" aria-label="Application updates">
      <h2>Updates</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong role="status">
              {status ? UPDATE_LABEL[status.phase] : "Reading update status…"}
            </strong>
            <p>
              {status?.version ? (
                <>
                  Version <span className="settings-mono">{status.version}</span>
                </>
              ) : (
                "Checks run only when you request them."
              )}
            </p>
          </div>
          {status && phase !== "disabled" && phase !== "restart_required" ? (
            phase === "available" ? (
              <button
                type="button"
                className="g-button"
                disabled={working}
                onClick={() => void run("download")}
              >
                <Download size={14} aria-hidden="true" /> Download
              </button>
            ) : phase === "ready" || phase === "waiting_for_idle" ? (
              <button
                type="button"
                className="g-button"
                disabled={working}
                onClick={() => setConfirm(true)}
              >
                Install update
              </button>
            ) : (
              <button
                type="button"
                className="g-button"
                disabled={working}
                onClick={() => void run("check")}
              >
                <RefreshCw size={14} aria-hidden="true" />{" "}
                {working ? "Working…" : "Check for updates"}
              </button>
            )
          ) : null}
        </div>
        {status?.channel === "staging" ? (
          <p className="settings-note" role="status">
            Staging build. Updates are restricted to release qualification builds.
          </p>
        ) : null}
        {status?.message ? <p className="settings-note">{status.message}</p> : null}
        {phase === "downloading" && status ? (
          <div className="settings-download">
            <progress
              aria-label="Update download"
              value={status.total_bytes ? status.downloaded_bytes : undefined}
              max={status.total_bytes ?? undefined}
            />
            <span>
              {(status.downloaded_bytes / 1_048_576).toFixed(1)} MB
              {status.total_bytes
                ? ` of ${(status.total_bytes / 1_048_576).toFixed(1)} MB`
                : " downloaded"}
            </span>
          </div>
        ) : null}
        {status?.notes ? (
          <details className="settings-notes">
            <summary>Release notes</summary>
            <p>{status.notes}</p>
          </details>
        ) : null}
        {confirm ? (
          <div className="settings-confirm">
            <strong>Install and restart auracode?</strong>
            <p>
              Finish active chats and close project terminals first. Your drafts are saved before
              installation. If anything needs attention, the update will wait.
            </p>
            <div>
              <button
                type="button"
                className="g-button g-button-ghost"
                onClick={() => setConfirm(false)}
              >
                Keep working
              </button>
              <button
                type="button"
                className="g-button g-button-primary"
                onClick={() => void run("install")}
              >
                Install and restart
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="settings-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="g-button g-button-28"
            disabled={working}
            onClick={() => void run("status")}
          >
            Reload update status
          </button>
        </div>
      ) : null}
    </section>
  );
}
