import { type AgentBrand, brandsEqual } from "../brand";
import { prefersReducedMotion, subscribeReducedMotion } from "../motion";
import { watchDevicePixelRatio } from "./devicePixelRatio";
import {
  clampDpr,
  effectiveFps,
  MAX_DRAWS_PER_FRAME,
  nextFrameTime,
  orbNeedsFrame,
  orbPixelSize,
  orbWantsLoop,
  type SchedulerEnv,
  sharedCanvasSize,
} from "./pacing";
import {
  createCanvasSurface,
  createOglPipeline,
  type OrbOutput,
  type OrbPipeline,
  type OrbPipelineFactory,
  type OrbSurface,
  type OrbUniformValues,
} from "./pipeline";
import {
  glide,
  type OrbState,
  type OrbStateTarget,
  orbStateTarget,
  PALETTE_FLOATS,
  pulseOffset,
  writeBrandPalette,
  writeTargetPalette,
} from "./states";

/**
 * The orb scheduler: every live orb registers here and one animation loop paces, draws, and
 * presents them all through the shared GPU pipeline.
 *
 * Power rules: an orb draws only while on screen (IntersectionObserver), at its state's frame rate
 * (idle about 24 fps, active states 60); the loop stops entirely when no orb is visible, the
 * document is hidden, or the context is lost; under reduced motion each change (state, brand, size,
 * or display scale) renders one static frame and there is no loop. The shared canvas is sized once
 * for the largest orb, never per frame.
 * The hot path (tick, step, draw) allocates nothing of its own; the only per-frame objects are the
 * ImageBitmaps the OffscreenCanvas transfer API itself returns, one per drawn orb.
 */

export interface OrbRegistration {
  /** The orb's visible canvas. */
  readonly canvas: HTMLCanvasElement;
  readonly brand: AgentBrand;
  readonly state: OrbState;
  /** CSS px; orbs are square. */
  readonly size: number;
  /** 0..1, varies the pattern between orbs of the same brand. Picked automatically if omitted. */
  readonly seed?: number;
  /** Called with true once a frame is on the canvas, and false when the context is lost. */
  readonly onLiveChange?: (live: boolean) => void;
}

export interface OrbHandle {
  setState(state: OrbState): void;
  setBrand(brand: AgentBrand): void;
  setSize(size: number): void;
  unregister(): void;
}

/** "webgl": live orbs. "poster": WebGL2 is unavailable, so orbs render as CSS posters. */
export type OrbSupport = "webgl" | "poster";

/** Browser facilities the renderer uses, injectable so the scheduling logic runs under test. */
export interface OrbHost {
  now(): number;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, ms: number): number;
  clearTimer(handle: number): void;
  isHidden(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  prefersReducedMotion(): boolean;
  onReducedMotionChange(listener: () => void): () => void;
  devicePixelRatio(): number;
  /**
   * Calls `listener` after devicePixelRatio changes (the window moved to a display with another
   * scale, or the zoom changed). Needed because no frame may be coming to notice it: under reduced
   * motion the loop stops after each static frame.
   */
  onDevicePixelRatioChange(listener: () => void): () => void;
  observeVisibility(element: Element, listener: (visible: boolean) => void): () => void;
}

export type OrbSurfaceFactory = (canvas: HTMLCanvasElement, output: OrbOutput) => OrbSurface;

export interface OrbRendererOptions {
  readonly host: OrbHost;
  readonly createPipeline: OrbPipelineFactory;
  readonly createSurface: OrbSurfaceFactory;
}

/**
 * How long the GPU context outlives its last orb. React StrictMode remounts and route changes
 * unregister and re-register orbs within a frame; tearing the context down and compiling the shader
 * again each time would stutter and churn through the browser's context limit.
 */
export const RELEASE_GRACE_MS = 2000;

/** Longest step fed into glides and the phase, so a stalled frame resumes smoothly. */
const MAX_STEP_MS = 100;
/** Past this phase, the next state change resets it, hidden by the transition (float precision). */
const PHASE_SOFT_LIMIT = 2048;
/** Past this phase it resets regardless; at 1x speed that is over two hours on screen. */
const PHASE_HARD_LIMIT = 8192;
/** Values closer than this to their target count as arrived. */
const SETTLE_EPSILON = 0.002;
/** Golden-ratio steps spread automatic seeds evenly however many orbs register. */
const GOLDEN_RATIO_FRACTION = 0.6180339887498949;

