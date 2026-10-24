import { AGENT_BRAND_IDS, GlassPanel, Orb } from "@auracode/ui";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { StressConfig } from "../bindings";
import { errorMessage } from "../lib/errors";
import { FpsMeter, FrameLog, trackFrames } from "../lib/fps";
import { useStickToBottom, useStream } from "../lib/hooks";
import { isRunning, type StreamStore } from "../lib/session";
import { lastMessage } from "../lib/stream";
import {
  formatStressConfig,
  parseStressConfig,
  STRESS_LIMITS,
  stressTurnTokens,
} from "../lib/stress";
import { ArrowLeftIcon } from "./icons";
import { Answer } from "./Markdown";

/**
 * The worst case the UI must stay smooth under: up to 24 live orbs, the aura field, and a fast
 * markdown stream, with the frame rate on screen. `seconds` > 0 streams one turn that long;
 * 0 streams turn after turn until stopped (what the power spike measures).
 */
export function StressView({
  store,
  config,
  onConfigChange,
  autoStart,
  onExit,
}: {
  readonly store: StreamStore;
  readonly config: StressConfig;
  readonly onConfigChange: (config: StressConfig) => void;
  /** Start streaming on mount (AURACODE_STRESS); the smoke run starts streams itself. */
  readonly autoStart: boolean;
  readonly onExit: () => void;
}) {
  const snapshot = useStream(store);
  const running = isRunning(snapshot);
  const [active, setActive] = useState(autoStart);
  const [problem, setProblem] = useState<string | null>(null);
  // The latest settings, for turns started from effects (declared first, so it runs first).
  const configRef = useRef(config);
  useLayoutEffect(() => {
    configRef.current = config;
  }, [config]);

  const startTurn = (): void => {
    setProblem(null);
    const current = configRef.current;
    store
      .start({ type: "stress", total_tokens: stressTurnTokens(current) }, current.rate)
      .catch((error: unknown) => {
        setActive(false);
        setProblem(errorMessage(error));
      });
  };

  // Auto start once, on mount.
  const autoStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mount by design.
  useEffect(() => {
    if (autoStart && !autoStarted.current) {
      autoStarted.current = true;
      startTurn();
    }
  }, []);

  // Open-ended runs (seconds = 0) chain turns; a timed run ends with its one turn.
  const phase = snapshot.phase;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the turn ending only.
  useEffect(() => {
    if (phase !== "ended" || !active) return;
    if (configRef.current.seconds === 0) startTurn();
    else setActive(false);
  }, [phase]);

  const answer = lastMessage(snapshot.stream);
  const streamRef = useStickToBottom<HTMLDivElement>(answer?.text);

  return (
    <div className="flex h-full flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="eyebrow m-0">Stress view</p>
          <h1 className="display m-0 text-[44px]">The worst case, live.</h1>
        </div>
        <FpsReadout />
      </header>

      <GlassPanel elevation={1} squircle className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="button" className="btn btn-quiet -ml-2" onClick={onExit}>
            <ArrowLeftIcon /> Back
          </button>
          <RangeField
            label="Orbs"
            value={config.orbs}
            min={STRESS_LIMITS.orbs.min}
            max={STRESS_LIMITS.orbs.max}
            onChange={(orbs) => onConfigChange({ ...config, orbs })}
          />
          <RangeField
            label="Tokens/s"
            value={config.rate}
            min={10}
            max={2000}
            step={10}
            onChange={(rate) => onConfigChange({ ...config, rate })}
          />
          <label className="field">
            <input
              type="checkbox"
              checked={config.aura}
              onChange={(event) => onConfigChange({ ...config, aura: event.currentTarget.checked })}
            />
            Aura field
          </label>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={running}
              onClick={() => {
                setActive(true);
                startTurn();
              }}
            >
              Start
            </button>
            <button
              type="button"
              className="btn"
              disabled={!running}
              onClick={() => {
                setActive(false);
                store.stop().catch((error: unknown) => setProblem(errorMessage(error)));
              }}
            >
              Stop
            </button>
          </div>
        </div>
        <ConfigLine config={config} onChange={onConfigChange} />
        {problem ? (
          <p role="alert" className="m-0 text-sm text-(--aura-danger)">
            {problem}
          </p>
        ) : null}
      </GlassPanel>

      <section className="orb-grid" aria-label={`${config.orbs} live orbs`}>
        {Array.from({ length: config.orbs }, (_, index) => {
          const brand = AGENT_BRAND_IDS[index % AGENT_BRAND_IDS.length] ?? "generic";
          return (
            <Orb
              // biome-ignore lint/suspicious/noArrayIndexKey: orb slots are positional.
              key={index}
              brand={brand}
              state={running ? (index % 3 === 0 ? "thinking" : "streaming") : "idle"}
              size={64}
              seed={(index + 1) / (config.orbs + 1)}
            />
          );
        })}
      </section>

      <div
        ref={streamRef}
        className="focus-gutter min-h-0 flex-1 overflow-y-auto select-text"
        role="log"
        aria-label="Stress stream"
        aria-busy={running}
      >
        {answer ? (
          <Answer key={`${snapshot.sessionId}:${answer.id}`} text={answer.text} />
        ) : (
          <p className="muted m-0 text-sm">The stream appears here.</p>
        )}
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output htmlFor={id}>{value}</output>
    </div>
  );
}

