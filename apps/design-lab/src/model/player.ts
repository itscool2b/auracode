/**
 * The timeline player's clock, free of React and the DOM so every rule is unit-tested: real-time
 * playback at any speed, an optional loop with a pause at the end, pause and seek. Time is
 * timeline ms (the recording's own clock); wall time comes from an injectable `now`.
 */

export interface PlaybackOptions {
  /** Length of the timeline in ms (when its last event arrives). */
  readonly duration: number;
  /** Playback rate: 1 is real time, 2 twice as fast. Clamped to [MIN_SPEED, MAX_SPEED]. */
  readonly speed: number;
  /** Start over after the end. */
  readonly loop: boolean;
  /** How long to hold the finished state before looping, in wall-clock ms (not scaled by speed). */
  readonly loopPauseMs: number;
}

export interface Playhead {
  /** Timeline ms, from 0 to the duration. */
  readonly time: number;
  /** Loops completed since the clock was last anchored. */
  readonly iteration: number;
  /** At the end: holding before the next loop, or stopped there for good without a loop. */
  readonly atEnd: boolean;
}

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;
/** The default hold at the end of a loop: long enough to read the finished turn. */
export const DEFAULT_LOOP_PAUSE_MS = 4000;

/** A usable speed: non-numbers and non-positive values become 1, the rest are clamped. */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.min(duration, time);
}

/** Where the playhead is `elapsedMs` of wall-clock time after it stood at `from`. */
export function advance(from: number, elapsedMs: number, options: PlaybackOptions): Playhead {
  const duration = Number.isFinite(options.duration) ? Math.max(0, options.duration) : 0;
  const speed = clampSpeed(options.speed);
  const start = clampTime(from, duration);
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const position = start + elapsed * speed;

  if (!options.loop || duration === 0) {
    const time = Math.min(duration, position);
    return { time, iteration: 0, atEnd: time >= duration };
  }
  // In timeline units, one cycle is the timeline plus the end hold at the current speed.
  const pause = Number.isFinite(options.loopPauseMs) ? Math.max(0, options.loopPauseMs) : 0;
  const cycle = duration + pause * speed;
  const iteration = Math.floor(position / cycle);
  const within = position - iteration * cycle;
  return { time: Math.min(duration, within), iteration, atEnd: within >= duration };
}

/**
 * A pausable, seekable clock over `advance`. It stores an anchor (a timeline time and the wall time
 * it was taken at) and derives everything else, so it never drifts and costs nothing while idle.
 */
export class PlayerClock {
  #options: PlaybackOptions;
  readonly #now: () => number;
  #anchorTime: number;
  #anchorWall: number;
  #playing: boolean;

  constructor(
    options: PlaybackOptions,
    init: {
      readonly startAt?: number;
      readonly playing?: boolean;
      readonly now?: () => number;
    } = {},
  ) {
    this.#options = { ...options, speed: clampSpeed(options.speed) };
    this.#now = init.now ?? (() => performance.now());
    this.#anchorTime = clampTime(init.startAt ?? 0, this.duration);
    this.#anchorWall = this.#now();
    this.#playing = init.playing ?? true;
  }

  get duration(): number {
    return Number.isFinite(this.#options.duration) ? Math.max(0, this.#options.duration) : 0;
  }

  get speed(): number {
    return this.#options.speed;
  }

  get loop(): boolean {
    return this.#options.loop;
  }

  /** True while time advances. A clock without a loop stops itself at the end. */
  get playing(): boolean {
    if (!this.#playing) return false;
    if (!this.#options.loop && this.playhead().atEnd) return false;
    return true;
  }

  playhead(): Playhead {
    if (!this.#playing) {
      const time = this.#anchorTime;
      return { time, iteration: 0, atEnd: time >= this.duration };
    }
    return advance(this.#anchorTime, this.#now() - this.#anchorWall, this.#options);
  }

  time(): number {
    return this.playhead().time;
  }

  /** Starts or resumes. At the end of a timeline that does not loop, starts over. */
  play(): void {
    if (this.#playing && this.playing) return;
    const time = this.time();
    this.#anchorTime = !this.#options.loop && time >= this.duration ? 0 : time;
    this.#anchorWall = this.#now();
    this.#playing = true;
  }

  pause(): void {
    if (!this.#playing) return;
    this.#anchorTime = this.time();
    this.#anchorWall = this.#now();
    this.#playing = false;
  }

  /** Moves to `time` (clamped to the timeline) and keeps playing or paused as before. */
  seek(time: number): void {
    this.#anchorTime = clampTime(time, this.duration);
    this.#anchorWall = this.#now();
  }

  /** Changes the rate without moving the playhead. */
  setSpeed(speed: number): void {
    this.#anchorTime = this.time();
    this.#anchorWall = this.#now();
    this.#options = { ...this.#options, speed: clampSpeed(speed) };
  }
}
