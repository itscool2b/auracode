import { describe, expect, it } from "vitest";
import { AGENT_BRANDS, getBrand } from "../brand";
import { MAX_DRAWS_PER_FRAME } from "./pacing";
import type {
  OrbOutput,
  OrbPipeline,
  OrbPipelineEvents,
  OrbSurface,
  OrbUniformValues,
} from "./pipeline";
import { type OrbHost, OrbRenderer, RELEASE_GRACE_MS } from "./renderer";
import { orbStateTarget } from "./states";

const FRAME_MS = 1000 / 60;

/** A scriptable browser: manual animation frames, timers, visibility, and intersection. */
class FakeHost implements OrbHost {
  time = 0;
  dpr = 2;
  hidden = false;
  reduced = false;
  private readonly frames = new Map<number, (now: number) => void>();
  private readonly timers = new Map<number, { callback: () => void; at: number }>();
  private readonly visibilityListeners = new Set<() => void>();
  private readonly motionListeners = new Set<() => void>();
  private readonly ratioListeners = new Set<() => void>();
  private readonly observed = new Map<Element, (visible: boolean) => void>();
  private nextHandle = 1;

  now(): number {
    return this.time;
  }
  requestFrame(callback: (now: number) => void): number {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  }
  cancelFrame(handle: number): void {
    this.frames.delete(handle);
  }
  setTimer(callback: () => void, ms: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, at: this.time + ms });
    return handle;
  }
  clearTimer(handle: number): void {
    this.timers.delete(handle);
  }
  isHidden(): boolean {
    return this.hidden;
  }
  onVisibilityChange(listener: () => void): () => void {
    this.visibilityListeners.add(listener);
    return () => this.visibilityListeners.delete(listener);
  }
  prefersReducedMotion(): boolean {
    return this.reduced;
  }
  onReducedMotionChange(listener: () => void): () => void {
    this.motionListeners.add(listener);
    return () => this.motionListeners.delete(listener);
  }
  devicePixelRatio(): number {
    return this.dpr;
  }
  onDevicePixelRatioChange(listener: () => void): () => void {
    this.ratioListeners.add(listener);
    return () => this.ratioListeners.delete(listener);
  }
  observeVisibility(element: Element, listener: (visible: boolean) => void): () => void {
    this.observed.set(element, listener);
    return () => this.observed.delete(element);
  }

  get pendingFrames(): number {
    return this.frames.size;
  }
  get observedCount(): number {
    return this.observed.size;
  }
  get listenerCount(): number {
    return this.visibilityListeners.size + this.motionListeners.size + this.ratioListeners.size;
  }

  /** Runs the animation frames requested so far, at `now`. */
  frame(now = this.time + FRAME_MS): void {
    this.time = now;
    const callbacks = Array.from(this.frames.values());
    this.frames.clear();
    for (const callback of callbacks) callback(now);
  }

  /** Runs frames at 60 Hz for `ms`, for as long as any are requested. */
  run(ms: number): void {
    const end = this.time + ms;
    while (this.time + FRAME_MS <= end + 1e-6 && this.pendingFrames > 0) this.frame();
    this.time = Math.max(this.time, end);
  }

  advanceTimers(ms: number): void {
    this.time += ms;
    for (const [handle, timer] of Array.from(this.timers)) {
      if (timer.at <= this.time) {
        this.timers.delete(handle);
        timer.callback();
      }
    }
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of Array.from(this.visibilityListeners)) listener();
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    for (const listener of Array.from(this.motionListeners)) listener();
  }

  /** The window moves to a display with this scale (or the zoom changes), announced as browsers do. */
  setDpr(dpr: number): void {
    this.dpr = dpr;
    for (const listener of Array.from(this.ratioListeners)) listener();
  }

  setOnscreen(element: Element, visible: boolean): void {
    this.observed.get(element)?.(visible);
  }
}

