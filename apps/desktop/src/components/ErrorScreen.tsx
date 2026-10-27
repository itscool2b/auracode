import { CopyButton, Logo } from "@auracode/ui/graphite";
import { DataPath, Notices } from "./InfoCard";
import "./ErrorScreen.css";

/**
 * Shown instead of the app when startup could not complete: what happened, in aura-core's own
 * words, where the data lives, and what to do. Calm on purpose; nothing was changed or lost.
 */
export function ErrorScreen({
  title,
  message,
  dataDir,
  os,
  notices = [],
}: {
  readonly title: string;
  readonly message: string;
  readonly dataDir: string | null;
  readonly os: string;
  readonly notices?: readonly string[];
}) {
  return (
    <main className="error-screen g-root">
      <div className="error-drag" data-tauri-drag-region="" />
      <section className="error-panel">
        <Logo className="error-logo" size={40} label="auracode" />
        <div className="error-message">
          <h1>{title}</h1>
          <p role="alert">{message}</p>
        </div>
        {dataDir ? (
          <div className="error-well">
            <div className="error-well-head">
              <span>Data folder</span>
              <CopyButton text={dataDir} label="Copy data folder path" />
            </div>
            <DataPath path={dataDir} os={os} prominent />
          </div>
        ) : null}
        {notices.length > 0 ? <Notices notices={notices} /> : null}
        <p className="error-note">
          Nothing was deleted. Fix the problem above, then quit and reopen auracode.
        </p>
      </section>
    </main>
  );
}
