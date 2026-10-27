// Build glue for the site's generated images, written as small palette PNGs: each dither field's
// no-JavaScript fallback, drawn by the same renderer the browser uses (renderDitherFrame) at one
// image pixel per cell, creatures included; and the logo images (favicons, the home-screen icon
// and the social card), rasterised here from the logo's own path (visual language 4.14).
import { deflateSync } from "node:zlib";
import type { Plugin } from "vite";
import { renderDitherFrame, VOLT } from "../../../packages/ui/src/graphite/dither.ts";
import {
  LOGO_PATH,
  LOGO_SMALL_MAX,
  LOGO_SMALL_PATH,
  LOGO_VIEWBOX,
  logoSvg,
} from "../../../packages/ui/src/graphite/logoPaths.ts";
import { paintSprites } from "../../../packages/ui/src/graphite/sprites.ts";
import { DITHER_PALETTES, GRAPHITE_COLORS } from "../../../packages/ui/src/graphite/tokens.ts";
import { FIELD_FALLBACKS, type FieldFallback, type FieldSettings } from "../app/fields.ts";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, tail]);
}

function rgb(hex: string): number[] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Encodes palette indices (at most 16 colours) as a 4-bit indexed PNG. */
export function indexedPng(
  width: number,
  height: number,
  indices: Uint8Array,
  palette: readonly string[],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(4, 8); // bit depth
  header.writeUInt8(3, 9); // indexed colour
  const stride = Math.ceil(width / 2);
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    for (let x = 0; x < width; x++) {
      const value = (indices[y * width + x] ?? 0) & 15;
      const at = row + 1 + (x >> 1);
      raw[at] = (raw[at] ?? 0) | (x & 1 ? value : value << 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", Uint8Array.from(palette.flatMap(rgb))),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** The first frame of a field at its fallback layout, exactly as the live engine draws it. */
export function fallbackPng(fallback: FieldFallback, field: FieldSettings): Buffer {
  const cols = Math.ceil(fallback.width / field.cell);
  const rows = Math.ceil(fallback.height / field.cell);
  const greys = DITHER_PALETTES[field.palette];
  // The creatures where the live field draws them in its first frame.
  const overlay = new Float32Array(cols * rows);
  paintSprites(overlay, cols, rows, fallback.sprites ?? [], 0, field.cell);
  const levels = renderDitherFrame({
    cols,
    rows,
    cellPx: field.cell,
    seed: field.seed,
    levels: greys.length + 1,
    density: field.density,
    accent: field.accent,
    edges: field.edges ?? 0,
    ceiling: field.ceiling ?? 1,
    clearing: fallback.clearing.map((area) => ({
      x: area.x * cols,
      y: area.y * rows,
      rx: area.rx * cols,
      ry: area.ry * rows,
    })),
    overlay,
  });
  const volt = greys.length + 1;
  const indices = Uint8Array.from(levels, (level) => (level === VOLT ? volt : level));
  return indexedPng(cols, rows, indices, [GRAPHITE_COLORS.bg, ...greys, GRAPHITE_COLORS.volt]);
}

/** A path's absolute M, L, C and Z commands, flattened into closed polygons. */
export function flatten(d: string, steps = 16): number[][] {
  const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const polygons: number[][] = [];
  let current: number[] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "M") {
      if (current.length > 4) polygons.push(current);
      x = next();
      y = next();
      current = [x, y];
    } else if (command === "L") {
      x = next();
      y = next();
      current.push(x, y);
    } else if (command === "C") {
      const [x1, y1, x2, y2, x3, y3] = [next(), next(), next(), next(), next(), next()];
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const u = 1 - t;
        current.push(
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        );
      }
      x = x3;
      y = y3;
    } else if (command === "Z") {
      if (current.length > 4) polygons.push(current);
      current = [];
    }
  }
  if (current.length > 4) polygons.push(current);
  return polygons;
}

/**
 * Even-odd coverage, 0 to 1 per pixel, of polygons placed at (x, y) and scaled by `scale`, from a
 * 4x4 grid of samples per pixel.
 */
export function coverage(
  polygons: readonly number[][],
  width: number,
  height: number,
  place: { readonly x: number; readonly y: number; readonly scale: number },
): Float32Array {
  const samples = 4;
  const out = new Float32Array(width * height);
  const crossings: number[] = [];
  for (let sy = 0; sy < height * samples; sy++) {
    const vy = ((sy + 0.5) / samples - place.y) / place.scale;
    crossings.length = 0;
    for (const polygon of polygons) {
      const n = polygon.length / 2;
      for (let a = 0; a < n; a++) {
        const b = (a + 1) % n;
        const ay = polygon[a * 2 + 1] ?? 0;
        const by = polygon[b * 2 + 1] ?? 0;
        if (ay <= vy === by <= vy) continue;
        const ax = polygon[a * 2] ?? 0;
        const bx = polygon[b * 2] ?? 0;
        crossings.push(place.x + (ax + ((vy - ay) / (by - ay)) * (bx - ax)) * place.scale);
      }
    }
    crossings.sort((p, q) => p - q);
    const row = Math.floor(sy / samples) * width;
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] ?? 0) * samples - 0.5));
      const to = Math.min(width * samples - 1, Math.floor((crossings[k + 1] ?? 0) * samples - 0.5));
      for (let sx = from; sx <= to; sx++) {
        const at = row + Math.floor(sx / samples);
        out[at] = (out[at] ?? 0) + 1 / (samples * samples);
      }
    }
  }
  return out;
}

