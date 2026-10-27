import { frameClock } from "../frameClock";
import {
  createFieldBuffers,
  createValueNoise3,
  type DissolveOrder,
  type DitherLens,
  type FieldBuffers,
  gridTarget,
  luminanceOf,
  type Noise3,
  renderLevels,
  sampleField,
  VOLT,
} from "./dither";
import { type DitherSprite, paintSprites } from "./sprites";
import { GRAPHITE_COLORS } from "./tokens";

/** What a DitherField dissolves into. Images must be same-origin (or CORS-enabled) to be read. */
export type DitherTarget =
  | {
      readonly kind: "image";
      readonly src: string;
      /** How the image fills the field, as CSS object-fit. Default "cover". */
      readonly fit?: "cover" | "contain" | "fill";
      /** Live texture over the resolved image, 0 (flat) to 1. Default 0. */
      readonly texture?: number;
    }
  | {
      readonly kind: "text";
      readonly text: string;
      /** CSS font-family list. Default Geist. */
      readonly fontFamily?: string;
      /** Integer weight. Default 600. */
      readonly fontWeight?: number;
      /** CSS px, or "fit" to run the text edge to edge. Default "fit". */
      readonly fontSize?: number | "fit";
      /** Letter spacing in em. Default -0.06. */
      readonly tracking?: number;
      readonly align?: "start" | "center" | "end";
      readonly anchor?: "top" | "center" | "bottom";
      /** Space kept clear around fitted text, in CSS px. Default 0. */
      readonly inset?: number;
      /** Live texture over the letters, 0 (flat) to 1. Default 0.25. */
      readonly texture?: number;
    }
  | {
      readonly kind: "grid";
      /** Rows of "#" (on) and "." (off), such as PIXEL_MARK_GRID. */
      readonly rows: readonly string[];
      /** Field cells per grid pixel. Default: fits about 40% of the shorter side. */
      readonly scale?: number;
      readonly texture?: number;
    };

export interface DitherEngineOptions {
  readonly cell: number;
  readonly speed: number;
  readonly density: number;
  readonly accent: number;
  readonly interactive: boolean;
  readonly target: DitherTarget | undefined;
  readonly progress: number;
  readonly reveal: boolean;
  readonly order: DissolveOrder;
  readonly palette: readonly string[];
  readonly transparent: boolean;
  readonly still: boolean;
  readonly seed: number;
  readonly fps: number;
  readonly reduced: boolean;
  /** Where the field thins to black; several multiply. */
  readonly clearing: readonly DitherClearingArea[];
  /** Shapes drawn into the field's luminance; none by default. */
  readonly sprites?: readonly DitherSprite[];
  /** How far the field gathers toward the left and right edges, 0 to 1. */
  readonly edges?: number;
  /** The brightest the field itself may get, 0 to 1; sprites keep the full range. */
  readonly ceiling?: number;
}

/**
 * An elliptical clearing as fractions of the field: centre (x, y, default 0.5) and radii (rx of the
 * width, ry of the height). Inside it the field thins to black a pixel at a time.
 */
export interface DitherClearingArea {
  readonly x?: number;
  readonly y?: number;
  readonly rx: number;
  readonly ry: number;
}

export interface DitherEngine {
  update(options: DitherEngineOptions): void;
  destroy(): void;
}

const DEFAULT_FONT = '"Geist Variable", ui-sans-serif, system-ui, sans-serif';
/** Upper bound on cells per frame; past it the cell grows instead. About 4K at 4px cells. */
const MAX_CELLS = 240_000;
const LENS_PX = 120;
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x0a0b0c0d]).buffer)[0] === 0x0d;

function packColor(hex: string, alpha = 255): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = match?.[1] ? Number.parseInt(match[1], 16) : 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return LITTLE_ENDIAN
    ? ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | alpha) >>> 0;
}

function targetKey(target: DitherTarget | undefined): string {
  return target ? JSON.stringify(target) : "";
}

const noiseCache = new Map<number, Noise3>();
function noiseFor(seed: number): Noise3 {
  let noise = noiseCache.get(seed);
  if (!noise) {
    noise = createValueNoise3(seed);
    noiseCache.set(seed, noise);
  }
  return noise;
}

