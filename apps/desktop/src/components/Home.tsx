import type { AppInfo } from "../bindings";
import type { StreamStore } from "../lib/session";
import { DemoPanel } from "./DemoPanel";
import { InfoCard } from "./InfoCard";

/** Local diagnostics: the stream fixture and facts about this launch. */
export function Home({
  info,
  store,
  onOpenStress,
  onRecoveryDismissed,
}: {
  readonly info: AppInfo;
  readonly store: StreamStore;
  readonly onOpenStress: () => void;
  /** The shell acknowledged the database repair, so its notice goes for good. */
  readonly onRecoveryDismissed: () => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-[1180px] flex-col gap-8">
      <header className="flex flex-col gap-3 pt-6">
        <p className="eyebrow m-0">Workspace / Diagnostics</p>
        <h1 className="diagnostics-title">Diagnostics</h1>
        <p className="lede m-0">
          Check this device and try a local sample stream. No agent request is sent.
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] items-start gap-5 max-[1180px]:grid-cols-1">
        <div className="flex h-full min-h-[420px] flex-col">
          <DemoPanel store={store} onOpenStress={onOpenStress} />
        </div>
        <InfoCard info={info} onRecoveryDismissed={onRecoveryDismissed} />
      </div>
    </div>
  );
}