interface OrbRecord {
  readonly canvas: HTMLCanvasElement;
  readonly surface: OrbSurface;
  readonly uniforms: OrbUniformValues;
  readonly brandPalette: Float32Array;
  readonly targetPalette: Float32Array;
  readonly onLiveChange: ((live: boolean) => void) | undefined;
  brand: AgentBrand;
  state: OrbState;
  target: OrbStateTarget;
  energy: number;
  pulse: number;
  speed: number;
  turbulence: number;
  ringFrequency: number;
  driftVelocityX: number;
  driftVelocityY: number;
  phase: number;
  driftX: number;
  driftY: number;
  cssSize: number;
  pixelSize: number;
  /** IntersectionObserver says the canvas is on screen. */
  onscreen: boolean;
  /** On screen and has a size: what the loop policy reads. */
  visible: boolean;
  dirty: boolean;
  live: boolean;
  settling: boolean;
  removed: boolean;
  lastDrawAt: number;
  lastStepAt: number;
  unobserve: () => void;
}

function sanitizeSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function sanitizeSeed(seed: number | undefined, id: number): number {
  if (seed !== undefined && Number.isFinite(seed)) return Math.abs(seed) % 1;
  return (id * GOLDEN_RATIO_FRACTION) % 1;
}

function noop(): void {}

/**
 * The scheduler itself, with its browser and GPU dependencies injected. Apps use the module-level
 * registerOrb / getOrbSupport, which share one instance wired to the real browser; tests drive
 * this class with fakes. Its public fields are the SchedulerEnv the loop policy reads.
 */
export class OrbRenderer implements SchedulerEnv {
  hidden = false;
  contextLost = false;
  reducedMotion = false;

  private readonly host: OrbHost;
  private readonly createPipeline: OrbPipelineFactory;
  private readonly createSurface: OrbSurfaceFactory;
  private readonly orbs: OrbRecord[] = [];
  private readonly supportListeners = new Set<() => void>();
  private pipeline: OrbPipeline | null = null;
  private probed = false;
  private unavailable = false;
  private frameHandle = 0;
  private releaseTimer = 0;
  private dpr = 1;
  private sharedSize = 0;
  private cursor = 0;
  private nextId = 1;
  private unsubscribers: Array<() => void> = [];

  constructor(options: OrbRendererOptions) {
    this.host = options.host;
    this.createPipeline = options.createPipeline;
    this.createSurface = options.createSurface;
  }

  /** Whether live orbs are possible. The first call probes WebGL2 (and compiles the shader). */
  support(): OrbSupport {
    if (this.unavailable) return "poster";
    if (this.probed) return "webgl";
    if (!this.pipeline && !this.open()) {
      this.markUnavailable();
      return "poster";
    }
    this.probed = true;
    // Probed without an orb yet: let the context go if none registers soon.
    if (this.orbs.length === 0) this.scheduleRelease();
    return "webgl";
  }

  /** Listens for support changing from "webgl" to "poster" (the GPU gave up). */
  subscribe(listener: () => void): () => void {
    this.supportListeners.add(listener);
    return () => {
      this.supportListeners.delete(listener);
    };
  }

