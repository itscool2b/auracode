import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_LOOP_PAUSE_MS, PlayerClock } from "./player";

/**
 * The player a direction receives. It is a snapshot: a new object whenever `playing` or `speed`
 * change, with stable methods. The playhead itself is not a prop, because it moves every frame and
 * would re-render the whole window 60 times a second; read it where you need it with
 * `usePlayhead(player)`.
 */
export interface Player {
  /** Timeline length in ms. */
  readonly duration: number;
  /** Playback rate; 1 is real time. */
  readonly speed: number;
  /** True while the playhead moves. False when frozen by `?t=`, paused, or in a static state. */
  readonly playing: boolean;
  /** True when the timeline starts over after a pause at the end (the `streaming` state). */
  readonly loop: boolean;
  /** The playhead in timeline ms, read now. Prefer `usePlayhead` in components. */
  getTime(): number;
  /** Calls `listener` whenever the playhead moves (at most once per animation frame). */
  subscribe(listener: () => void): () => void;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Jumps to `time` ms (clamped to the timeline). */
  seek(time: number): void;
  setSpeed(speed: number): void;
}

export interface PlayerConfig {
  readonly duration: number;
  readonly speed: number;
  readonly loop: boolean;
  /** Where the playhead starts, ms. */
  readonly startAt: number;
  /** Whether the playhead moves from the start. False freezes it at `startAt` until `play()`. */
  readonly autoplay: boolean;
  readonly loopPauseMs?: number;
}

/**
 * Drives a PlayerClock with requestAnimationFrame while it plays, and notifies subscribers when the
 * playhead moves. The clock is rebuilt when the timeline or the starting point changes.
 */
export function usePlayer(config: PlayerConfig): Player {
  const { duration, speed, loop, startAt, autoplay } = config;
  const loopPauseMs = config.loopPauseMs ?? DEFAULT_LOOP_PAUSE_MS;

  // Speed is left out on purpose: a speed change goes through setSpeed (the effect below), which
  // keeps the playhead where it is instead of rebuilding the clock from the start.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  const clock = useMemo(
    () => new PlayerClock({ duration, speed, loop, loopPauseMs }, { startAt, playing: autoplay }),
    [duration, loop, loopPauseMs, startAt, autoplay],
  );
  const [snapshot, setSnapshot] = useState(() => ({ playing: clock.playing, speed: clock.speed }));
  const listeners = useRef(new Set<() => void>());

  const sync = useCallback(() => {
    setSnapshot((previous) =>
      previous.playing === clock.playing && previous.speed === clock.speed
        ? previous
        : { playing: clock.playing, speed: clock.speed },
    );
  }, [clock]);

  // A rebuilt clock (new timeline or start point) resets the snapshot and tells subscribers.
  useEffect(() => {
    sync();
    for (const listener of listeners.current) listener();
  }, [sync]);

  useEffect(() => {
    if (clock.speed !== speed) {
      clock.setSpeed(speed);
      sync();
    }
  }, [clock, speed, sync]);

  // The frame loop runs only while playing, and stops itself at the end of a timeline that does not
  // loop (the snapshot then flips to paused).
  useEffect(() => {
    if (!snapshot.playing) return;
    let frame = 0;
    let last = Number.NaN;
    const tick = (): void => {
      const time = clock.time();
      if (time !== last) {
        last = time;
        for (const listener of listeners.current) listener();
      }
      if (!clock.playing) {
        sync();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, snapshot.playing, sync]);

  return useMemo<Player>(() => {
    const notify = (): void => {
      for (const listener of listeners.current) listener();
    };
    return {
      duration: clock.duration,
      speed: snapshot.speed,
      playing: snapshot.playing,
      loop: clock.loop,
      getTime: () => clock.time(),
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      play: () => {
        clock.play();
        sync();
        notify();
      },
      pause: () => {
        clock.pause();
        sync();
        notify();
      },
      toggle: () => {
        if (clock.playing) clock.pause();
        else clock.play();
        sync();
        notify();
      },
      seek: (time) => {
        clock.seek(time);
        sync();
        notify();
      },
      setSpeed: (next) => {
        clock.setSpeed(next);
        sync();
        notify();
      },
    };
  }, [clock, snapshot, sync]);
}

/**
 * The playhead in timeline ms, re-rendering the calling component as it moves. `stepMs` rounds it
 * down to a multiple, so a seconds counter (`usePlayhead(player, 1000)`) renders once a second, not
 * once a frame.
 */
export function usePlayhead(player: Player, stepMs = 0): number {
  const read = useCallback(() => {
    const time = player.getTime();
    return stepMs > 0 ? Math.floor(time / stepMs) * stepMs : time;
  }, [player, stepMs]);
  return useSyncExternalStore(player.subscribe, read, read);
}

/** A player that never moves, for tests and server rendering. */
export function staticPlayer(duration: number, time = duration): Player {
  return {
    duration,
    speed: 1,
    playing: false,
    loop: false,
    getTime: () => time,
    subscribe: () => () => {},
    play: () => {},
    pause: () => {},
    toggle: () => {},
    seek: () => {},
    setSpeed: () => {},
  };
}
