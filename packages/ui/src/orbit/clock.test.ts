import { describe, expect, it } from "vitest";
import { createFrameClock } from "./clock";

function harness() {
  const pending = new Map<number, (time: number) => void>();
  let id = 0;
  const clock = createFrameClock({
    request: (callback) => {
      pending.set(++id, callback);
      return id;
    },
    cancel: (id) => {
      pending.delete(id);
    },
  });
  return {
    clock,
    pending,
    frame(time: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(time);
    },
  };
}

describe("Orbit frame clock", () => {
  it("shares one frame and schedules nothing when every mark stops", () => {
    const h = harness();
    expect(h.pending.size).toBe(0);
    const times: number[] = [];
    const first = h.clock.subscribe((time) => times.push(time));
    const second = h.clock.subscribe((time) => times.push(time));
    expect(h.pending.size).toBe(1);
    h.frame(16);
    expect(times).toEqual([16, 16]);
    expect(h.pending.size).toBe(1);
    first();
    expect(h.pending.size).toBe(1);
    second();
    expect(h.pending.size).toBe(0);
    second();
    expect(h.pending.size).toBe(0);
  });

  it("does not revive an offscreen mark removed during a frame", () => {
    const h = harness();
    let calls = 0;
    let removeSecond = () => {};
    const removeFirst = h.clock.subscribe(() => removeSecond());
    removeSecond = h.clock.subscribe(() => {
      calls++;
    });
    h.frame(16);
    expect(calls).toBe(0);
    removeFirst();
    expect(h.pending.size).toBe(0);
  });

  it("keeps one scheduled frame when a callback subscribes another mark", () => {
    const h = harness();
    let removeNew = () => {};
    const remove = h.clock.subscribe(() => {
      removeNew();
      removeNew = h.clock.subscribe(() => {});
    });
    h.frame(16);
    expect(h.pending.size).toBe(1);
    remove();
    removeNew();
    expect(h.pending.size).toBe(0);
  });
});
