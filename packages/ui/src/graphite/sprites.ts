/**
 * Sprites for DitherField: small luminance grids, such as creatures, drawn into the field's
 * luminance before the Bayer threshold, so they dither in the same cells, greys and pattern as the
 * noise around them. They are part of the field, not an overlay painted on top. Pure maths with no
 * DOM, shared by the live engine and by the build step that writes a field's still frame.
 *
 * Units: positions and sizes are in cells unless a name says CSS px. Time is in seconds.
 */

/** One sprite: frames of the same size that drift through the field on a gentle path. */
export interface DitherSprite {
  /**
   * Two to four animation frames of equal size, each a list of rows drawn facing right: "." or a
   * space is empty, "0" to "9" are luminance in ninths ("0" is solid black, "9" full brightness).
   */
  readonly frames: readonly (readonly string[])[];
  /** Animation frames per second. Default 3. */
  readonly fps?: number;
  /** Centre at time 0, as fractions of the field's width and height. */
  readonly x: number;
  readonly y: number;
  /** Drift in CSS px per second; a negative vx swims left and mirrors the art. Default 12 and 0. */
  readonly vx?: number;
  readonly vy?: number;
  /** A vertical sine bob: amplitude in CSS px and period in seconds. Default 0 and 6. */
  readonly bob?: number;
  readonly bobPeriod?: number;
  /** Seconds added to this sprite's clock, so two sprites of one kind fall out of step. Default 0. */
  readonly phase?: number;
  /** A lazy roll about the long axis, once every `every` seconds, lasting `duration` seconds. */
  readonly roll?: { readonly every: number; readonly duration: number };
  /** Cells per art pixel, a whole number. Default 1. */
  readonly scale?: number;
  /** Width in cells of the black moat around the shape that separates it from the noise. Default 1. */
  readonly halo?: number;
  /** Multiplies the art's luminance. Default 1. */
  readonly intensity?: number;
}

/** A point sprites ease away from, such as the pointer lens, in cells; strength 0 to 1. */
export interface SpriteAvoid {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly strength: number;
}

/** A sprite's frames as luminance, -1 where the art is empty. */
export interface ParsedSprite {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly Float32Array[];
}

/** Where a sprite is at a moment: its centre, frame, facing and roll. */
export interface SpritePose {
  readonly x: number;
  readonly y: number;
  readonly frame: number;
  readonly flip: boolean;
  /** Vertical scale from the roll: 1 upright, through 0 edge on, to -1 upside down. */
  readonly squash: number;
}

const parsed = new WeakMap<readonly (readonly string[])[], ParsedSprite>();

function cellValue(char: string | undefined): number {
  if (char === undefined || char === "." || char === " ") return -1;
  if (char === "#") return 1;
  const digit = char.charCodeAt(0) - 48;
  return digit >= 0 && digit <= 9 ? digit / 9 : -1;
}

/** Parses (once per frames array) a sprite's frames into luminance grids. */
export function parseSprite(frames: readonly (readonly string[])[]): ParsedSprite {
  const cached = parsed.get(frames);
  if (cached) return cached;
  const height = frames[0]?.length ?? 0;
  const width = Math.max(0, ...(frames[0] ?? []).map((row) => row.length));
  for (const frame of frames) {
    if (frame.length !== height || frame.some((row) => row.length !== width))
      throw new Error("Every sprite frame must have the same width and height");
  }
  const result: ParsedSprite = {
    width,
    height,
    frames: frames.map((frame) => {
      const lum = new Float32Array(width * height);
      frame.forEach((row, y) => {
        for (let x = 0; x < width; x++) lum[y * width + x] = cellValue(row[x]);
      });
      return lum;
    }),
  };
  parsed.set(frames, result);
  return result;
}

const mod = (value: number, span: number) => ((value % span) + span) % span;