  /** Adds an orb to the loop. Null means no WebGL2: render the poster instead. */
  register(registration: OrbRegistration): OrbHandle | null {
    if (this.unavailable) return null;
    if (!this.pipeline && !this.open()) {
      this.markUnavailable();
      return null;
    }
    const pipeline = this.pipeline;
    if (!pipeline) return null;
    this.probed = true;
    this.cancelRelease();

    const id = this.nextId;
    this.nextId += 1;
    const brand = registration.brand;
    const target = orbStateTarget(registration.state);
    const brandPalette = writeBrandPalette(new Float32Array(PALETTE_FLOATS), brand);
    const targetPalette = writeTargetPalette(
      new Float32Array(PALETTE_FLOATS),
      brandPalette,
      registration.state,
    );
    const seed = sanitizeSeed(registration.seed, id);
    const cssSize = sanitizeSize(registration.size);
    const pixelSize = orbPixelSize(cssSize, this.dpr);
    const motion = brand.motion;

    // An orb appears already in its state; only later changes glide.
    const orb: OrbRecord = {
      canvas: registration.canvas,
      surface: this.createSurface(registration.canvas, pipeline.output),
      uniforms: {
        time: 0,
        width: pixelSize,
        height: pixelSize,
        palette: Float32Array.from(targetPalette),
        energy: target.energy,
        speed: target.speed * motion.speed,
        turbulence: target.turbulence * motion.turbulence,
        ringFrequency: motion.ringFrequency,
        driftX: 0,
        driftY: 0,
        seed,
      },
      brandPalette,
      targetPalette,
      onLiveChange: registration.onLiveChange,
      brand,
      state: registration.state,
      target,
      energy: target.energy,
      pulse: target.pulse,
      speed: target.speed * motion.speed,
      turbulence: target.turbulence * motion.turbulence,
      ringFrequency: motion.ringFrequency,
      driftVelocityX: motion.drift[0],
      driftVelocityY: motion.drift[1],
      phase: seed * 64,
      driftX: 0,
      driftY: 0,
      cssSize,
      pixelSize,
      onscreen: true,
      visible: pixelSize > 0,
      dirty: true,
      live: false,
      settling: false,
      removed: false,
      lastDrawAt: Number.NEGATIVE_INFINITY,
      lastStepAt: this.host.now(),
      unobserve: noop,
    };
    if (pixelSize > 0) orb.surface.resize(pixelSize, pixelSize);
    orb.unobserve = this.host.observeVisibility(registration.canvas, (onscreen) =>
      this.setOnscreen(orb, onscreen),
    );
    this.orbs.push(orb);
    this.ensureLoop();

    return {
      setState: (state) => this.setState(orb, state),
      setBrand: (nextBrand) => this.setBrand(orb, nextBrand),
      setSize: (size) => this.setSize(orb, size),
      unregister: () => this.unregister(orb),
    };
  }

  private open(): boolean {
    const pipeline = this.createPipeline({
      onContextLost: this.handleContextLost,
      onContextRestored: this.handleContextRestored,
    });
    if (!pipeline) return false;
    this.pipeline = pipeline;
    this.contextLost = false;
    this.hidden = this.host.isHidden();
    this.reducedMotion = this.host.prefersReducedMotion();
    this.dpr = clampDpr(this.host.devicePixelRatio());
    this.sharedSize = 0;
    this.unsubscribers.push(
      this.host.onVisibilityChange(this.handleVisibility),
      this.host.onReducedMotionChange(this.handleReducedMotion),
      this.host.onDevicePixelRatioChange(this.handleDevicePixelRatio),
    );
    return true;
  }

  private setState(orb: OrbRecord, state: OrbState): void {
    if (orb.removed || state === orb.state) return;
    orb.state = state;
    orb.target = orbStateTarget(state);
    writeTargetPalette(orb.targetPalette, orb.brandPalette, state);
    if (orb.phase > PHASE_SOFT_LIMIT) this.resetPhase(orb);
    this.retarget(orb);
  }

  private setBrand(orb: OrbRecord, brand: AgentBrand): void {
    if (orb.removed || brandsEqual(brand, orb.brand)) return;
    orb.brand = brand;
    writeBrandPalette(orb.brandPalette, brand);
    writeTargetPalette(orb.targetPalette, orb.brandPalette, orb.state);
    this.retarget(orb);
  }

  private setSize(orb: OrbRecord, size: number): void {
    const cssSize = sanitizeSize(size);
    if (orb.removed || cssSize === orb.cssSize) return;
    orb.cssSize = cssSize;
    this.resize(orb);
    this.ensureLoop();
  }

  private unregister(orb: OrbRecord): void {
    if (orb.removed) return;
    orb.removed = true;
    orb.unobserve();
    const index = this.orbs.indexOf(orb);
    if (index !== -1) this.orbs.splice(index, 1);
    if (this.orbs.length === 0) {
      this.cancelFrame();
      this.scheduleRelease();
    }
  }

  /** A new target: glide toward it, or under reduced motion jump and render one static frame. */
  private retarget(orb: OrbRecord): void {
    if (this.reducedMotion) {
      this.snap(orb);
      orb.dirty = true;
    } else {
      orb.settling = true;
    }
    this.ensureLoop();
  }

  /**
   * Re-reads devicePixelRatio and, if it moved, resizes every orb. An orb whose pixel size changed
   * is marked dirty, so it draws one frame at its new resolution even when no loop is running; one
   * whose size held (both ratios clamp to MAX_DPR, or it has no size) has nothing to redraw.
   */
  private syncDevicePixelRatio(): void {
    const dpr = clampDpr(this.host.devicePixelRatio());
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    for (let i = 0; i < this.orbs.length; i += 1) {
      const orb = this.orbs[i];
      if (orb) this.resize(orb);
    }
  }

