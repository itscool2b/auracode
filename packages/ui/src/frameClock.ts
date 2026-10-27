/**
 * One requestAnimationFrame loop shared by every moving thing in the design system: agent marks,
 * pixel loaders and dither fields all subscribe here, so a screen full of live indicators costs one
 * browser frame callback, and an empty clock schedules no browser work at all.
 */
export interface FrameHost {
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
}

export interface FrameClock {
  /** Calls `listener` with the frame time on every frame until the returned function runs. */
  subscribe(listener: (time: number) => void): () => void;
}

export function createFrameClock(host: FrameHost): FrameClock {
  const listeners = new Set<(time: number) => void>();
  let frame: number | null = null;
  let flushing = false;
  const schedule = (): void => {
    if (frame === null && listeners.size > 0 && !flushing) frame = host.request(tick);
  };
  const tick = (time: number): void => {
    frame = null;
    flushing = true;
    try {
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) listener(time);
      }
    } finally {
      flushing = false;
      schedule();
    }
  };
  return {
    subscribe(listener: (time: number) => void): () => void {
      listeners.add(listener);
      schedule();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && frame !== null) {
          host.cancel(frame);
          frame = null;
        }
      };
    },
  };
}

let browserClock: FrameClock | undefined;

/** The browser's shared clock. Call it only from a mounted effect: server rendering has no window. */
export function frameClock(): FrameClock {
  browserClock ??= createFrameClock({
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (id) => window.cancelAnimationFrame(id),
  });
  return browserClock;
}
