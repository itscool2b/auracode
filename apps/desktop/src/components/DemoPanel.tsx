import { useId, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useStream } from "../lib/hooks";
import { isRunning, type StreamSnapshot, type StreamStore } from "../lib/session";
import { ChevronIcon } from "./icons";
import { Transcript } from "./Transcript";

/** Tokens for "Start stress" in this panel: a long answer that keeps streaming for a while. */
const PANEL_STRESS_TOKENS = 3_000;

const PHASE_LABEL: Record<StreamSnapshot["phase"], string> = {
  idle: "Ready",
  starting: "Starting",
  streaming: "Streaming",
  ended: "Finished",
  failed: "Failed",
};

/** The mock agent: start a demo or stress turn, set its speed, stop it, and watch it render. */
export function DemoPanel({
  store,
  onOpenStress,
}: {
  readonly store: StreamStore;
  readonly onOpenStress: () => void;
}) {
  const snapshot = useStream(store);
  const [rate, setRate] = useState(120);
  const [problem, setProblem] = useState<string | null>(null);
  const rateId = useId();
  const running = isRunning(snapshot);

  const run = (start: () => Promise<unknown>): void => {
    setProblem(null);
    start().catch((error: unknown) => setProblem(errorMessage(error)));
  };

  return (
    <section className="diagnostics-panel demo-panel">
      <div className="demo-panel-head">
        <h2 className="panel-title">Demo stream</h2>
        <span className="demo-panel-phase" aria-live="polite">
          {PHASE_LABEL[snapshot.phase]}
        </span>
      </div>

      <div className="demo-panel-actions">
        <button
          type="button"
          className="g-button g-button-primary"
          disabled={running}
          onClick={() => run(() => store.start({ type: "demo" }, rate))}
        >
          Start demo
        </button>
        <button
          type="button"
          className="g-button"
          disabled={running}
          onClick={() =>
            run(() => store.start({ type: "stress", total_tokens: PANEL_STRESS_TOKENS }, rate))
          }
        >
          Start stress
        </button>
        <button
          type="button"
          className="g-button"
          disabled={!running}
          onClick={() => run(() => store.stop())}
        >
          Stop
        </button>
        <div className="field demo-panel-rate">
          <label htmlFor={rateId}>Tokens/s</label>
          <input
            id={rateId}
            type="range"
            min={10}
            max={2000}
            step={10}
            value={rate}
            onChange={(event) => setRate(Number(event.currentTarget.value))}
          />
          <output htmlFor={rateId}>{rate}</output>
        </div>
      </div>

      {/* A button, not a checkbox: it opens another screen rather than switching a setting. */}
      <button
        type="button"
        className="g-button g-button-ghost demo-panel-stress"
        onClick={onOpenStress}
      >
        Stress view <span className="muted">(orbs, aura, fast stream, frame rate)</span>
        <ChevronIcon width={12} height={12} />
      </button>

      {(problem ?? snapshot.error) ? (
        <p role="alert" className="diagnostics-alert">
          {problem ?? snapshot.error}
        </p>
      ) : null}

      {snapshot.phase === "idle" ? (
        <p className="muted demo-panel-idle">
          Start a turn to stream the scripted agent through the shell: a thought, two tool calls, a
          plan, and a markdown answer, framed in Rust and rendered here block by block.
        </p>
      ) : (
        <Transcript snapshot={snapshot} className="demo-panel-transcript" />
      )}
    </section>
  );
}