/** `steps` greys from black to fg-1: the anti-aliased logo's palette. */
function inkRamp(steps: number): string[] {
  const from = rgb(GRAPHITE_COLORS.bg);
  const to = rgb(GRAPHITE_COLORS["fg-1"]);
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    const channel = (c: number) => {
      const value = (from[c] ?? 0) + ((to[c] ?? 0) - (from[c] ?? 0)) * t;
      return Math.round(value).toString(16).padStart(2, "0");
    };
    return `#${channel(0)}${channel(1)}${channel(2)}`;
  });
}

/** Where the logo lands: `fill` of the shorter side, centred. */
function logoPlace(fill: number, width: number, height: number) {
  const [vw, vh] = LOGO_VIEWBOX;
  const scale = (Math.min(width, height) * fill) / Math.max(vw, vh);
  return { x: (width - vw * scale) / 2, y: (height - vh * scale) / 2, scale };
}

/**
 * The logo in fg-1 on a black square, anti-aliased: favicons and the home-screen icon (iOS rounds
 * the corners itself). Rasters up to 32px draw the small variant: without hinting, the full
 * logo's gaps blur shut at a tab icon's size.
 */
export function logoPng(size: number, fill = 0.82): Buffer {
  const path = size <= Math.max(32, LOGO_SMALL_MAX) ? LOGO_SMALL_PATH : LOGO_PATH;
  const ink = coverage(flatten(path), size, size, logoPlace(fill, size, size));
  const indices = Uint8Array.from(ink, (value) => Math.round(Math.min(1, value) * 15));
  return indexedPng(size, size, indices, inkRamp(16));
}

/**
 * The social card, 1200x630: a still dither field thinning to black around the logo in fg-1, so a
 * shared link shows the same signature as the site's hero.
 */
export function socialPng(): Buffer {
  const width = 1200;
  const height = 630;
  const cell = 6;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const greys = DITHER_PALETTES.standard;
  const levels = renderDitherFrame({
    cols,
    rows,
    cellPx: cell,
    levels: greys.length + 1,
    density: 0.5,
    accent: 0.01,
    edges: 0,
    ceiling: 1,
    clearing: [{ x: cols / 2, y: rows / 2, rx: cols * 0.42, ry: rows * 0.95 }],
  });
  const ink = coverage(flatten(LOGO_PATH), width, height, logoPlace(0.5, width, height));
  const field = [GRAPHITE_COLORS.bg, ...greys, GRAPHITE_COLORS.volt];
  const ramp = inkRamp(10).slice(1);
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const value = Math.min(1, ink[at] ?? 0);
      if (value > 0.05) {
        indices[at] = field.length + Math.max(0, Math.round(value * ramp.length) - 1);
        continue;
      }
      const level = levels[Math.floor(y / cell) * cols + Math.floor(x / cell)] ?? 0;
      indices[at] = level === VOLT ? greys.length + 1 : level;
    }
  }
  return indexedPng(width, height, indices, [...field, ...ramp]);
}

/** Emits the generated images into the build and serves them from the dev server. */
export function siteImagesPlugin(): Plugin {
  const images = new Map<string, () => Buffer>([
    ...FIELD_FALLBACKS.map(
      (entry) => [`/${entry.file}`, () => fallbackPng(entry, entry.field)] as const,
    ),
    ["/favicon.png", () => logoPng(32)],
    ["/apple-touch-icon.png", () => logoPng(180, 0.72)],
    ["/og.png", () => socialPng()],
  ]);
  const svgs = new Map<string, () => string>([
    ["/favicon.svg", () => logoSvg({ size: 24, padding: 0.06, radius: 0.2 })],
  ]);
  return {
    name: "auracode-site-images",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const svg = svgs.get(request.url ?? "");
        if (svg) {
          response.setHeader("Content-Type", "image/svg+xml");
          response.end(svg());
          return;
        }
        const render = images.get(request.url ?? "");
        if (!render) return next();
        response.setHeader("Content-Type", "image/png");
        response.end(render());
      });
    },
    generateBundle() {
      for (const [path, render] of images)
        this.emitFile({ type: "asset", fileName: path.slice(1), source: render() });
      for (const [path, render] of svgs)
        this.emitFile({ type: "asset", fileName: path.slice(1), source: render() });
    },
  };
}
