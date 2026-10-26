import "./chrome.css";
import { type CSSProperties, type ReactNode, useLayoutEffect, useState } from "react";
import { Wallpaper } from "./Wallpaper";
import { type WallpaperId, wallpaperLayout } from "./wallpapers";
import {
  TITLEBAR_HEIGHT,
  TRAFFIC_LIGHTS,
  viewportInWindow,
  WINDOW_HEIGHT,
  WINDOW_RADIUS,
  WINDOW_WIDTH,
  windowScale,
} from "./window";

export interface WindowChromeProps {
  /** The direction's window content. It fills a 1440x900 box; position its root absolutely. */
  readonly children: ReactNode;
  readonly wallpaper?: WallpaperId;
  /** Tighter margins, for gallery thumbnails. */
  readonly compact?: boolean;
}

interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

function measure(compact: boolean): Viewport {
  if (typeof window === "undefined")
    return { width: WINDOW_WIDTH, height: WINDOW_HEIGHT, scale: 1 };
  const { innerWidth: width, innerHeight: height } = window;
  return { width, height, scale: windowScale(width, height, compact) };
}

/** The three window buttons, as macOS draws them; the glyphs show when the row is hovered. */
function TrafficLights() {
  const { left, centerY, size, gap } = TRAFFIC_LIGHTS;
  return (
    <div
      aria-hidden="true"
      className="lab-traffic-lights"
      style={{ left, top: centerY - size / 2, gap, height: size }}
    >
      {(["close", "minimize", "zoom"] as const).map((kind) => (
        <span
          key={kind}
          className="lab-traffic-light"
          data-kind={kind}
          style={{ width: size, height: size }}
        >
          <svg viewBox="0 0 12 12" width={size} height={size} focusable="false" aria-hidden="true">
            {kind === "close" ? <path d="M4 4l4 4M8 4l-4 4" /> : null}
            {kind === "minimize" ? <path d="M3.5 6h5" /> : null}
            {kind === "zoom" ? <path d="M6 3.5v5M3.5 6h5" /> : null}
          </svg>
        </span>
      ))}
    </div>
  );
}

/**
 * A 1440x900 macOS-style window floating over a procedural wallpaper. The real app's window is
 * transparent over native Liquid Glass; here that glass is a blurred copy of the wallpaper, drawn
 * inside the window exactly where the wallpaper lies behind it. A copy rather than
 * `backdrop-filter`, because Playwright's headless WebKit does not paint backdrop filters, and the
 * WebKit shots must show the same glass as Chromium's. Directions own everything inside the window
 * except the traffic lights, which float above their content.
 *
 * The window scales as a whole to fit the viewport (never above its real size), so layout inside it
 * is always computed at 1440x900.
 */
export function WindowChrome({ children, wallpaper = "dusk", compact = false }: WindowChromeProps) {
  const [viewport, setViewport] = useState(() => measure(compact));

  useLayoutEffect(() => {
    const update = (): void => {
      const next = measure(compact);
      setViewport((previous) =>
        previous.width === next.width &&
        previous.height === next.height &&
        previous.scale === next.scale
          ? previous
          : next,
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [compact]);

  const { scale } = viewport;
  const frame: CSSProperties = {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    transform: `translate(-50%, -50%) scale(${scale})`,
  };
  const glass = viewportInWindow(viewport.width, viewport.height, scale);
  // Behind the blurred copy, so its blurred edges fade into the wallpaper's own colour, not black.
  const glassBase = wallpaperLayout(wallpaper).base[1];

  return (
    <div className="lab-stage" data-compact={compact ? "" : undefined}>
      <Wallpaper id={wallpaper} />
      <div className="lab-window-frame" style={frame}>
        <div className="lab-window-shadow" style={{ borderRadius: WINDOW_RADIUS }} />
        <div
          className="lab-window"
          data-lab-window=""
          style={
            {
              borderRadius: WINDOW_RADIUS,
              "--lab-titlebar-height": `${TITLEBAR_HEIGHT}px`,
            } as CSSProperties
          }
        >
          <div className="lab-window-glass" aria-hidden="true" style={{ background: glassBase }}>
            <div className="lab-window-glass-copy" style={glass}>
              <Wallpaper id={wallpaper} grain={false} />
            </div>
            <div className="lab-window-glass-tint" />
          </div>
          <div className="lab-window-content">{children}</div>
          <TrafficLights />
          <div className="lab-window-rim" style={{ borderRadius: WINDOW_RADIUS }} />
        </div>
      </div>
    </div>
  );
}
