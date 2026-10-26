/**
 * Frame-rate measurement from animation-frame timestamps.
 *
 * Pure: `tick` takes the timestamp `requestAnimationFrame` passes, so tests drive it with synthetic
 * clocks. The minimum is taken over fixed windows (half a second by default) rather than single
 * frames, so one late frame shows as a dip instead of reading as a 2 fps catastrophe.
 */

export interface FpsSummary {
  /** Frames counted (intervals between ticks). */
  readonly frames: number;
  /** Seconds between the first and last tick. */
  readonly seconds: number;
  /** Frames per second over the whole measurement. */
  readonly avg: number;
  /** Lowest rate over a complete window; the average when no window has completed yet. */
  readonly min: number;
  /** Rate over the latest complete window; the average before the first one completes. */
  readonly current: number;
}

export class FpsMeter {
  readonly #windowMs: number;
  #first: number | null = null;
  #last = 0;
  #frames = 0;
  #windowStart = 0;
  #windowFrames = 0;
  #min = Number.POSITIVE_INFINITY;
  #current: number | null = null;

  constructor(windowMs = 500) {
    this.#windowMs = windowMs > 0 ? windowMs : 500;
  }

  tick(now: number): void {
    if (!Number.isFinite(now)) return;
    if (this.#first === null) {
      this.#first = now;
      this.#last = now;
      this.#windowStart = now;
      return;
    }
    // Repeated or out-of-order timestamps (two callbacks in one frame) are not new frames.
    if (now <= this.#last) return;
    this.#last = now;
    this.#frames += 1;
    this.#windowFrames += 1;
    const elapsed = now - this.#windowStart;
    if (elapsed >= this.#windowMs) {
      const rate = (this.#windowFrames * 1000) / elapsed;
      this.#current = rate;
      this.#min = Math.min(this.#min, rate);
      this.#windowStart = now;
      this.#windowFrames = 0;
    }
  }

  summary(): FpsSummary {
    const seconds = this.#first === null ? 0 : (this.#last - this.#first) / 1000;
    const avg = seconds > 0 ? this.#frames / seconds : 0;
    return {
      frames: this.#frames,
      seconds,
      avg,
      min: Number.isFinite(this.#min) ? this.#min : avg,
      current: this.#current ?? avg,
    };
  }

  reset(): void {
    this.#first = null;
    this.#last = 0;
    this.#frames = 0;
    this.#windowStart = 0;
    this.#windowFrames = 0;
    this.#min = Number.POSITIVE_INFINITY;
    this.#current = null;
  }
}

/** One second of the stress view's frame count. */
export interface FrameSample {
  /** When the sample was taken, ms since the epoch (`Date.now()`), so outside tools can align it. */
  readonly t: number;
  /** Animation frames counted since the previous sample. */
  readonly frames: number;
  /** `document.hidden` when the sample was taken. */
  readonly hidden: boolean;
}

/**
 * The frame rate as a rolling record of per-second samples, at most `capacity` of them (oldest
 * dropped first). The on-screen readout shows only the latest half second; this record lets the
 * render and power spike (docs/spikes/render-power.md) compute the rate over exactly its own
 * measurement window, from outside the app.
 */
export class FrameLog {
  readonly #capacity: number;
  readonly #samples: FrameSample[] = [];
  #lastTotal = 0;

  constructor(capacity = 300) {
    this.#capacity = Number.isFinite(capacity) && capacity >= 1 ? Math.floor(capacity) : 300;
  }

  /**
   * Adds a sample with the frames counted since the previous call. `totalFrames` is the meter's
   * running total (`FpsMeter.summary().frames`); a total lower than the last one means the meter
   * was reset, so all of it counts as new frames. Non-finite input is ignored.
   */
  record(t: number, totalFrames: number, hidden: boolean): void {
    if (!Number.isFinite(t) || !Number.isFinite(totalFrames) || totalFrames < 0) return;
    const frames = totalFrames >= this.#lastTotal ? totalFrames - this.#lastTotal : totalFrames;
    this.#lastTotal = totalFrames;
    this.#samples.push({ t, frames, hidden });
    if (this.#samples.length > this.#capacity) {
      this.#samples.splice(0, this.#samples.length - this.#capacity);
    }
  }

  get samples(): readonly FrameSample[] {
    return this.#samples;
  }
}

/**
 * Feeds `meter` from `requestAnimationFrame` until the returned function is called. `onFrame`
 * runs after each tick (for a live readout); keep it cheap.
 */
export function trackFrames(meter: FpsMeter, onFrame?: (meter: FpsMeter) => void): () => void {
  let handle = 0;
  let running = true;
  const loop = (now: number): void => {
    if (!running) return;
    meter.tick(now);
    onFrame?.(meter);
    handle = requestAnimationFrame(loop);
  };
  handle = requestAnimationFrame(loop);
  return () => {
    running = false;
    cancelAnimationFrame(handle);
  };
}
