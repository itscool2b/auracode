import type { DemoKind, EventBatch } from "../bindings";
import { errorMessage } from "./errors";
import { applyBatch, initialStreamState, type StreamState } from "./stream";

/**
 * The one live demo stream, as an external store for React (`useSyncExternalStore`).
 *
 * Each `start` begins a new run with its own channel; frames from an earlier run (the trailing
 * "cancelled" of a stream just replaced) are ignored by run number before they reach the reducer,
 * which also ignores other sessions by id. The store keeps totals across runs for the smoke report.
 */

/** How the store talks to the shell. Injected so tests can drive it without Tauri. */
export interface StreamTransport {
  start(
    kind: DemoKind,
    tokensPerSec: number,
    onBatch: (batch: EventBatch) => void,
  ): Promise<string>;
  cancel(sessionId: string): Promise<void>;
}

export type StreamPhase = "idle" | "starting" | "streaming" | "ended" | "failed";

export interface StreamSnapshot {
  readonly phase: StreamPhase;
  readonly kind: DemoKind | null;
  readonly tokensPerSec: number;
  readonly sessionId: string | null;
  readonly stream: StreamState;
  readonly error: string | null;
  /** Clock time (ms) when the run started and when its turn ended. */
  readonly startedAt: number | null;
  readonly endedAt: number | null;
}

export interface StreamTotals {
  readonly runs: number;
  readonly frames: number;
  readonly events: number;
  readonly gaps: number;
  readonly missed: number;
  readonly duplicates: number;
}

const ZERO_TOTALS: StreamTotals = {
  runs: 0,
  frames: 0,
  events: 0,
  gaps: 0,
  missed: 0,
  duplicates: 0,
};

function idleSnapshot(): StreamSnapshot {
  return {
    phase: "idle",
    kind: null,
    tokensPerSec: 0,
    sessionId: null,
    stream: initialStreamState(),
    error: null,
    startedAt: null,
    endedAt: null,
  };
}

export function isRunning(snapshot: StreamSnapshot): boolean {
  return snapshot.phase === "starting" || snapshot.phase === "streaming";
}

export class StreamStore {
  readonly #transport: StreamTransport;
  readonly #now: () => number;
  readonly #listeners = new Set<() => void>();
  #snapshot: StreamSnapshot = idleSnapshot();
  #totals: StreamTotals = ZERO_TOTALS;
  #run = 0;
  /** The run whose stop was requested before the shell returned its session id. */
  #stopRequestedFor = -1;

  constructor(transport: StreamTransport, now: () => number = () => performance.now()) {
    this.#transport = transport;
    this.#now = now;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): StreamSnapshot => this.#snapshot;

  get totals(): StreamTotals {
    return this.#totals;
  }

  /** Stops whatever is running, then starts a new stream. Resolves with its session id. */
  async start(kind: DemoKind, tokensPerSec: number): Promise<string> {
    // Only awaited when something runs, so an idle store reaches the shell in the same tick.
    if (isRunning(this.#snapshot)) await this.stop();
    this.#run += 1;
    const run = this.#run;
    this.#totals = { ...this.#totals, runs: this.#totals.runs + 1 };
    this.#set({
      ...idleSnapshot(),
      phase: "starting",
      kind,
      tokensPerSec,
      startedAt: this.#now(),
    });
    try {
      const sessionId = await this.#transport.start(kind, tokensPerSec, (batch) =>
        this.#receive(run, batch),
      );
      if (run !== this.#run || this.#stopRequestedFor === run) {
        // Replaced or stopped while starting: end it now rather than streaming into nothing.
        await this.#transport.cancel(sessionId).catch(() => undefined);
        if (run !== this.#run) return sessionId;
      }
      const current = this.#snapshot;
      this.#set({
        ...current,
        sessionId,
        phase: current.phase === "starting" ? "streaming" : current.phase,
      });
      return sessionId;
    } catch (error) {
      if (run === this.#run) {
        this.#set({
          ...this.#snapshot,
          phase: "failed",
          error: errorMessage(error),
          endedAt: this.#now(),
        });
      }
      throw error;
    }
  }

  /**
   * Asks the shell to stop the running stream; its final `turn_ended` (cancelled) ends the run.
   * Does nothing when nothing runs.
   */
  async stop(): Promise<void> {
    const snapshot = this.#snapshot;
    if (!isRunning(snapshot)) return;
    if (snapshot.sessionId === null) {
      this.#stopRequestedFor = this.#run;
      return;
    }
    await this.#transport.cancel(snapshot.sessionId);
  }

  /** Forgets the current run (its late frames are ignored) and goes back to idle. */
  reset(): void {
    this.#run += 1;
    this.#set(idleSnapshot());
  }

  /**
   * Forgets the current run now (like `reset`) and stops its stream in the shell. The reset is
   * synchronous, so a stream started right after this call is never mistaken for the old one; a
   * run still waiting for its session id is cancelled by `start` once the id arrives.
   */
  async abandon(): Promise<void> {
    const { sessionId } = this.#snapshot;
    const running = isRunning(this.#snapshot);
    this.reset();
    if (running && sessionId !== null) await this.#transport.cancel(sessionId);
  }

  /** Resolves with the first snapshot that satisfies `predicate`; rejects after `timeoutMs`. */
  waitFor(
    predicate: (snapshot: StreamSnapshot) => boolean,
    timeoutMs: number,
    what = "the stream",
  ): Promise<StreamSnapshot> {
    return new Promise((resolve, reject) => {
      if (predicate(this.#snapshot)) {
        resolve(this.#snapshot);
        return;
      }
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`));
      }, timeoutMs);
      const unsubscribe = this.subscribe(() => {
        if (predicate(this.#snapshot)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(this.#snapshot);
        }
      });
    });
  }

  #receive(run: number, batch: EventBatch): void {
    if (run !== this.#run) return;
    const current = this.#snapshot;
    const before = current.stream;
    const stream = applyBatch(before, batch);
    if (stream === before) return;
    this.#totals = {
      runs: this.#totals.runs,
      frames: this.#totals.frames + (stream.frames - before.frames),
      events: this.#totals.events + (stream.events - before.events),
      gaps: this.#totals.gaps + (stream.gaps - before.gaps),
      missed: this.#totals.missed + (stream.missed - before.missed),
      duplicates: this.#totals.duplicates + (stream.duplicates - before.duplicates),
    };
    const ended = stream.turn?.ended === true;
    this.#set({
      ...current,
      stream,
      sessionId: current.sessionId ?? stream.sessionId,
      phase: ended ? "ended" : "streaming",
      endedAt: ended ? (current.endedAt ?? this.#now()) : current.endedAt,
    });
  }

  #set(snapshot: StreamSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of [...this.#listeners]) listener();
  }
}
