import { describe, expect, it } from "vitest";
import { type RatioMediaQuery, type RatioView, watchDevicePixelRatio } from "./devicePixelRatio";

const BAND = /^\(min-resolution: ([\d.e+-]+)dppx\) and \(max-resolution: ([\d.e+-]+)dppx\)$/;

/** A MediaQueryList that fires `change` when its result flips, as browsers do. */
class FakeMediaQuery implements RatioMediaQuery {
  readonly listeners = new Set<() => void>();
  matches: boolean;

  constructor(
    readonly query: string,
    private readonly view: FakeView,
  ) {
    this.matches = view.evaluate(query);
  }

  addEventListener(_type: "change", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "change", listener: () => void): void {
    this.listeners.delete(listener);
  }

  update(): void {
    const matches = this.view.evaluate(this.query);
    if (matches === this.matches) return;
    this.matches = matches;
    for (const listener of Array.from(this.listeners)) listener();
  }
}

/** A window whose display scale the test moves. */
class FakeView implements RatioView {
  devicePixelRatio: number;
  readonly queries: FakeMediaQuery[] = [];
  matchMedia: ((query: string) => RatioMediaQuery | null) | undefined = (query) => {
    const media = new FakeMediaQuery(query, this);
    this.queries.push(media);
    return media;
  };
  private readonly resizeListeners = new Set<() => void>();

  constructor(ratio: number) {
    this.devicePixelRatio = ratio;
  }

  addEventListener(_type: "resize", listener: () => void): void {
    this.resizeListeners.add(listener);
  }
  removeEventListener(_type: "resize", listener: () => void): void {
    this.resizeListeners.delete(listener);
  }

  /** Evaluates the only query shape the watcher builds; anything else matches nothing. */
  evaluate(query: string): boolean {
    const match = BAND.exec(query);
    if (!match) return false;
    return this.devicePixelRatio >= Number(match[1]) && this.devicePixelRatio <= Number(match[2]);
  }

  /** Queries with a listener attached: what the watcher has armed. */
  get armed(): FakeMediaQuery[] {
    return this.queries.filter((media) => media.listeners.size > 0);
  }
  get resizeListenerCount(): number {
    return this.resizeListeners.size;
  }

  /**
   * The display scale changes. Media queries are re-evaluated (and fire on a flip); `resize` fires
   * only when asked, because a window moved between displays usually keeps its CSS size.
   */
  setRatio(ratio: number, signals: { media?: boolean; resize?: boolean } = {}): void {
    this.devicePixelRatio = ratio;
    if (signals.media ?? true) for (const media of [...this.queries]) media.update();
    if (signals.resize ?? false) this.resize();
  }

  resize(): void {
    for (const listener of Array.from(this.resizeListeners)) listener();
  }
}

function watch(view: FakeView): { calls: () => number; stop: () => void } {
  let count = 0;
  const stop = watchDevicePixelRatio(view, () => {
    count += 1;
  });
  return { calls: () => count, stop };
}