/** The settings as an `AURACODE_STRESS` value: copy it to reproduce a run, or edit it here. */
function ConfigLine({
  config,
  onChange,
}: {
  readonly config: StressConfig;
  readonly onChange: (config: StressConfig) => void;
}) {
  const id = useId();
  const formatted = formatStressConfig(config);
  const [draft, setDraft] = useState(formatted);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(formatted);
    setError(null);
  }, [formatted]);

  const commit = (): void => {
    const parsed = parseStressConfig(draft);
    if (parsed.ok) {
      setError(null);
      onChange(parsed.config);
    } else {
      setError(parsed.error);
    }
  };

  return (
    <div className="field flex-wrap">
      <label htmlFor={id} className="font-mono text-xs">
        AURACODE_STRESS=
      </label>
      <input
        id={id}
        className="number-input w-[300px]"
        value={draft}
        spellCheck={false}
        aria-invalid={error !== null}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      {error ? <span className="text-xs text-(--aura-danger)">{error}</span> : null}
    </div>
  );
}

/**
 * localStorage key of the stress view's per-second frame counts (a `FrameLog`, as JSON). The render
 * and power spike's harness reads it from WebKit's storage file to get the frame rate over exactly
 * its measurement window (docs/spikes/render-power.md).
 */
const FRAME_LOG_KEY = "auracode.stress.frames";

/** Live frame rate: current and lowest over half-second windows, updated four times a second. */
function FpsReadout() {
  const currentRef = useRef<HTMLElement>(null);
  const minRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const meter = new FpsMeter(500);
    let shownAt = 0;
    // Written straight to the DOM: a React render per frame would cost the frames it measures.
    const stopFrames = trackFrames(meter, () => {
      const now = performance.now();
      if (now - shownAt < 250) return;
      shownAt = now;
      const summary = meter.summary();
      if (currentRef.current) currentRef.current.textContent = summary.current.toFixed(0);
      if (minRef.current) minRef.current.textContent = summary.min.toFixed(0);
    });
    // A timer, not animation frames: it keeps sampling while the window is hidden, which is when
    // the log should show frames stopping.
    const log = new FrameLog();
    const timer = window.setInterval(() => {
      log.record(Date.now(), meter.summary().frames, document.hidden);
      try {
        localStorage.setItem(FRAME_LOG_KEY, JSON.stringify(log.samples));
      } catch {
        // Storage disabled or full: only outside measurement loses its data, the readout stays.
      }
    }, 1000);
    return () => {
      stopFrames();
      window.clearInterval(timer);
    };
  }, []);
  return (
    <p className="fps m-0 text-right">
      <strong ref={currentRef}>0</strong> fps
      <br />
      <span className="muted">
        min <span ref={minRef}>0</span>
      </span>
    </p>
  );
}
