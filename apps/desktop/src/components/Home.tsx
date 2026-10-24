import type { AppInfo } from "../bindings";
import type { StreamStore } from "../lib/session";
import { DemoPanel } from "./DemoPanel";
import { InfoCard } from "./InfoCard";

/** The M0 home: the editorial headline, the demo stream, and the facts about this launch. */
export function Home({
  info,
  store,
  onOpenStress,
}: {
  readonly info: AppInfo;
  readonly store: StreamStore;
  readonly onOpenStress: () => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-[1180px] flex-col gap-8">
      <header className="flex flex-col gap-3 pt-6">
        <p className="eyebrow m-0">Milestone 0 · the shell</p>
        <h1 className="display m-0">
          Every agent, <em>one aura.</em>
        </h1>
        <p className="lede m-0">
          The native window, typed commands, a streaming channel and the profile store are live.
          Agents arrive next; until then a scripted one shows how a turn will feel.
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] items-start gap-5 max-[1180px]:grid-cols-1">
        <div className="flex h-full min-h-[420px] flex-col">
          <DemoPanel store={store} onOpenStress={onOpenStress} />
        </div>
        <InfoCard info={info} />
      </div>
    </div>
  );
}
