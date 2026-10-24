import {
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { DEFAULT_SMOOTHING, squirclePath } from "../squircle";
import { elevationRadius, type GlassElevation } from "../tokens";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** 1 resting surface, 2 raised (composer), 3 floating overlay. Default 1. */
  readonly elevation?: GlassElevation;
  /**
   * Blurs what is behind the panel with `backdrop-filter`. Small overlays only (menus, popovers):
   * large surfaces sit on the native window glass, and a big CSS blur costs GPU time every frame
   * anything behind it changes. The radius is fixed; never animate it.
   */
  readonly blur?: boolean;
  /** Continuous (squircle) corners via a generated clip path instead of circular ones. */
  readonly squircle?: boolean;
  /** Corner radius in CSS px. Defaults to the elevation's radius. */
  readonly radius?: number;
  /** Squircle smoothing, 0..1. */
  readonly smoothing?: number;
  readonly ref?: Ref<HTMLDivElement>;
}

/* Layout effects do nothing on the server; plain effects keep SSR quiet there. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/* Constant blur plus a saturation lift, which is what makes blurred glass read as glass. */
const OVERLAY_BACKDROP = "blur(var(--aura-blur-overlay)) saturate(1.6)";

/* Gradient border: a gradient-filled box whose padding box is masked out, leaving a ring. */
const RING_MASK = "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)";
const RING_MASK_STANDARD =
  "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)";

function normalizeElevation(value: number): GlassElevation {
  return value === 2 || value === 3 ? value : 1;
}

function hairlineRingStyle(level: GlassElevation): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    borderRadius: "inherit",
    padding: "var(--aura-hairline)",
    background: `linear-gradient(to bottom, var(--aura-elev-${level}-hairline-top), var(--aura-elev-${level}-hairline-bottom))`,
    // Prefixed first: engines with the standard property override it with the standard value.
    WebkitMask: RING_MASK,
    WebkitMaskComposite: "xor",
    mask: RING_MASK_STANDARD,
  };
}

function clearClip(element: HTMLElement): void {
  element.style.removeProperty("clip-path");
  element.style.removeProperty("-webkit-clip-path");
}

/**
 * A glass surface: elevation fill, gradient hairline, inner highlight, and shadow from the tokens.
 *
 * By default there is no backdrop-filter: in the app, panels sit on the native window glass. The
 * fill, hairline, and highlight live on a layer behind the children; with `squircle`, only that
 * layer is clipped, and the hairline is an SVG stroke drawn inside the clip, so the clip can never
 * shave it off. The shadow stays on the outer box, where a clip would otherwise cut it.
 */
export function GlassPanel({
  elevation = 1,
  blur = false,
  squircle = false,
  radius,
  smoothing = DEFAULT_SMOOTHING,
  className,
  style,
  children,
  ref,
  ...rest
}: GlassPanelProps) {
  const level = normalizeElevation(elevation);
  const cornerRadius =
    radius !== undefined && Number.isFinite(radius) && radius >= 0
      ? radius
      : elevationRadius[level];
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLSpanElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const strokeRef = useRef<SVGPathElement>(null);
  const gradientId = `aura-hairline-${useId().replace(/[^\w-]/g, "")}`;

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // The squircle depends on the box's exact size, so it is recomputed on every resize and written
  // straight to the DOM: a resize then costs no React render.
  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    const surface = surfaceRef.current;
    if (!squircle || !root || !surface) return;

    let width = -1;
    let height = -1;
    const apply = (nextWidth: number, nextHeight: number): void => {
      if (Math.abs(nextWidth - width) < 0.01 && Math.abs(nextHeight - height) < 0.01) return;
      width = nextWidth;
      height = nextHeight;
      const path = squirclePath(width, height, cornerRadius, smoothing);
      const clip = `path("${path}")`;
      surface.style.setProperty("-webkit-clip-path", clip);
      surface.style.setProperty("clip-path", clip);
      svgRef.current?.setAttribute("viewBox", `0 0 ${width} ${height}`);
      strokeRef.current?.setAttribute("d", path);
    };

    // Measured synchronously so the first paint is already clipped.
    apply(root.offsetWidth, root.offsetHeight);
    if (typeof ResizeObserver !== "function") return () => clearClip(surface);

    // borderBoxSize is fractional and ignores transforms; offset sizes are the fallback.
    // Assumes horizontal writing, where the inline size is the width.
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.borderBoxSize?.[0];
      if (box) apply(box.inlineSize, box.blockSize);
      else apply(root.offsetWidth, root.offsetHeight);
    });
    observer.observe(root, { box: "border-box" });
    return () => {
      observer.disconnect();
      clearClip(surface);
    };
  }, [squircle, cornerRadius, smoothing]);

  const fill = `var(--aura-elev-${level}-fill)`;

  return (
    <div
      {...rest}
      ref={setRootRef}
      className={className}
      data-aura-glass=""
      data-elevation={level}
      style={{
        position: "relative",
        // Keeps the surface layer's negative z-index inside this panel.
        isolation: "isolate",
        borderRadius: cornerRadius,
        boxShadow: `var(--aura-elev-${level}-shadow)`,
        ...(blur
          ? { WebkitBackdropFilter: OVERLAY_BACKDROP, backdropFilter: OVERLAY_BACKDROP }
          : null),
        ...style,
      }}
    >
      <span
        ref={surfaceRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: -1,
          pointerEvents: "none",
          borderRadius: "inherit",
          // Blurred overlays get a dark scrim under the fill so they stay legible over busy content.
          background: blur ? `linear-gradient(${fill}, ${fill}), var(--aura-overlay-scrim)` : fill,
          boxShadow: `var(--aura-elev-${level}-highlight)`,
        }}
      >
        {squircle ? (
          // Stroke 2px wide on the clip path: the outer half is clipped away, leaving a 1px hairline.
          <svg
            ref={svgRef}
            aria-hidden="true"
            focusable="false"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "hidden",
            }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: `var(--aura-elev-${level}-hairline-top)` }} />
                <stop
                  offset="1"
                  style={{ stopColor: `var(--aura-elev-${level}-hairline-bottom)` }}
                />
              </linearGradient>
            </defs>
            <path ref={strokeRef} fill="none" stroke={`url(#${gradientId})`} strokeWidth={2} />
          </svg>
        ) : (
          <span style={hairlineRingStyle(level)} />
        )}
      </span>
      {children}
    </div>
  );
}