  private resize(orb: OrbRecord): void {
    const pixelSize = orbPixelSize(orb.cssSize, this.dpr);
    orb.visible = orb.onscreen && pixelSize > 0;
    if (pixelSize === orb.pixelSize) return;
    orb.pixelSize = pixelSize;
    if (pixelSize > 0) orb.surface.resize(pixelSize, pixelSize);
    orb.dirty = true;
  }

  private setOnscreen(orb: OrbRecord, onscreen: boolean): void {
    if (orb.removed || orb.onscreen === onscreen) return;
    orb.onscreen = onscreen;
    orb.visible = onscreen && orb.pixelSize > 0;
    // Nobody watched the glide while it was offscreen, so it arrives already settled.
    if (onscreen) {
      this.snap(orb);
      orb.lastStepAt = this.host.now();
    }
    this.ensureLoop();
  }

  /** Jumps every animated value to its target. */
  private snap(orb: OrbRecord): void {
    const motion = orb.brand.motion;
    orb.energy = orb.target.energy;
    orb.pulse = orb.target.pulse;
    orb.speed = orb.target.speed * motion.speed;
    orb.turbulence = orb.target.turbulence * motion.turbulence;
    orb.ringFrequency = motion.ringFrequency;
    orb.driftVelocityX = motion.drift[0];
    orb.driftVelocityY = motion.drift[1];
    orb.uniforms.palette.set(orb.targetPalette);
    orb.settling = false;
  }

  private resetPhase(orb: OrbRecord): void {
    orb.phase = orb.uniforms.seed * 64;
    orb.driftX = 0;
    orb.driftY = 0;
  }

  /** Advances one orb's glides and phase to `now`. Allocation-free. */
  private step(orb: OrbRecord, now: number): void {
    const dt = Math.min(Math.max(now - orb.lastStepAt, 0), MAX_STEP_MS);
    orb.lastStepAt = now;
    if (this.reducedMotion) return;

    if (orb.settling) {
      const target = orb.target;
      const motion = orb.brand.motion;
      const ms = target.glideMs;
      orb.energy = glide(orb.energy, target.energy, dt, ms);
      orb.pulse = glide(orb.pulse, target.pulse, dt, ms);
      orb.speed = glide(orb.speed, target.speed * motion.speed, dt, ms);
      orb.turbulence = glide(orb.turbulence, target.turbulence * motion.turbulence, dt, ms);
      orb.ringFrequency = glide(orb.ringFrequency, motion.ringFrequency, dt, ms);
      orb.driftVelocityX = glide(orb.driftVelocityX, motion.drift[0], dt, ms);
      orb.driftVelocityY = glide(orb.driftVelocityY, motion.drift[1], dt, ms);
      let far =
        Math.abs(orb.energy - target.energy) > SETTLE_EPSILON ||
        Math.abs(orb.pulse - target.pulse) > SETTLE_EPSILON ||
        Math.abs(orb.speed - target.speed * motion.speed) > SETTLE_EPSILON ||
        Math.abs(orb.turbulence - target.turbulence * motion.turbulence) > SETTLE_EPSILON ||
        Math.abs(orb.ringFrequency - motion.ringFrequency) > SETTLE_EPSILON ||
        Math.abs(orb.driftVelocityX - motion.drift[0]) > SETTLE_EPSILON ||
        Math.abs(orb.driftVelocityY - motion.drift[1]) > SETTLE_EPSILON;
      const palette = orb.uniforms.palette;
      const targetPalette = orb.targetPalette;
      for (let i = 0; i < PALETTE_FLOATS; i += 1) {
        const goal = targetPalette[i] ?? 0;
        const next = glide(palette[i] ?? goal, goal, dt, ms);
        palette[i] = next;
        if (Math.abs(next - goal) > SETTLE_EPSILON) far = true;
      }
      if (!far) this.snap(orb);
    }

    const seconds = (dt / 1000) * orb.speed;
    orb.phase += seconds;
    orb.driftX += seconds * orb.driftVelocityX;
    orb.driftY += seconds * orb.driftVelocityY;
    if (orb.phase > PHASE_HARD_LIMIT) this.resetPhase(orb);
  }

