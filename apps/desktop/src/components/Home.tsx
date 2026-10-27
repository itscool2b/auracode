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
    <div className="diagnostics-home">
      <header className="diagnostics-header">
        <h1 className="diagnostics-title">Diagnostics</h1>
        <p className="lede">
          Check this device and try a local sample stream. No agent request is sent.
        </p>
      </header>
      <div className="diagnostics-grid">
        <div className="diagnostics-demo">
          <DemoPanel store={store} onOpenStress={onOpenStress} />
        </div>
        <InfoCard info={info} onRecoveryDismissed={onRecoveryDismissed} />
      </div>
    </div>
  );
}