function eased(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * A sprite's pose at `time`. It starts at (x, y) and drifts at (vx, vy) CSS px a second. Leaving
 * one side, it travels fully off the field before entering again from the other, so it never pops.
 */
export function spritePose(
  sprite: DitherSprite,
  time: number,
  cols: number,
  rows: number,
  cellPx: number,
  avoid?: SpriteAvoid | null,
): SpritePose {
  const art = parseSprite(sprite.frames);
  const scale = Math.max(1, Math.round(sprite.scale ?? 1));
  const w = art.width * scale;
  const h = art.height * scale;
  const px = Math.max(1e-6, cellPx);
  const t = time + (sprite.phase ?? 0);
  const vx = sprite.vx ?? 12;
  const vy = sprite.vy ?? 0;
  const marginX = w / 2 + 6;
  const marginY = h / 2 + 6;
  let x = sprite.x * cols + (vx * time) / px;
  if (vx !== 0) x = mod(x + marginX, cols + 2 * marginX) - marginX;
  let y = sprite.y * rows + (vy * time) / px;
  if (vy !== 0) y = mod(y + marginY, rows + 2 * marginY) - marginY;
  const bobPeriod = sprite.bobPeriod ?? 6;
  if (sprite.bob && bobPeriod > 0) y += (sprite.bob * Math.sin((2 * Math.PI * t) / bobPeriod)) / px;
  if (avoid && avoid.strength > 0) {
    const dx = x - avoid.x;
    const dy = y - avoid.y;
    const reach = avoid.radius + Math.max(w, h) / 2;
    const d = Math.hypot(dx, dy);
    if (d < reach) {
      const k = (1 - d / reach) ** 2 * Math.min(1, avoid.strength);
      const push = reach * 0.35 * k;
      if (d > 1e-6) {
        x += (dx / d) * push;
        y += (dy / d) * push;
      } else y -= push;
    }
  }
  const count = Math.max(1, art.frames.length);
  const frame = Math.floor(mod(t * (sprite.fps ?? 3), count));
  let squash = 1;
  if (sprite.roll && sprite.roll.every > 0 && sprite.roll.duration > 0) {
    const local = mod(t, sprite.roll.every);
    if (local < sprite.roll.duration)
      squash = Math.cos(2 * Math.PI * eased(local / sprite.roll.duration));
  }
  return { x, y, frame, flip: vx < 0, squash };
}

/**
 * Draws every sprite at `time` into `overlay`, one luminance per cell: -1 where nothing is drawn,
 * 0 for the black moat around each shape, the art's luminance elsewhere. Returns whether anything
 * landed on the field.
 */
export function paintSprites(
  overlay: Float32Array,
  cols: number,
  rows: number,
  sprites: readonly DitherSprite[],
  time: number,
  cellPx: number,
  avoid?: SpriteAvoid | null,
): boolean {
  overlay.fill(-1);
  let drawn = false;
  for (const sprite of sprites) {
    const art = parseSprite(sprite.frames);
    if (art.width === 0 || art.height === 0) continue;
    const pose = spritePose(sprite, time, cols, rows, cellPx, avoid);
    const lum = art.frames[pose.frame] ?? art.frames[0];
    if (!lum) continue;
    const scale = Math.max(1, Math.round(sprite.scale ?? 1));
    const w = art.width * scale;
    const h = art.height * scale;
    // The roll scales the art vertically about its middle, upside down past edge on.
    const visible = Math.max(1, Math.round(h * Math.abs(pose.squash)));
    const left = Math.round(pose.x - w / 2);
    const top = Math.round(pose.y - visible / 2);
    if (left >= cols || top >= rows || left + w <= 0 || top + visible <= 0) continue;
    const halo = Math.max(0, Math.round(sprite.halo ?? 1));
    const intensity = sprite.intensity ?? 1;
    const source = (cx: number, cy: number) => {
      let sy = Math.min(h - 1, Math.floor(((cy + 0.5) / visible) * h));
      if (pose.squash < 0) sy = h - 1 - sy;
      const sx = pose.flip ? w - 1 - cx : cx;
      return lum[Math.floor(sy / scale) * art.width + Math.floor(sx / scale)] ?? -1;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let cy = 0; cy < visible; cy++) {
        const ty = top + cy;
        if (ty < -halo || ty >= rows + halo) continue;
        for (let cx = 0; cx < w; cx++) {
          const tx = left + cx;
          if (tx < -halo || tx >= cols + halo) continue;
          const value = source(cx, cy);
          if (value < 0) continue;
          if (pass === 0) {
            for (let dy = -halo; dy <= halo; dy++) {
              const y = ty + dy;
              if (y < 0 || y >= rows) continue;
              for (let dx = -halo; dx <= halo; dx++) {
                const x = tx + dx;
                if (x < 0 || x >= cols) continue;
                const i = y * cols + x;
                if ((overlay[i] ?? 0) < 0) overlay[i] = 0;
              }
            }
          } else if (tx >= 0 && tx < cols && ty >= 0 && ty < rows) {
            overlay[ty * cols + tx] = Math.min(1, Math.max(0, value * intensity));
            drawn = true;
          }
        }
      }
    }
  }
  return drawn;
}
