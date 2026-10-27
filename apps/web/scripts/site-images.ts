// Build glue for the site's generated images, written as small palette PNGs: each dither field's
// no-JavaScript fallback, drawn by the same renderer the browser uses (renderDitherFrame) at one
// image pixel per cell, and the favicon, the pixel "a" on black (visual language 4.14).
import { deflateSync } from "node:zlib";
import type { Plugin } from "vite";
import { renderDitherFrame, VOLT } from "../../../packages/ui/src/graphite/dither.ts";
import { PIXEL_MARK_GRID } from "../../../packages/ui/src/graphite/pixels.ts";
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
  const levels = renderDitherFrame({
    cols,
    rows,
    cellPx: field.cell,
    seed: field.seed,
    levels: greys.length + 1,
    density: field.density,
    accent: field.accent,
    clearing: {
      x: fallback.clearing.x * cols,
      y: fallback.clearing.y * rows,
      rx: fallback.clearing.rx * cols,
      ry: fallback.clearing.ry * rows,
    },
  });
  const volt = greys.length + 1;
  const indices = Uint8Array.from(levels, (level) => (level === VOLT ? volt : level));
  return indexedPng(cols, rows, indices, [GRAPHITE_COLORS.bg, ...greys, GRAPHITE_COLORS.volt]);
}

/** The favicon: the 6x6 glyph in fg-1 on black, padded by an eighth, on whole pixels. */
export function faviconPng(size = 32): Buffer {
  const cell = Math.floor((size * 0.75) / 6);
  const offset = Math.floor((size - cell * 6) / 2);
  const indices = new Uint8Array(size * size);
  PIXEL_MARK_GRID.forEach((line, gy) => {
    for (let gx = 0; gx < line.length; gx++) {
      if (line[gx] !== "#") continue;
      for (let dy = 0; dy < cell; dy++)
        for (let dx = 0; dx < cell; dx++)
          indices[(offset + gy * cell + dy) * size + offset + gx * cell + dx] = 1;
    }
  });
  return indexedPng(size, size, indices, [GRAPHITE_COLORS.bg, GRAPHITE_COLORS["fg-1"]]);
}

/** Emits the generated images into the build and serves them from the dev server. */
export function siteImagesPlugin(): Plugin {
  const images = new Map<string, () => Buffer>([
    ...FIELD_FALLBACKS.map(
      (entry) => [`/${entry.file}`, () => fallbackPng(entry, entry.field)] as const,
    ),
    ["/favicon.png", () => faviconPng(32)],
  ]);
  return {
    name: "auracode-site-images",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const render = images.get(request.url ?? "");
        if (!render) return next();
        response.setHeader("Content-Type", "image/png");
        response.end(render());
      });
    },
    generateBundle() {
      for (const [path, render] of images)
        this.emitFile({ type: "asset", fileName: path.slice(1), source: render() });
    },
  };
}