  private draw(pipeline: OrbPipeline, orb: OrbRecord, now: number, fps: number): boolean {
    const u = orb.uniforms;
    u.time = orb.phase;
    u.width = orb.pixelSize;
    u.height = orb.pixelSize;
    // The waiting pulse rides on top of the glided energy; reduced motion holds it still.
    const breath = this.reducedMotion ? 0 : pulseOffset(orb.pulse, now);
    u.energy = Math.min(1, Math.max(0, orb.energy + breath));
    u.speed = orb.speed;
    u.turbulence = orb.turbulence;
    u.ringFrequency = orb.ringFrequency;
    u.driftX = orb.driftX;
    u.driftY = orb.driftY;
    if (!pipeline.draw(u)) return false;
    pipeline.present(orb.surface, orb.pixelSize, orb.pixelSize);
    orb.lastDrawAt = nextFrameTime(orb.lastDrawAt, now, fps);
    orb.dirty = false;
    if (!orb.live) {
      orb.live = true;
      orb.onLiveChange?.(true);
    }
    return true;
  }

  private readonly tick = (now: number): void => {
    this.frameHandle = 0;
    const pipeline = this.pipeline;
    if (!pipeline || this.hidden || this.contextLost) return;

    // The host announces scale changes (handleDevicePixelRatio); this per-frame read is a cheap
    // backup for an engine that misses one while orbs animate.
    this.syncDevicePixelRatio();
    this.fitSharedCanvas(pipeline);

    // Round-robin under the draw budget: the frame starts at the first orb the previous frame had
    // to skip, so a crowd of busy orbs shares the budget instead of starving the same ones.
    const count = this.orbs.length;
    const start = count > 0 ? this.cursor % count : 0;
    let drawn = 0;
    let firstSkipped = -1;
    let again = false;
    for (let k = 0; k < count; k += 1) {
      const index = (start + k) % count;
      const orb = this.orbs[index];
      if (!orb) continue;
      if (orbNeedsFrame(orb, this, now, effectiveFps(orb.target.fps, orb.settling))) {
        if (drawn < MAX_DRAWS_PER_FRAME) {
          this.step(orb, now);
          if (!this.draw(pipeline, orb, now, effectiveFps(orb.target.fps, orb.settling))) {
            // The context died mid-frame; its lost event may still be queued.
            this.handleContextLost();
            return;
          }
          drawn += 1;
        } else if (firstSkipped === -1) {
          firstSkipped = index;
        }
      }
      if (orbWantsLoop(orb, this)) again = true;
    }
    this.cursor = firstSkipped === -1 ? 0 : firstSkipped;
    if (again) this.frameHandle = this.host.requestFrame(this.tick);
  };

  private ensureLoop(): void {
    if (this.frameHandle !== 0 || !this.pipeline) return;
    for (let i = 0; i < this.orbs.length; i += 1) {
      const orb = this.orbs[i];
      if (orb && orbWantsLoop(orb, this)) {
        this.frameHandle = this.host.requestFrame(this.tick);
        return;
      }
    }
  }

