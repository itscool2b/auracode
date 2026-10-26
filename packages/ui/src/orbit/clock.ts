/** One frame loop for visible, moving marks. An empty clock schedules no browser work. */
export interface FrameHost {
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
}

export function createFrameClock(host: FrameHost) {
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

let browserClock: ReturnType<typeof createFrameClock> | undefined;

/** Called only from a mounted effect, so server rendering never touches browser globals. */
export function orbitClock() {
  browserClock ??= createFrameClock({
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (id) => window.cancelAnimationFrame(id),
  });
  return browserClock;
}
