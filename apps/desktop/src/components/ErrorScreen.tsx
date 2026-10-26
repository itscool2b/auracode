import { OrbitMark } from "@auracode/ui/orbit";
import { DataPath, Notices } from "./InfoCard";

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
    <main
      className="diagnostics-shell orbit-theme relative flex h-full items-center justify-center p-10"
      data-theme="dark"
    >
      <div className="drag-strip" data-tauri-drag-region="" />
      <section className="diagnostics-panel flex w-full max-w-[600px] flex-col gap-5 p-8">
        <OrbitMark agent="generic" state="error" size={48} label="auracode could not start" />
        <div className="flex flex-col gap-3">
          <h1 className="diagnostics-title">{title}</h1>
          <p role="alert" className="m-0 text-[15px] text-(--aura-text-1) select-text">
            {message}
          </p>
        </div>
        {dataDir ? (
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Data folder</span>
            <DataPath path={dataDir} os={os} prominent />
          </div>
        ) : null}
        {notices.length > 0 ? <Notices notices={notices} /> : null}
        <p className="muted m-0 text-sm">
          Nothing was deleted. Fix the problem above, then quit and reopen auracode.
        </p>
      </section>
    </main>
  );
}
