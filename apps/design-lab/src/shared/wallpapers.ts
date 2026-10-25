import { seededRandom } from "../fixture/timeline";

/**
 * Procedural desktop wallpapers: soft ribbons of colour in the spirit of a macOS desktop, generated
 * from a seed (no images, nothing copyrighted). Glass only reads as glass over something with
 * colour and shape behind it, so the window floats over one of these.
 *
 * - dusk: deep indigo with violet, cyan and ember ribbons. The default.
 * - dawn: bright pastels, the hard case for contrast (text over pale glass).
 * - graphite: near-neutral greys, the quiet case.
 */
export type WallpaperId = "dusk" | "dawn" | "graphite";

export const WALLPAPER_IDS: readonly WallpaperId[] = ["dusk", "dawn", "graphite"];

export function isWallpaperId(value: string): value is WallpaperId {
  return (WALLPAPER_IDS as readonly string[]).includes(value);
}

interface RibbonStyle {
  readonly from: string;
  readonly to: string;
  readonly opacity: number;
}

interface WallpaperPalette {
  /** Background gradient: top left, middle, bottom right. */
  readonly base: readonly [string, string, string];
  /** Wide ribbons, blurred into fields of colour. */
  readonly fields: readonly RibbonStyle[];
  /** Thin ribbons, kept sharper: the detail glass refracts. */
  readonly strands: readonly RibbonStyle[];
  /** Film grain strength (0..1) and how it blends. */
  readonly grain: number;
  readonly grainBlend: "overlay" | "soft-light";
}

const PALETTES: Readonly<Record<WallpaperId, WallpaperPalette>> = {
  dusk: {
    base: ["#0a0d2a", "#140b2c", "#03202a"],
    fields: [
      { from: "#2d1f8f", to: "#b44fd1", opacity: 0.95 },
      { from: "#1450c4", to: "#26c6da", opacity: 0.8 },
      { from: "#3a1670", to: "#ff6f91", opacity: 0.55 },
      { from: "#0b2a6b", to: "#5b3bd6", opacity: 0.85 },
    ],
    strands: [
      { from: "#ffb07a", to: "#ff5f9e", opacity: 0.7 },
      { from: "#7fe7ff", to: "#8f7bff", opacity: 0.6 },
      { from: "#d7b6ff", to: "#6fd3ff", opacity: 0.45 },
    ],
    grain: 0.09,
    grainBlend: "overlay",
  },
  dawn: {
    base: ["#f6dcff", "#ffe6d3", "#d3ecff"],
    fields: [
      { from: "#ffb3a1", to: "#ff83c0", opacity: 0.85 },
      { from: "#a5d4ff", to: "#c7a6ff", opacity: 0.8 },
      { from: "#fff0b3", to: "#ffbf94", opacity: 0.75 },
      { from: "#bfe9ff", to: "#e9c4ff", opacity: 0.7 },
    ],
    strands: [
      { from: "#ffffff", to: "#ffd6ec", opacity: 0.75 },
      { from: "#ff9bb8", to: "#9ec5ff", opacity: 0.5 },
      { from: "#fff6d6", to: "#c6b5ff", opacity: 0.55 },
    ],
    grain: 0.06,
    grainBlend: "soft-light",
  },
  graphite: {
    base: ["#0e0f12", "#17181d", "#0a0b0d"],
    fields: [
      { from: "#23262e", to: "#474e5c", opacity: 0.9 },
      { from: "#1b2230", to: "#3b5577", opacity: 0.7 },
      { from: "#2a2c33", to: "#5a5f6b", opacity: 0.6 },
      { from: "#15171b", to: "#2f3440", opacity: 0.8 },
    ],
    strands: [
      { from: "#9aa3b2", to: "#5f6b80", opacity: 0.35 },
      { from: "#c8cdd6", to: "#7d8899", opacity: 0.25 },
      { from: "#6f86a6", to: "#a9b4c4", opacity: 0.3 },
    ],
    grain: 0.08,
    grainBlend: "overlay",
  },
};

/** The SVG canvas the ribbons are drawn on; the SVG scales it to cover the viewport. */
export const WALLPAPER_VIEWBOX = { width: 1600, height: 1000 } as const;

export interface Ribbon {
  readonly path: string;
  readonly from: string;
  readonly to: string;
  readonly opacity: number;
  /** Gradient direction, degrees. */
  readonly angle: number;
}

export interface WallpaperLayout {
  readonly base: readonly [string, string, string];
  readonly fields: readonly Ribbon[];
  readonly strands: readonly Ribbon[];
  readonly grain: number;
  readonly grainBlend: "overlay" | "soft-light";
}

/**
 * One ribbon: a band between two wavy edges across the canvas. Sampled every 40 units; the blur it
 * is drawn with hides the facets.
 */
function ribbonPath(
  random: () => number,
  centerY: number,
  thickness: number,
  amplitude: number,
): string {
  const { width } = WALLPAPER_VIEWBOX;
  const wavelength = 900 + random() * 900;
  const phase = random() * Math.PI * 2;
  const wobble = 0.25 + random() * 0.35;
  const tilt = (random() - 0.5) * 380;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let x = -200; x <= width + 200; x += 40) {
    const t = x / width;
    const wave = Math.sin((x / wavelength) * Math.PI * 2 + phase);
    const ripple = Math.sin((x / (wavelength * 0.37)) * Math.PI * 2 + phase * 1.7) * wobble;
    const y = centerY + tilt * (t - 0.5) + amplitude * (wave + ripple);
    const band = thickness * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(x / 260 + phase)));
    top.push(`${x.toFixed(0)} ${(y - band / 2).toFixed(1)}`);
    bottom.push(`${x.toFixed(0)} ${(y + band / 2).toFixed(1)}`);
  }
  return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
}

/** The ribbons of a wallpaper. Deterministic: the same id always draws the same picture. */
export function wallpaperLayout(id: WallpaperId): WallpaperLayout {
  const palette = PALETTES[id] ?? PALETTES.dusk;
  const random = seededRandom(`wallpaper:${id}`);
  const { height } = WALLPAPER_VIEWBOX;
  const fields = palette.fields.map((style, index) => ({
    ...style,
    angle: Math.round(random() * 360),
    path: ribbonPath(
      random,
      height * (0.18 + 0.22 * index + (random() - 0.5) * 0.1),
      260 + random() * 260,
      90 + random() * 90,
    ),
  }));
  const strands = palette.strands.map((style, index) => ({
    ...style,
    angle: Math.round(random() * 360),
    path: ribbonPath(
      random,
      height * (0.3 + 0.2 * index + (random() - 0.5) * 0.12),
      26 + random() * 34,
      110 + random() * 80,
    ),
  }));
  return {
    base: palette.base,
    fields,
    strands,
    grain: palette.grain,
    grainBlend: palette.grainBlend,
  };
}

/**
 * Film grain as an inline SVG: grey fractal noise (its red channel as luminance), fixed seed, so it
 * never shimmers between shots.
 */
export const GRAIN_IMAGE = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`;