interface Draw {
  readonly width: number;
  readonly time: number;
  readonly energy: number;
  readonly palette: readonly number[];
}

class FakePipeline implements OrbPipeline {
  readonly output: OrbOutput = "bitmap";
  readonly draws: Draw[] = [];
  readonly resizes: number[] = [];
  lost = false;
  rebuildResult = true;
  rebuilds = 0;
  released = false;

  constructor(private readonly events: OrbPipelineEvents) {}

  resize(size: number): void {
    this.resizes.push(size);
  }
  draw(values: OrbUniformValues): boolean {
    if (this.lost || this.released) return false;
    this.draws.push({
      width: values.width,
      time: values.time,
      energy: values.energy,
      palette: Array.from(values.palette),
    });
    return true;
  }
  present(surface: OrbSurface, width: number, height: number): void {
    surface.presentBitmap({ close() {} } as unknown as ImageBitmap, width, height);
  }
  rebuild(): boolean {
    this.rebuilds += 1;
    return this.rebuildResult;
  }
  release(): void {
    this.released = true;
  }

  loseContext(): void {
    this.lost = true;
    this.events.onContextLost();
  }
  restoreContext(): void {
    this.lost = false;
    this.events.onContextRestored();
  }
}

class FakeSurface implements OrbSurface {
  presented = 0;
  size = 0;
  resize(width: number): void {
    this.size = width;
  }
  presentBitmap(): void {
    this.presented += 1;
  }
  presentCanvas(): void {
    this.presented += 1;
  }
}

function setup(options: { webgl?: boolean; reduced?: boolean; dpr?: number } = {}) {
  const host = new FakeHost();
  host.reduced = options.reduced ?? false;
  host.dpr = options.dpr ?? 2;
  const pipelines: FakePipeline[] = [];
  const surfaces = new Map<HTMLCanvasElement, FakeSurface>();
  const renderer = new OrbRenderer({
    host,
    createPipeline: (events) => {
      if (options.webgl === false) return null;
      const pipeline = new FakePipeline(events);
      pipelines.push(pipeline);
      return pipeline;
    },
    createSurface: (canvas) => {
      const surface = new FakeSurface();
      surfaces.set(canvas, surface);
      return surface;
    },
  });
  const pipeline = (): FakePipeline => {
    const current = pipelines[pipelines.length - 1];
    if (!current) throw new Error("no pipeline was created");
    return current;
  };
  return { host, renderer, pipelines, pipeline, surfaces };
}

/** Stands in for a canvas element: the renderer only uses it as an identity. */
function fakeCanvas(): HTMLCanvasElement {
  return {} as HTMLCanvasElement;
}

