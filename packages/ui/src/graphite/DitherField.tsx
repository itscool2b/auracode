import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../motion";
import { DEFAULT_ACCENT, DEFAULT_SEED, type DissolveOrder } from "./dither";
import {
  createDitherEngine,
  type DitherClearingArea,
  type DitherEngine,
  type DitherEngineOptions,
  type DitherTarget,
} from "./ditherEngine";
import { DITHER_PALETTES, type DitherPaletteName } from "./tokens";

export type { DitherClearingArea, DitherTarget } from "./ditherEngine";

export interface DitherFieldProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  /**
   * Real content under the field. The field covers it until `progress` reaches 1 and `reveal` is
   * set; without JavaScript, or under reduced motion with `reveal`, the content shows at once.
   */
  readonly children?: ReactNode;
  /** Size of one dither pixel in CSS px, snapped to whole device pixels. Default 4. */
  readonly cell?: number;
  /** Time scale; 0 holds the current frame. Default 1. */
  readonly speed?: number;
  /** How much of the field lights up, 0 to 1. Default 0.5. */
  readonly density?: number;
  /** Chance that a peak cell is volt, 0 to 1. Default 0.02: a few dozen pixels on a hero. */
  readonly accent?: number;
  /** A lens that follows a fine pointer and develops the field under it. Default false. */
  readonly interactive?: boolean;
  /** What the field dissolves into as `progress` rises. */
  readonly target?: DitherTarget;
  /** 0 is pure field, 1 is the target, cell by cell. Default 0, or 1 when only a target is set. */
  readonly progress?: number;
  /** Fade the field out at progress 1 to show `children`. Default false. */
  readonly reveal?: boolean;
  /** How cells resolve into the target. Default "scatter". */
  readonly order?: DissolveOrder;
  /** Grey levels above black, darkest first, or a named palette. Default "standard". */
  readonly palette?: DitherPaletteName | readonly string[];
  /** Paint black cells transparent, to layer the field over a surface. Default false. */
  readonly transparent?: boolean;
  /** Static image for server rendering, no JavaScript and no canvas. Decorative. */
  readonly fallbackSrc?: string;
  /** Render one frame and stop. Reduced motion always does. Default false. */
  readonly still?: boolean;
  /** Same seed, same field. Default DEFAULT_SEED. */
  readonly seed?: number;
  /** Frame-rate cap. Default 30. */
  readonly fps?: number;
  /**
   * An ellipse, as fractions of the field, where the field thins to black a pixel at a time, so a
   * headline set over it stays readable: `{ rx: 0.34, ry: 0.3, y: 0.42 }`. Default none.
   */
  readonly clearing?: DitherClearingArea;
  /** Set when the field itself means something; otherwise it is hidden from assistive tech. */
  readonly label?: string;
}

/**
 * Graphite's signature: a live ordered-dither field on a 2D canvas, rendered at one canvas pixel per
 * cell and scaled up pixelated. Server rendering emits the fallback image and an empty canvas, and
 * touches no browser API; everything else starts in an effect.
 */
export function DitherField({
  className,
  style,
  children,
  cell = 4,
  speed = 1,
  density = 0.5,
  accent = DEFAULT_ACCENT,
  interactive = false,
  target,
  progress,
  reveal = false,
  order = "scatter",
  palette = "standard",
  transparent = false,
  fallbackSrc,
  still = false,
  seed = DEFAULT_SEED,
  fps = 30,
  clearing,
  label,
}: DitherFieldProps) {
  const reduced = usePrefersReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLImageElement>(null);
  const engine = useRef<DitherEngine | null>(null);
  const greys = typeof palette === "string" ? DITHER_PALETTES[palette] : palette;
  const options: DitherEngineOptions = {
    cell: finite(cell, 4, 1, 64),
    speed: finite(speed, 1, 0, 8),
    density: finite(density, 0.5, 0, 1),
    accent: finite(accent, DEFAULT_ACCENT, 0, 1),
    interactive,
    target,
    progress: finite(progress ?? (target ? 1 : 0), 0, 0, 1),
    reveal,
    order,
    palette: greys,
    transparent,
    still,
    seed: Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_SEED,
    fps: finite(fps, 30, 1, 60),
    reduced,
    clearing: clearing
      ? {
          x: finite(clearing.x ?? 0.5, 0.5, -1, 2),
          y: finite(clearing.y ?? 0.5, 0.5, -1, 2),
          rx: finite(clearing.rx, 0, 0, 4),
          ry: finite(clearing.ry, 0, 0, 4),
        }
      : null,
  };
  const latest = useRef(options);
  latest.current = options;
  const key = JSON.stringify(options);

  useEffect(() => {
    const node = root.current;
    const surface = canvas.current;
    if (!node || !surface) return;
    const instance = createDitherEngine(node, surface, fallback.current, latest.current);
    engine.current = instance;
    return () => {
      instance.destroy();
      engine.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the serialised options.
  useEffect(() => {
    engine.current?.update(latest.current);
  }, [key]);

  const reveals = children !== undefined;
  // Revealed content speaks for itself; a field alone is decorative unless it is given a name.
  const semantics = reveals
    ? {}
    : label === undefined
      ? { "aria-hidden": true as const }
      : { role: "img", "aria-label": label };
  return (
    <div
      ref={root}
      className={className ? `g-dither ${className}` : "g-dither"}
      style={style}
      data-reveals={reveals ? "" : undefined}
      {...semantics}
    >
      {reveals ? <div className="g-dither-content">{children}</div> : null}
      {fallbackSrc ? (
        <img
          ref={fallback}
          className="g-dither-fallback"
          src={fallbackSrc}
          alt=""
          decoding="async"
        />
      ) : null}
      <canvas ref={canvas} className="g-dither-canvas" />
    </div>
  );
}

function finite(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