  private cancelFrame(): void {
    if (this.frameHandle === 0) return;
    this.host.cancelFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  /**
   * Keeps the shared canvas as big as the largest registered orb (visible or not, so scrolling
   * never reallocates). Grows at once; shrinks only when it is at least twice the size needed, so a
   * size that hovers around a bucket edge cannot reallocate every frame. Allocation-free.
   */
  private fitSharedCanvas(pipeline: OrbPipeline): void {
    const needed = sharedCanvasSize(this.orbs);
    if (needed === 0) return;
    if (needed > this.sharedSize || needed * 2 <= this.sharedSize) {
      pipeline.resize(needed);
      this.sharedSize = needed;
    }
  }

  private scheduleRelease(): void {
    if (this.releaseTimer !== 0 || !this.pipeline) return;
    this.releaseTimer = this.host.setTimer(this.handleReleaseTimer, RELEASE_GRACE_MS);
  }

  private cancelRelease(): void {
    if (this.releaseTimer === 0) return;
    this.host.clearTimer(this.releaseTimer);
    this.releaseTimer = 0;
  }

  private readonly handleReleaseTimer = (): void => {
    this.releaseTimer = 0;
    if (this.orbs.length === 0) this.releasePipeline();
  };

  private releasePipeline(): void {
    this.cancelFrame();
    this.cancelRelease();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.pipeline?.release();
    this.pipeline = null;
    this.contextLost = false;
  }

  /** The GPU gave up for good: every orb falls back to its poster. */
  private markUnavailable(): void {
    if (this.unavailable) return;
    this.unavailable = true;
    for (const orb of this.orbs) {
      if (orb.live) {
        orb.live = false;
        orb.onLiveChange?.(false);
      }
    }
    this.releasePipeline();
    for (const listener of Array.from(this.supportListeners)) listener();
  }

  private readonly handleVisibility = (): void => {
    this.hidden = this.host.isHidden();
    if (this.hidden) {
      this.cancelFrame();
      return;
    }
    // Whatever changed while hidden was never seen, so it arrives settled.
    const now = this.host.now();
    for (const orb of this.orbs) {
      this.snap(orb);
      orb.lastStepAt = now;
    }
    this.ensureLoop();
  };

  private readonly handleReducedMotion = (): void => {
    this.reducedMotion = this.host.prefersReducedMotion();
    for (const orb of this.orbs) {
      this.snap(orb);
      orb.dirty = true;
    }
    this.ensureLoop();
  };

  private readonly handleDevicePixelRatio = (): void => {
    this.syncDevicePixelRatio();
    // Resized orbs are dirty; this starts the frame that redraws them when no loop is running.
    // Hidden, offscreen, or lost-context orbs wait, still dirty, until they can draw again.
    this.ensureLoop();
  };

  private readonly handleContextLost = (): void => {
    if (this.contextLost) return;
    this.contextLost = true;
    this.cancelFrame();
    // Show posters until frames come back; every orb redraws after the restore.
    for (const orb of this.orbs) {
      orb.dirty = true;
      if (orb.live) {
        orb.live = false;
        orb.onLiveChange?.(false);
      }
    }
  };

  private readonly handleContextRestored = (): void => {
    const pipeline = this.pipeline;
    if (!pipeline) return;
    if (!pipeline.rebuild()) {
      this.markUnavailable();
      return;
    }
    this.contextLost = false;
    for (const orb of this.orbs) orb.dirty = true;
    this.ensureLoop();
  };
}

/**
 * The real browser: rAF, timers, document visibility, IntersectionObserver, matchMedia (reduced
 * motion and display scale).
 */
function createBrowserHost(): OrbHost {
  let observer: IntersectionObserver | null = null;
  const listeners = new Map<Element, (visible: boolean) => void>();
  return {
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle),
    isHidden: () => document.hidden,
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    prefersReducedMotion,
    onReducedMotionChange: subscribeReducedMotion,
    devicePixelRatio: () => window.devicePixelRatio,
    onDevicePixelRatioChange: (listener) => watchDevicePixelRatio(window, listener),
    observeVisibility: (element, listener) => {
      // Without IntersectionObserver every orb counts as visible, which is correct, just costlier.
      if (typeof IntersectionObserver !== "function") return noop;
      observer ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
        },
        // Start drawing just before an orb scrolls into view so it never enters blank.
        { rootMargin: "64px" },
      );
      listeners.set(element, listener);
      observer.observe(element);
      return () => {
        observer?.unobserve(element);
        listeners.delete(element);
      };
    },
  };
}

let sharedRenderer: OrbRenderer | null = null;

function browserRenderer(): OrbRenderer | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  sharedRenderer ??= new OrbRenderer({
    host: createBrowserHost(),
    createPipeline: createOglPipeline,
    createSurface: createCanvasSurface,
  });
  return sharedRenderer;
}

/**
 * "webgl" when live orbs can render, "poster" otherwise (no WebGL2, server rendering, or the GPU gave
 * up). The first browser call probes WebGL2 and compiles the shader, so an app can call it early
 * (during a boot screen) to keep that cost off the first orb's render.
 */
export function getOrbSupport(): OrbSupport {
  return browserRenderer()?.support() ?? "poster";
}

/** Subscribes to getOrbSupport() changes; for useSyncExternalStore. */
export function subscribeOrbSupport(listener: () => void): () => void {
  return browserRenderer()?.subscribe(listener) ?? noop;
}

/**
 * Registers a visible canvas with the shared renderer. Returns null when WebGL2 is unavailable;
 * render the poster instead. Call `unregister` when the canvas unmounts.
 */
export function registerOrb(registration: OrbRegistration): OrbHandle | null {
  return browserRenderer()?.register(registration) ?? null;
}