/**
 * Drives one field: sizes its canvas to whole device pixels per cell, renders frames from the
 * shared clock at most `fps` times a second while the field is on screen, the page is visible and
 * motion is allowed, and otherwise renders single frames on demand.
 */
export function createDitherEngine(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  fallback: HTMLImageElement | null,
  initial: DitherEngineOptions,
): DitherEngine {
  let options = initial;
  const context = canvas.getContext("2d", { alpha: true });
  let buffers: FieldBuffers | null = null;
  let image: ImageData | null = null;
  let pixels: Uint32Array | null = null;
  let cssCell = options.cell;
  let width = 0;
  let height = 0;
  let target: Float32Array | null = null;
  let targetSparks = false;
  let texture = 0;
  let rasterizedKey = "";
  let rasterToken = 0;
  let decoded: { src: string; image: HTMLImageElement } | null = null;
  let visible = typeof IntersectionObserver === "undefined";
  let unsubscribe: (() => void) | null = null;
  let lastFrame = Number.NEGATIVE_INFINITY;
  let lastTick = 0;
  let elapsed = 0;
  let destroyed = false;
  let overlay: Float32Array | null = null;
  const lut = new Uint32Array(256);
  const lens = { x: 0, y: 0, strength: 0, goal: 0, px: 0, py: 0, seen: false };

  const fineHover =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const buildLut = () => {
    const greys = options.palette.length > 0 ? options.palette : ["#2e2e2e", "#4d4d4d", "#858585"];
    lut[0] = options.transparent ? packColor("#000000", 0) : packColor(GRAPHITE_COLORS.bg);
    greys.forEach((hex, i) => {
      lut[i + 1] = packColor(hex);
    });
    lut[VOLT] = packColor(GRAPHITE_COLORS.volt);
  };

  const levels = () => Math.min(5, Math.max(2, options.palette.length + 1));

  const revealed = () => options.reveal && (options.reduced || options.progress >= 1);

  const resize = (): boolean => {
    const rect = root.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    let deviceCell = Math.max(1, Math.round(options.cell * dpr));
    let cols = Math.ceil((rect.width * dpr) / deviceCell);
    let rows = Math.ceil((rect.height * dpr) / deviceCell);
    while (cols * rows > MAX_CELLS) {
      deviceCell += 1;
      cols = Math.ceil((rect.width * dpr) / deviceCell);
      rows = Math.ceil((rect.height * dpr) / deviceCell);
    }
    cssCell = deviceCell / dpr;
    width = rect.width;
    height = rect.height;
    if (
      buffers &&
      buffers.cols === cols &&
      buffers.rows === rows &&
      buffers.seed === options.seed &&
      buffers.order === options.order
    ) {
      return true;
    }
    buffers = createFieldBuffers(cols, rows, options.seed, options.order);
    canvas.width = cols;
    canvas.height = rows;
    // Whole device pixels per cell, so the pixelated upscale never makes uneven cells.
    canvas.style.width = `${(cols * deviceCell) / dpr}px`;
    canvas.style.height = `${(rows * deviceCell) / dpr}px`;
    image = context ? context.createImageData(cols, rows) : null;
    pixels = image ? new Uint32Array(image.data.buffer) : null;
    // A target rasterised for the old grid would land on the wrong cells.
    target = null;
    rasterizedKey = "";
    return true;
  };

  const setTarget = (key: string, lum: Float32Array | null, sparks: boolean, tex: number) => {
    if (key !== targetKey(options.target)) return;
    target = lum;
    targetSparks = sparks;
    texture = tex;
    draw();
  };

  const rasterize = () => {
    const current = options.target;
    const key = `${targetKey(current)}|${buffers?.cols}x${buffers?.rows}`;
    if (key === rasterizedKey || !buffers) return;
    rasterizedKey = key;
    const token = ++rasterToken;
    const { cols, rows } = buffers;
    const plainKey = targetKey(current);
    if (!current) {
      setTarget(plainKey, null, false, 0);
      return;
    }
    if (current.kind === "grid") {
      const size = Math.max(...current.rows.map((row) => row.length), current.rows.length, 1);
      const scale = current.scale ?? Math.max(1, Math.floor((Math.min(cols, rows) * 0.4) / size));
      setTarget(
        plainKey,
        gridTarget(current.rows, cols, rows, scale),
        true,
        current.texture ?? 0.2,
      );
      return;
    }
    const offscreen = document.createElement("canvas");
    offscreen.width = cols;
    offscreen.height = rows;
    const ctx = offscreen.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const read = (): Float32Array | null => {
      try {
        return luminanceOf(ctx.getImageData(0, 0, cols, rows).data);
      } catch {
        // A cross-origin image taints the canvas; the field then stays noise and still reveals.
        return null;
      }
    };
    if (current.kind === "image") {
      const drawImage = (img: HTMLImageElement) => {
        if (token !== rasterToken || destroyed) return;
        const fit = current.fit ?? "cover";
        const iw = img.naturalWidth || 1;
        const ih = img.naturalHeight || 1;
        let dw = cols;
        let dh = rows;
        if (fit !== "fill") {
          const scale =
            fit === "cover" ? Math.max(cols / iw, rows / ih) : Math.min(cols / iw, rows / ih);
          dw = iw * scale;
          dh = ih * scale;
        }
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
        const lum = read();
        // Lift the shadows so dark interface surfaces keep a texture once dithered.
        if (lum) for (let i = 0; i < lum.length; i++) lum[i] = (lum[i] ?? 0) ** 0.6;
        setTarget(plainKey, lum, false, current.texture ?? 0);
      };
      // A resize redraws from the decoded image at once instead of waiting on another load.
      if (decoded?.src === current.src && decoded.image.complete) {
        drawImage(decoded.image);
        return;
      }
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        decoded = { src: current.src, image: img };
        drawImage(img);
      };
      img.src = current.src;
      return;
    }
    const family = current.fontFamily ?? DEFAULT_FONT;
    const weight = Math.round(current.fontWeight ?? 600);
    const paint = () => {
      if (token !== rasterToken || destroyed) return;
      ctx.clearRect(0, 0, cols, rows);
      const tracking = current.tracking ?? -0.06;
      const inset = (current.inset ?? 0) / cssCell;
      const text = current.text;
      const measureAt = (size: number) => {
        ctx.font = `${weight} ${size}px ${family}`;
        return ctx.measureText(text).width + tracking * size * Math.max(0, text.length - 1);
      };
      let size: number;
      if (current.fontSize === undefined || current.fontSize === "fit") {
        size = (100 * Math.max(1, cols - 2 * inset)) / Math.max(1, measureAt(100));
      } else {
        size = current.fontSize / cssCell;
      }
      ctx.font = `${weight} ${size}px ${family}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#ffffff";
      const metrics = ctx.measureText(text);
      const ascent = metrics.actualBoundingBoxAscent || size * 0.72;
      const descent = metrics.actualBoundingBoxDescent || 0;
      const total = measureAt(size);
      ctx.font = `${weight} ${size}px ${family}`;
      const align = current.align ?? "center";
      const anchor = current.anchor ?? "center";
      const x =
        align === "start" ? inset : align === "end" ? cols - inset - total : (cols - total) / 2;
      const y =
        anchor === "top"
          ? inset + ascent
          : anchor === "bottom"
            ? rows - inset - descent
            : (rows + ascent - descent) / 2;
      // Draw glyph by glyph at cumulative advances, so tracking works where letterSpacing does not.
      for (let i = 0; i < text.length; i++) {
        const before = ctx.measureText(text.slice(0, i)).width;
        ctx.fillText(text[i] ?? "", x + before + tracking * size * i, y);
      }
      setTarget(plainKey, read(), true, current.texture ?? 0.25);
    };
    paint();
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts
        .load(`${weight} 100px ${family}`)
        .then(paint)
        .catch(() => {});
    }
  };

  const draw = (now = typeof performance !== "undefined" ? performance.now() : 0) => {
    if (destroyed || !context || !buffers || !image || !pixels) return;
    const moving = Boolean(unsubscribe);
    if (moving && lastTick > 0) elapsed += ((now - lastTick) / 1000) * options.speed;
    lastTick = moving ? now : 0;
    if (options.interactive && lens.seen) {
      const goal = lens.goal;
      lens.strength += (goal - lens.strength) * 0.18;
      lens.x += (lens.px - lens.x) * 0.35;
      lens.y += (lens.py - lens.y) * 0.35;
    }
    const time = options.still || options.reduced ? 0 : elapsed;
    sampleField(buffers, noiseFor(options.seed), cssCell, time);
    const activeLens: DitherLens | null =
      options.interactive && lens.strength > 0.01
        ? { x: lens.x, y: lens.y, radius: LENS_PX / cssCell, strength: lens.strength }
        : null;
    // Sprites ride the field's own clock, so they freeze where it freezes and pause where it does.
    let spriteOverlay: Float32Array | null = null;
    const sprites = options.sprites;
    if (sprites && sprites.length > 0) {
      const size = buffers.cols * buffers.rows;
      if (!overlay || overlay.length !== size) overlay = new Float32Array(size);
      paintSprites(overlay, buffers.cols, buffers.rows, sprites, time, cssCell, activeLens);
      spriteOverlay = overlay;
    }
    const { cols, rows } = buffers;
    const out = renderLevels(buffers, {
      overlay: spriteOverlay,
      levels: levels(),
      density: options.density,
      edges: options.edges ?? 0,
      ceiling: options.ceiling ?? 1,
      accent: options.accent,
      progress: options.progress,
      target,
      texture,
      targetSparks,
      lens: activeLens,
      clearing: options.clearing.map((area) => ({
        x: (area.x ?? 0.5) * cols,
        y: (area.y ?? 0.5) * rows,
        rx: area.rx * cols,
        ry: area.ry * rows,
      })),
    });
    for (let i = 0; i < out.length; i++) pixels[i] = lut[out[i] ?? 0] ?? 0;
    context.putImageData(image, 0, 0);
    if (fallback) fallback.dataset.hidden = "";
    root.dataset.live = "";
  };

  const tick = (now: number) => {
    if (now - lastFrame < 1000 / Math.max(1, options.fps) - 4) return;
    lastFrame = now;
    draw(now);
  };

  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
    lastTick = 0;
  };

  const shouldRun = () =>
    visible &&
    !document.hidden &&
    !options.still &&
    !options.reduced &&
    !revealed() &&
    options.speed > 0;

  const reconcile = () => {
    if (destroyed) return;
    if (revealed()) canvas.dataset.revealed = "";
    else delete canvas.dataset.revealed;
    if (shouldRun()) {
      if (!unsubscribe) unsubscribe = frameClock().subscribe(tick);
    } else {
      stop();
      if (visible && !document.hidden && !revealed()) draw();
    }
  };

  const onPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / cssCell;
    const y = (event.clientY - rect.top) / cssCell;
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.left + width &&
      event.clientY >= rect.top &&
      event.clientY <= rect.top + height;
    if (!lens.seen) {
      lens.x = x;
      lens.y = y;
    }
    lens.seen = true;
    lens.px = x;
    lens.py = y;
    lens.goal = inside ? 1 : 0;
  };
  const onLeave = () => {
    lens.goal = 0;
  };
  let listening = false;
  const syncPointer = () => {
    const want = options.interactive && fineHover && !options.reduced && !options.still;
    if (want && !listening) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      listening = true;
    } else if (!want && listening) {
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      listening = false;
      lens.goal = 0;
      lens.strength = 0;
    }
  };

  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            reconcile();
          },
          { rootMargin: "64px" },
        );
  const sizer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (resize()) {
            rasterize();
            draw();
          }
        });

  buildLut();
  if (resize()) rasterize();
  observer?.observe(root);
  sizer?.observe(root);
  document.addEventListener("visibilitychange", reconcile);
  syncPointer();
  if (context) {
    draw();
    reconcile();
  }

  return {
    update(next) {
      const previous = options;
      options = next;
      if (
        next.palette.join() !== previous.palette.join() ||
        next.transparent !== previous.transparent
      ) {
        buildLut();
      }
      if (
        next.cell !== previous.cell ||
        next.seed !== previous.seed ||
        next.order !== previous.order
      ) {
        resize();
      }
      rasterize();
      syncPointer();
      reconcile();
    },
    destroy() {
      destroyed = true;
      stop();
      observer?.disconnect();
      sizer?.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
      options = { ...options, interactive: false };
      syncPointer();
    },
  };
}