describe("OrbRenderer", () => {
  it("draws a new orb's first frame on the next animation frame and reports it live", () => {
    const { host, renderer, pipeline, surfaces } = setup();
    const live: boolean[] = [];
    const canvas = fakeCanvas();
    const handle = renderer.register({
      canvas,
      brand: getBrand("codex"),
      state: "idle",
      size: 100,
      onLiveChange: (value) => live.push(value),
    });
    expect(handle).not.toBeNull();
    expect(host.pendingFrames).toBe(1);
    host.frame();
    expect(pipeline().draws).toHaveLength(1);
    expect(surfaces.get(canvas)?.presented).toBe(1);
    expect(live).toEqual([true]);
  });

  it("paces idle orbs near 24 fps and active orbs at 60 fps", () => {
    const { host, renderer, pipeline } = setup({ dpr: 1 });
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("pi"), state: "idle", size: 40 });
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("pi"), state: "thinking", size: 80 });
    host.run(1000);
    const count = (width: number) => pipeline().draws.filter((d) => d.width === width).length;
    expect(count(40)).toBeGreaterThanOrEqual(23);
    expect(count(40)).toBeLessThanOrEqual(25);
    expect(count(80)).toBe(60);
  });

  it("skips offscreen orbs and stops the loop when none are visible", () => {
    const { host, renderer, pipeline } = setup();
    const canvas = fakeCanvas();
    renderer.register({ canvas, brand: getBrand("codex"), state: "thinking", size: 50 });
    host.frame();
    host.setOnscreen(canvas, false);
    host.run(500);
    expect(pipeline().draws).toHaveLength(1);
    expect(host.pendingFrames).toBe(0);

    host.setOnscreen(canvas, true);
    expect(host.pendingFrames).toBe(1);
    host.frame();
    expect(pipeline().draws).toHaveLength(2);
  });

  it("stops while the document is hidden and resumes when it is shown", () => {
    const { host, renderer, pipeline } = setup();
    renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "thinking",
      size: 50,
    });
    host.frame();
    host.setHidden(true);
    expect(host.pendingFrames).toBe(0);
    host.time += 5000;
    expect(pipeline().draws).toHaveLength(1);

    host.setHidden(false);
    expect(host.pendingFrames).toBe(1);
    host.run(100);
    expect(pipeline().draws.length).toBeGreaterThan(1);
  });

  it("under reduced motion renders one static frame per change and never loops", () => {
    const { host, renderer, pipeline } = setup({ reduced: true });
    const handle = renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("claude-code"),
      state: "idle",
      size: 50,
    });
    host.run(1000);
    expect(pipeline().draws).toHaveLength(1);
    expect(host.pendingFrames).toBe(0);

    handle?.setState("thinking");
    host.run(1000);
    expect(pipeline().draws).toHaveLength(2);
    expect(host.pendingFrames).toBe(0);
    // No glide: the static frame shows the new state exactly.
    expect(pipeline().draws[1]?.energy).toBe(orbStateTarget("thinking").energy);
    // The phase never advances, so the pattern holds still.
    expect(pipeline().draws[1]?.time).toBe(pipeline().draws[0]?.time);

    handle?.setState("thinking");
    host.run(1000);
    expect(pipeline().draws).toHaveLength(2);
  });

  it("follows the reduced-motion preference when it changes at runtime", () => {
    const { host, renderer, pipeline } = setup();
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "idle", size: 50 });
    host.run(200);
    host.setReduced(true);
    const before = pipeline().draws.length;
    host.run(1000);
    expect(pipeline().draws.length).toBe(before + 1);
    expect(host.pendingFrames).toBe(0);

    host.setReduced(false);
    host.run(1000);
    expect(pipeline().draws.length).toBeGreaterThan(before + 10);
  });

  it("glides between states instead of jumping", () => {
    const { host, renderer, pipeline } = setup();
    const handle = renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "idle",
      size: 50,
    });
    host.frame();
    handle?.setState("thinking");
    const start = pipeline().draws.length;
    host.run(1500);
    const energies = pipeline()
      .draws.slice(start)
      .map((d) => d.energy);
    const target = orbStateTarget("thinking").energy;
    expect(energies[0]).toBeLessThan(target);
    for (let i = 1; i < energies.length; i += 1) {
      expect(energies[i]).toBeGreaterThanOrEqual(energies[i - 1] ?? 0);
    }
    expect(energies.at(-1)).toBe(target);
  });

  it("treats an equal brand rebuilt as a new object as no change, and a real switch as a glide", () => {
    const { host, renderer, pipeline } = setup();
    const handle = renderer.register({
      canvas: fakeCanvas(),
      brand: AGENT_BRANDS.codex,
      state: "thinking",
      size: 50,
    });
    host.run(500);
    const settled = pipeline().draws.at(-1)?.palette ?? [];
    handle?.setBrand({ ...AGENT_BRANDS.codex });
    host.frame();
    expect(pipeline().draws.at(-1)?.palette).toEqual(settled);

    handle?.setBrand(AGENT_BRANDS["claude-code"]);
    host.frame();
    const gliding = pipeline().draws.at(-1)?.palette ?? [];
    expect(gliding).not.toEqual(settled);
    host.run(3000);
    // Settles exactly on the new brand's ramp (red channel of the third stop is coral).
    expect(pipeline().draws.at(-1)?.palette[6]).toBeCloseTo(0xd9 / 255, 5);
  });

  it("glides the palette toward amber when an orb starts waiting", () => {
    const { host, renderer, pipeline } = setup();
    const handle = renderer.register({
      canvas: fakeCanvas(),
      brand: AGENT_BRANDS.antigravity,
      state: "thinking",
      size: 50,
    });
    host.frame();
    const blueBefore = pipeline().draws[0]?.palette[8] ?? 0;
    handle?.setState("waiting");
    host.frame();
    const mid = pipeline().draws.at(-1)?.palette ?? [];
    host.run(3000);
    const settled = pipeline().draws.at(-1)?.palette ?? [];
    expect(mid[8]).toBeLessThan(blueBefore);
    expect(settled[8]).toBeLessThan(mid[8] ?? 0);
    expect(settled[6]).toBeGreaterThan(settled[8] ?? 1);
  });

  it("draws at most MAX_DRAWS_PER_FRAME orbs a frame and shares the budget fairly", () => {
    const { host, renderer, pipeline } = setup({ dpr: 1 });
    const total = 20;
    for (let i = 0; i < total; i += 1) {
      // Distinct sizes make each orb identifiable in the draw log.
      renderer.register({
        canvas: fakeCanvas(),
        brand: getBrand("codex"),
        state: "thinking",
        size: 20 + i,
      });
    }
    let previous = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      host.frame();
      const drawn = pipeline().draws.length - previous;
      expect(drawn).toBeLessThanOrEqual(MAX_DRAWS_PER_FRAME);
      previous = pipeline().draws.length;
    }
    // Every frame used the whole budget, and no orb starved.
    expect(pipeline().draws).toHaveLength(60 * MAX_DRAWS_PER_FRAME);
    const perOrb = new Map<number, number>();
    for (const draw of pipeline().draws) perOrb.set(draw.width, (perOrb.get(draw.width) ?? 0) + 1);
    expect(perOrb.size).toBe(total);
    for (const count of perOrb.values()) {
      expect(count).toBeGreaterThanOrEqual(Math.floor((60 * MAX_DRAWS_PER_FRAME) / total) - 1);
    }
    expect(host.pendingFrames).toBe(1);
  });

  it("lets a waiting orb breathe once settled, but holds it still under reduced motion", () => {
    const moving = setup();
    moving.renderer.register({
      canvas: fakeCanvas(),
      brand: AGENT_BRANDS.hermes,
      state: "waiting",
      size: 50,
    });
    moving.host.run(2000);
    const energies = moving.pipeline().draws.map((d) => d.energy);
    const base = orbStateTarget("waiting").energy;
    expect(Math.max(...energies) - base).toBeGreaterThan(0.15);
    expect(base - Math.min(...energies)).toBeGreaterThan(0.15);

    const still = setup({ reduced: true });
    const handle = still.renderer.register({
      canvas: fakeCanvas(),
      brand: AGENT_BRANDS.hermes,
      state: "idle",
      size: 50,
    });
    still.host.run(700);
    handle?.setState("waiting");
    still.host.run(700);
    expect(still.pipeline().draws.at(-1)?.energy).toBe(base);
  });

  it("stops on context loss and shows the poster; restore rebuilds and redraws", () => {
    const { host, renderer, pipeline } = setup();
    const live: boolean[] = [];
    renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "thinking",
      size: 50,
      onLiveChange: (value) => live.push(value),
    });
    host.frame();
    pipeline().loseContext();
    expect(live).toEqual([true, false]);
    expect(host.pendingFrames).toBe(0);
    host.time += 1000;
    const drawsWhileLost = pipeline().draws.length;

    pipeline().restoreContext();
    expect(pipeline().rebuilds).toBe(1);
    expect(host.pendingFrames).toBe(1);
    host.frame();
    expect(pipeline().draws.length).toBe(drawsWhileLost + 1);
    expect(live).toEqual([true, false, true]);
  });

  it("stops when the context dies mid-frame, before its lost event arrives", () => {
    const { host, renderer, pipeline } = setup();
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "tool", size: 50 });
    host.frame();
    pipeline().lost = true;
    host.frame();
    expect(host.pendingFrames).toBe(0);
    pipeline().restoreContext();
    host.frame();
    expect(pipeline().draws).toHaveLength(2);
  });

  it("falls back to posters for good when the restored context cannot be rebuilt", () => {
    const { host, renderer, pipeline } = setup();
    let notified = 0;
    renderer.subscribe(() => {
      notified += 1;
    });
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "idle", size: 50 });
    host.frame();
    pipeline().rebuildResult = false;
    pipeline().loseContext();
    pipeline().restoreContext();
    expect(renderer.support()).toBe("poster");
    expect(notified).toBe(1);
    expect(pipeline().released).toBe(true);
    expect(
      renderer.register({
        canvas: fakeCanvas(),
        brand: getBrand("codex"),
        state: "idle",
        size: 50,
      }),
    ).toBeNull();
  });

  it("releases GPU resources a grace period after the last orb unregisters", () => {
    const { host, renderer, pipelines, pipeline } = setup();
    const first = renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "idle",
      size: 50,
    });
    // Document visibility, reduced motion, and display scale.
    expect(host.listenerCount).toBe(3);
    host.frame();
    first?.unregister();
    expect(host.pendingFrames).toBe(0);
    expect(host.observedCount).toBe(0);
    host.advanceTimers(RELEASE_GRACE_MS - 1);
    expect(pipeline().released).toBe(false);

    // A remount inside the grace period keeps the context.
    const second = renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "idle",
      size: 50,
    });
    host.advanceTimers(RELEASE_GRACE_MS * 3);
    expect(pipeline().released).toBe(false);
    expect(pipelines).toHaveLength(1);

    second?.unregister();
    host.advanceTimers(RELEASE_GRACE_MS);
    expect(pipeline().released).toBe(true);
    expect(host.listenerCount).toBe(0);

    // The next orb gets a fresh pipeline, and the listeners come back exactly once.
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "idle", size: 50 });
    expect(pipelines).toHaveLength(2);
    expect(host.listenerCount).toBe(3);
  });

  it("returns null and reports posters when WebGL2 is unavailable", () => {
    const { renderer } = setup({ webgl: false });
    expect(renderer.support()).toBe("poster");
    expect(
      renderer.register({
        canvas: fakeCanvas(),
        brand: getBrand("codex"),
        state: "idle",
        size: 50,
      }),
    ).toBeNull();
  });

  it("lets a support probe's context go if no orb registers", () => {
    const { host, renderer, pipelines, pipeline } = setup();
    expect(renderer.support()).toBe("webgl");
    host.advanceTimers(RELEASE_GRACE_MS);
    expect(pipeline().released).toBe(true);
    expect(host.listenerCount).toBe(0);
    expect(renderer.support()).toBe("webgl");
    expect(pipelines).toHaveLength(1);
  });

  it("clamps devicePixelRatio to 2 and notices an unannounced display change on the next frame", () => {
    const { host, renderer, pipeline, surfaces } = setup({ dpr: 3 });
    const canvas = fakeCanvas();
    renderer.register({ canvas, brand: getBrand("codex"), state: "thinking", size: 100 });
    host.frame();
    expect(pipeline().draws[0]?.width).toBe(200);
    // Changed without the host announcing it: the per-frame read catches it while orbs animate.
    host.dpr = 1;
    host.frame();
    expect(pipeline().draws[1]?.width).toBe(100);
    expect(surfaces.get(canvas)?.size).toBe(100);
  });

  it("redraws at the new resolution when the display scale changes under reduced motion", () => {
    const { host, renderer, pipeline, surfaces } = setup({ reduced: true, dpr: 1 });
    const canvas = fakeCanvas();
    renderer.register({ canvas, brand: getBrand("codex"), state: "idle", size: 64 });
    host.run(1000);
    expect(pipeline().draws.map((d) => d.width)).toEqual([64]);
    expect(host.pendingFrames).toBe(0);

    // Moving to a 2x display: no state changed and no loop runs, yet the orb must not stay blurry.
    host.setDpr(2);
    expect(host.pendingFrames).toBe(1);
    host.run(1000);
    expect(pipeline().draws.map((d) => d.width)).toEqual([64, 128]);
    expect(surfaces.get(canvas)?.size).toBe(128);
    expect(pipeline().resizes).toEqual([64, 128]);
    // Still a static frame: the pattern did not move, and the loop stopped again.
    expect(pipeline().draws[1]?.time).toBe(pipeline().draws[0]?.time);
    expect(host.pendingFrames).toBe(0);

    // And back to a 1x display, where the shared canvas shrinks again.
    host.setDpr(1);
    host.run(1000);
    expect(pipeline().draws.map((d) => d.width)).toEqual([64, 128, 64]);
    expect(surfaces.get(canvas)?.size).toBe(64);
    expect(pipeline().resizes).toEqual([64, 128, 64]);
    expect(host.pendingFrames).toBe(0);
  });

  it("redraws every orb once after a display-scale change, within the draw budget", () => {
    const { host, renderer, pipeline } = setup({ reduced: true, dpr: 1 });
    const total = MAX_DRAWS_PER_FRAME + 3;
    for (let i = 0; i < total; i += 1) {
      renderer.register({
        canvas: fakeCanvas(),
        brand: getBrand("codex"),
        state: "idle",
        size: 20 + i,
      });
    }
    host.run(1000);
    const before = pipeline().draws.length;
    expect(before).toBe(total);

    host.setDpr(2);
    host.frame();
    expect(pipeline().draws.length - before).toBe(MAX_DRAWS_PER_FRAME);
    host.run(1000);
    const redrawn = pipeline()
      .draws.slice(before)
      .map((d) => d.width)
      .sort((a, b) => a - b);
    expect(redrawn).toEqual(Array.from({ length: total }, (_, i) => (20 + i) * 2));
    expect(host.pendingFrames).toBe(0);
  });

  it("draws nothing when a display-scale change leaves every orb's pixel size as it was", () => {
    const { host, renderer, pipeline } = setup({ reduced: true, dpr: 2 });
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "idle", size: 50 });
    host.run(1000);
    // 3x clamps to the same 2x, and an announcement without a change is just noise.
    host.setDpr(3);
    host.setDpr(2);
    host.setDpr(2);
    expect(host.pendingFrames).toBe(0);
    expect(pipeline().draws).toHaveLength(1);
  });

  it("does not request a second frame for a scale change announced while the loop runs", () => {
    const { host, renderer, pipeline } = setup({ dpr: 1 });
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "tool", size: 40 });
    host.frame();
    expect(host.pendingFrames).toBe(1);
    host.setDpr(2);
    expect(host.pendingFrames).toBe(1);
    host.frame();
    expect(pipeline().draws.map((d) => d.width)).toEqual([40, 80]);
  });

  it("applies a scale change made while it could not draw once it can draw again", () => {
    const { host, renderer, pipeline } = setup({ reduced: true, dpr: 1 });
    const canvas = fakeCanvas();
    renderer.register({ canvas, brand: getBrand("codex"), state: "idle", size: 40 });
    host.run(100);
    const widths = () => pipeline().draws.map((d) => d.width);

    host.setHidden(true);
    host.setDpr(2);
    expect(host.pendingFrames).toBe(0);
    host.setHidden(false);
    host.run(100);
    expect(widths()).toEqual([40, 80]);

    host.setOnscreen(canvas, false);
    host.setDpr(1);
    expect(host.pendingFrames).toBe(0);
    host.setOnscreen(canvas, true);
    host.run(100);
    expect(widths()).toEqual([40, 80, 40]);

    pipeline().loseContext();
    host.setDpr(2);
    expect(host.pendingFrames).toBe(0);
    pipeline().restoreContext();
    host.run(100);
    expect(widths()).toEqual([40, 80, 40, 80]);
    expect(host.pendingFrames).toBe(0);
  });

  it("sizes the shared canvas once for the largest orb, never per frame or per orb", () => {
    const { host, renderer, pipeline } = setup({ dpr: 1 });
    for (const size of [100, 50, 100, 30]) {
      renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "tool", size });
    }
    host.run(1000);
    expect(pipeline().resizes).toEqual([128]);
    // Each orb still draws at its own size, into the shared canvas's corner.
    expect(new Set(pipeline().draws.map((d) => d.width))).toEqual(new Set([100, 50, 30]));
  });

  it("grows the shared canvas for a bigger orb and shrinks it lazily when that orb leaves", () => {
    const { host, renderer, pipeline } = setup({ dpr: 1 });
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "tool", size: 60 });
    host.frame();
    const hero = renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "tool",
      size: 400,
    });
    host.frame();
    expect(pipeline().resizes).toEqual([64, 448]);
    hero?.unregister();
    host.frame();
    expect(pipeline().resizes).toEqual([64, 448, 64]);
  });

  it("does not shrink for a small size change, so hovering at a bucket edge cannot thrash", () => {
    const { host, renderer, pipeline } = setup({ dpr: 1 });
    const handle = renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "tool",
      size: 130,
    });
    host.frame();
    handle?.setSize(120);
    host.frame();
    handle?.setSize(130);
    host.frame();
    expect(pipeline().resizes).toEqual([192]);
  });

  it("brings an orb back on screen already settled in its new state", () => {
    const { host, renderer, pipeline } = setup();
    const canvas = fakeCanvas();
    const handle = renderer.register({ canvas, brand: getBrand("codex"), state: "idle", size: 50 });
    host.frame();
    host.setOnscreen(canvas, false);
    handle?.setState("thinking");
    host.setOnscreen(canvas, true);
    host.frame();
    expect(pipeline().draws.at(-1)?.energy).toBe(orbStateTarget("thinking").energy);
  });

  it("never draws a zero-size orb until it gets a size", () => {
    const { host, renderer, pipeline } = setup({ dpr: 1 });
    const handle = renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "idle",
      size: 0,
    });
    expect(host.pendingFrames).toBe(0);
    handle?.setSize(80);
    host.frame();
    expect(pipeline().draws[0]?.width).toBe(80);
  });

  it("ignores calls on a handle after unregister", () => {
    const { host, renderer, pipeline } = setup();
    const handle = renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "idle",
      size: 50,
    });
    host.frame();
    handle?.unregister();
    handle?.unregister();
    handle?.setState("thinking");
    handle?.setSize(200);
    handle?.setBrand(AGENT_BRANDS.pi);
    host.run(500);
    expect(pipeline().draws).toHaveLength(1);
    expect(host.pendingFrames).toBe(0);
  });

  it("gives orbs distinct automatic seeds and honours explicit ones", () => {
    const { host, renderer, pipeline } = setup({ reduced: true, dpr: 1 });
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "idle", size: 10 });
    renderer.register({ canvas: fakeCanvas(), brand: getBrand("codex"), state: "idle", size: 20 });
    renderer.register({
      canvas: fakeCanvas(),
      brand: getBrand("codex"),
      state: "idle",
      size: 30,
      seed: 0.25,
    });
    host.frame();
    const [a, b, c] = pipeline().draws.map((d) => d.time);
    expect(a).not.toBe(b);
    // The starting phase derives from the seed.
    expect(c).toBe(0.25 * 64);
  });
});
