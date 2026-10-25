import { memo, useId, useMemo } from "react";
import {
  GRAIN_IMAGE,
  type Ribbon,
  WALLPAPER_VIEWBOX,
  type WallpaperId,
  wallpaperLayout,
} from "./wallpapers";

function gradientEnds(angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians) / 2;
  const dy = Math.sin(radians) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

function RibbonLayer({
  ribbons,
  prefix,
  blur,
}: {
  readonly ribbons: readonly Ribbon[];
  readonly prefix: string;
  readonly blur: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${WALLPAPER_VIEWBOX.width} ${WALLPAPER_VIEWBOX.height}`}
      preserveAspectRatio="xMidYMid slice"
      className="lab-wallpaper-layer"
      // Constant blur on a static layer: rasterised once, never animated.
      style={{ filter: `blur(${blur}px)` }}
    >
      <defs>
        {ribbons.map((ribbon, index) => (
          <linearGradient
            // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per wallpaper.
            key={index}
            id={`${prefix}-${index}`}
            {...gradientEnds(ribbon.angle)}
          >
            <stop offset="0" stopColor={ribbon.from} />
            <stop offset="1" stopColor={ribbon.to} />
          </linearGradient>
        ))}
      </defs>
      {ribbons.map((ribbon, index) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per wallpaper.
          key={index}
          d={ribbon.path}
          fill={`url(#${prefix}-${index})`}
          opacity={ribbon.opacity}
        />
      ))}
    </svg>
  );
}

/**
 * A full-bleed procedural wallpaper (see wallpaper.ts). Static: it is drawn once and never moves,
 * so screenshots are stable and it costs nothing per frame.
 */
export const Wallpaper = memo(function Wallpaper({
  id,
  grain = true,
}: {
  readonly id: WallpaperId;
  /** Film grain over the colours. Off for the window's blurred copy, where it would be lost. */
  readonly grain?: boolean;
}) {
  const layout = useMemo(() => wallpaperLayout(id), [id]);
  const prefix = `lab-wall-${useId().replace(/[^\w-]/g, "")}`;
  const [top, middle, bottom] = layout.base;
  return (
    <div
      aria-hidden="true"
      className="lab-wallpaper"
      data-wallpaper={id}
      style={{ background: `linear-gradient(135deg, ${top} 0%, ${middle} 52%, ${bottom} 100%)` }}
    >
      <RibbonLayer ribbons={layout.fields} prefix={`${prefix}-f`} blur={64} />
      <RibbonLayer ribbons={layout.strands} prefix={`${prefix}-s`} blur={9} />
      {grain ? (
        <div
          className="lab-wallpaper-grain"
          style={{
            backgroundImage: GRAIN_IMAGE,
            opacity: layout.grain,
            mixBlendMode: layout.grainBlend,
          }}
        />
      ) : null}
    </div>
  );
});