describe("watchDevicePixelRatio", () => {
  it("arms one media query, matching the current ratio, and one resize listener", () => {
    const view = new FakeView(2);
    watch(view);
    expect(view.armed.map((media) => media.query)).toEqual([
      "(min-resolution: 1.999dppx) and (max-resolution: 2.001dppx)",
    ]);
    expect(view.armed[0]?.matches).toBe(true);
    expect(view.resizeListenerCount).toBe(1);
  });

  it("reports a move to another display without any resize, then re-arms at the new ratio", () => {
    const view = new FakeView(1);
    const { calls } = watch(view);
    view.setRatio(2);
    expect(calls()).toBe(1);
    expect(view.armed).toHaveLength(1);
    expect(view.armed[0]?.query).toContain("min-resolution: 1.999dppx");
    expect(view.armed[0]?.matches).toBe(true);

    view.setRatio(1.5);
    view.setRatio(1);
    expect(calls()).toBe(3);
    expect(view.armed).toHaveLength(1);
    expect(view.armed[0]?.matches).toBe(true);
  });

  it("matches a ratio carrying float noise, so its next change still fires", () => {
    const view = new FakeView(1.100000023841858);
    const { calls } = watch(view);
    expect(view.armed[0]?.matches).toBe(true);
    view.setRatio(1.25);
    expect(calls()).toBe(1);
  });

  it("notices a 1% step, the smallest a real display scale makes", () => {
    const view = new FakeView(1);
    const { calls } = watch(view);
    view.setRatio(1.01);
    expect(calls()).toBe(1);
  });

  it("keeps the band non-negative for a tiny ratio", () => {
    const view = new FakeView(0.0005);
    watch(view);
    expect(view.armed[0]?.query).toContain("(min-resolution: 0dppx)");
    expect(view.armed[0]?.matches).toBe(true);
  });

  it("reports a change once when both the media query and resize see it", () => {
    const view = new FakeView(1);
    const { calls } = watch(view);
    view.setRatio(2, { resize: true });
    expect(calls()).toBe(1);
  });

  it("catches through resize a change the media query missed", () => {
    const view = new FakeView(1);
    const { calls } = watch(view);
    view.setRatio(2, { media: false, resize: true });
    expect(calls()).toBe(1);
    // Re-armed at the new ratio, so the next move is caught by the media query again.
    view.setRatio(1);
    expect(calls()).toBe(2);
  });

  it("ignores resizes that keep the ratio", () => {
    const view = new FakeView(2);
    const { calls } = watch(view);
    view.resize();
    view.resize();
    expect(calls()).toBe(0);
  });

  it("falls back to resize alone where matchMedia is missing or returns null", () => {
    for (const matchMedia of [undefined, () => null]) {
      const view = new FakeView(1);
      view.matchMedia = matchMedia;
      const { calls, stop } = watch(view);
      view.setRatio(2, { resize: true });
      expect(calls()).toBe(1);
      stop();
      expect(view.resizeListenerCount).toBe(0);
    }
  });

  it("skips the media query for a nonsense ratio and arms it once the ratio recovers", () => {
    for (const nonsense of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const view = new FakeView(nonsense);
      const { calls } = watch(view);
      expect(view.queries).toHaveLength(0);
      // A ratio stuck at NaN is not a change on every resize.
      view.resize();
      expect(calls()).toBe(0);
      view.setRatio(2, { resize: true });
      expect(calls()).toBe(1);
      expect(view.armed).toHaveLength(1);
      expect(view.armed[0]?.matches).toBe(true);
    }
  });

  it("stops cleanly and ignores an event already on its way", () => {
    const view = new FakeView(1);
    const { calls, stop } = watch(view);
    const [pending] = Array.from(view.armed[0]?.listeners ?? []);
    stop();
    expect(view.armed).toHaveLength(0);
    expect(view.resizeListenerCount).toBe(0);
    view.setRatio(2, { resize: true });
    pending?.();
    expect(calls()).toBe(0);
    expect(() => stop()).not.toThrow();
  });

  it("leaves nothing armed when the listener unsubscribes during its own notification", () => {
    const view = new FakeView(1);
    let stop = (): void => {};
    stop = watchDevicePixelRatio(view, () => stop());
    view.setRatio(2, { resize: true });
    expect(view.armed).toHaveLength(0);
    expect(view.resizeListenerCount).toBe(0);
  });

  it("keeps watching after a listener throws", () => {
    const view = new FakeView(1);
    let calls = 0;
    watchDevicePixelRatio(view, () => {
      calls += 1;
      throw new Error("listener failed");
    });
    expect(() => view.setRatio(2)).toThrow("listener failed");
    expect(view.armed).toHaveLength(1);
    expect(view.armed[0]?.matches).toBe(true);
    expect(() => view.setRatio(1)).toThrow("listener failed");
    expect(calls).toBe(2);
  });
});
