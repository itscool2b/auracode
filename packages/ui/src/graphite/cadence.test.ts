import { describe, expect, it } from "vitest";
import { type CadenceHost, createCadence, IDLE_WAIT_MS } from "./cadence";

/** A frame clock and timers driven by hand. */
function fakeHost() {
  const listeners = new Set<(time: number) => void>();
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let next = 1;
  const host: CadenceHost = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTimer(callback, ms) {
      const id = next++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    host,
    listeners,
    timers,
    frame(time: number) {
      for (const listener of [...listeners]) listener(time);
    },
    fire() {
      const pending = [...timers];
      timers.clear();
      for (const [, timer] of pending) timer.callback();
    },
  };
}

describe("the swimmers' cadence", () => {
  it("lets go of the display's frames at rest and asks for the next one after a short wait", () => {
    const clock = fakeHost();
    const steps: number[] = [];
    const cadence = createCadence(
      clock.host,
      (time) => steps.push(time),
      () => false,
    );
    cadence.start();
    expect(clock.listeners.size).toBe(1);
    clock.frame(16);
    expect(steps).toEqual([16]);
    // Idle: no frame requested until the timer fires.
    expect(clock.listeners.size).toBe(0);
    expect([...clock.timers.values()].map((timer) => timer.ms)).toEqual([IDLE_WAIT_MS]);
    clock.frame(33);
    expect(steps).toEqual([16]);
    clock.fire();
    expect(clock.listeners.size).toBe(1);
    clock.frame(50);
    expect(steps).toEqual([16, 50]);
  });

  it("follows every frame while something eases, and wakes at once from a wait", () => {
    const clock = fakeHost();
    let easing = false;
    const steps: number[] = [];
    const cadence = createCadence(
      clock.host,
      (time) => steps.push(time),
      () => easing,
    );
    cadence.start();
    clock.frame(0);
    expect(clock.timers.size).toBe(1);
    easing = true;
    cadence.wake();
    expect(clock.timers.size).toBe(0);
    for (const time of [8, 16, 24]) clock.frame(time);
    expect(steps).toEqual([0, 8, 16, 24]);
    expect(clock.listeners.size).toBe(1);
    easing = false;
    clock.frame(32);
    expect(clock.listeners.size).toBe(0);
    expect(clock.timers.size).toBe(1);
  });

  it("stops at once, leaving no frame or timer behind, and restarts cleanly", () => {
    const clock = fakeHost();
    const cadence = createCadence(
      clock.host,
      () => undefined,
      () => false,
    );
    cadence.start();
    clock.frame(0);
    cadence.stop();
    expect(clock.listeners.size).toBe(0);
    expect(clock.timers.size).toBe(0);
    cadence.wake();
    expect(clock.listeners.size).toBe(0);
    cadence.start();
    cadence.start();
    expect(clock.listeners.size).toBe(1);
  });
});
