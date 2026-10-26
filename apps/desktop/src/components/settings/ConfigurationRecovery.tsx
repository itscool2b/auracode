import { invoke } from "@tauri-apps/api/core";
import { ShieldAlert } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { AppInfo, ConfigProfileRecovery } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import "./settings.css";
import "./configuration-recovery.css";

const recover = () => invoke<AppInfo>("config_profile_recover");

export function ConfigurationRecovery({
  recovery,
  locked = false,
  recoverConfiguration = recover,
  onRecovered = () => window.location.reload(),
  children,
}: {
  readonly recovery: ConfigProfileRecovery;
  readonly locked?: boolean;
  readonly recoverConfiguration?: () => Promise<AppInfo>;
  readonly onRecovered?: (info: AppInfo) => void;
  readonly children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acting = useRef(false);
  const unavailable = recovery.phase === "unavailable";
  const restore = recovery.phase === "restore_previous";
  const apply = async () => {
    if (acting.current || unavailable || locked) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    try {
      const info = await recoverConfiguration();
      if (info.config_profile_recovery) {
        setError(info.config_profile_recovery.detail);
      } else {
        onRecovered(info);
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="configuration-recovery orbit-theme">
      <div className="chat-drag" data-tauri-drag-region="" />
      <main className="settings-content" aria-labelledby="configuration-recovery-title">
        <header>
          <span className="configuration-recovery-label">
            <ShieldAlert size={15} aria-hidden="true" />
            Configuration recovery
          </span>
          <h1 id="configuration-recovery-title">
            {unavailable ? "Your settings are preserved" : "Finish opening your workspace"}
          </h1>
          <p>{recovery.detail}</p>
        </header>
        <section className="configuration-recovery-action" aria-label="Recovery action">
          <p>
            {unavailable
              ? "Agents remain stopped while the recovery record is unavailable. No configuration will be guessed or replaced."
              : restore
                ? "Restore the managed settings from before the interrupted switch. Unmanaged settings stay in place."
                : "Verify that the selected profile's managed settings match the saved switch before continuing."}
          </p>
          {locked ? (
            <p className="settings-footnote">
              Unlock the selected account below, then retry recovery.
            </p>
          ) : null}
          {!unavailable ? (
            <button
              className="ui-button"
              type="button"
              disabled={busy || locked}
              onClick={() => void apply()}
            >
              {busy ? "Recovering…" : restore ? "Restore previous settings" : "Finish switching"}
            </button>
          ) : null}
          {busy ? <p role="status">Checking the saved configuration transaction…</p> : null}
          {error ? (
            <p className="settings-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
        {children}
      </main>
    </div>
  );
}
