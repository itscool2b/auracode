/**
 * How often the swimmers move (visual language 4.16). Creatures cruise at a few pixels a second, so
 * at rest they step at most about 30 times a second however fast the display refreshes: between
 * steps the page asks for no frame at all, and the compositor has nothing to redraw. While
 * something eases (a creature giving way to the pointer, or settling back) they follow every
 * display frame, so the hand never sees a lag.
 */

/** The wait after an idle step before asking for the next frame: about 30 steps a second at 60Hz. */
export const IDLE_WAIT_MS = 24;

export interface CadenceHost {
  /** The shared frame clock: calls the listener on each display frame until unsubscribed. */
  subscribe(listener: (time: number) => void): () => void;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface Cadence {
  /** Starts stepping (on screen, page visible). */
  start(): void;
  /** Stops at once: no frame and no timer stays scheduled. */
  stop(): void;
  /** Something began to ease: follow every display frame from the next one. */
  wake(): void;
}

/**
 * Calls `step` with the frame time on display frames while `easing()` holds, and otherwise once per
 * idle frame: after each idle step it lets go of the frame clock and waits `idleWaitMs` before
 * asking for the next frame.
 */
export function createCadence(
  host: CadenceHost,
  step: (time: number) => void,
  easing: () => boolean,
  idleWaitMs = IDLE_WAIT_MS,
): Cadence {
  let running = false;
  let unsubscribe: (() => void) | null = null;
  let timer: unknown = null;
  let waiting = false;

  const clear = () => {
    if (waiting) host.clearTimer(timer);
    waiting = false;
    timer = null;
  };

  const frame = (time: number) => {
    step(time);
    if (!running || easing()) return;
    unsubscribe?.();
    unsubscribe = null;
    waiting = true;
    timer = host.setTimer(() => {
      waiting = false;
      timer = null;
      follow();
    }, idleWaitMs);
  };

  const follow = () => {
    if (!running || unsubscribe) return;
    clear();
    unsubscribe = host.subscribe(frame);
  };

  return {
    start() {
      if (running) return;
      running = true;
      follow();
    },
    stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      clear();
    },
    wake() {
      follow();
    },
  };
}
