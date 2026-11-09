import {
  arrowHead,
  bounds,
  type Drawing,
  type Element,
  INKS,
  type Ink,
  markers,
  STROKE,
  strokeWidth,
  TEXT_SIZE,
  union,
} from "./model";

/** The colours a drawing renders with: the theme's in effect, resolved from its tokens. */
export interface Palette {
  readonly ink: Readonly<Record<Ink, string>>;
  readonly background: string;
  /** The marker's disc and its number. */
  readonly marker: string;
  readonly markerText: string;
  readonly font: string;
}

/** The longest side of an export, the composer's image limit. */
export const MAX_EXPORT = 2048;
/** Room around what was drawn, in drawing units. */
export const EXPORT_PADDING = 32;
export const MARKER_RADIUS = 11;

/** The palette from the page's tokens, as the drawing shows now. */
export function paletteOf(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const ink = Object.fromEntries(
    INKS.map((name) => [
      name,
      token(name === "ink" ? "--g-fg-1" : `--g-ansi-${name}`, name === "ink" ? "#111" : "#888"),
    ]),
  ) as Record<Ink, string>;
  return {
    ink,
    background: token("--g-bg", "#fff"),
    marker: token("--g-volt", "#111"),
    markerText: token("--g-bg", "#fff"),
    font: token("--g-sans", "sans-serif"),
  };
}

/** The area an export covers: what was drawn and its markers, with padding. */
export function exportArea(
  drawing: Drawing,
): { x: number; y: number; w: number; h: number } | null {
  const boxes = drawing.elements.map(bounds);
  for (const marker of markers(drawing))
    boxes.push({
      x: marker.at.x - MARKER_RADIUS * 2,
      y: marker.at.y - MARKER_RADIUS * 2,
      w: MARKER_RADIUS * 2,
      h: MARKER_RADIUS * 2,
    });
  const box = union(boxes);
  if (!box) return null;
  return {
    x: box.x - EXPORT_PADDING,
    y: box.y - EXPORT_PADDING,
    w: box.w + EXPORT_PADDING * 2,
    h: box.h + EXPORT_PADDING * 2,
  };
}

/** The scale an export renders at: twice the drawing's size, within `MAX_EXPORT`. */
export function exportScale(area: { w: number; h: number }): number {
  return Math.min(2, MAX_EXPORT / Math.max(area.w, area.h, 1));
}

function item<T>(list: readonly T[], index: number): T {
  return list[index] as T;
}

function draw(context: CanvasRenderingContext2D, element: Element, palette: Palette) {
  const colour = palette.ink[element.ink];
  context.strokeStyle = colour;
  context.fillStyle = colour;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha = 1;
  switch (element.kind) {
    case "stroke": {
      context.lineWidth = strokeWidth(element);
      if (element.highlighter) context.globalAlpha = 0.35;
      const points = element.points;
      context.beginPath();
      context.moveTo(item(points, 0).x, item(points, 0).y);
      if (points.length === 1) context.lineTo(item(points, 0).x + 0.01, item(points, 0).y);
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = item(points, index);
        const next = item(points, index + 1);
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      if (points.length > 1)
        context.lineTo(item(points, points.length - 1).x, item(points, points.length - 1).y);
      context.stroke();
      return;
    }
    case "rect":
    case "ellipse": {
      const box = bounds(element);
      context.lineWidth = STROKE[element.width];
      context.beginPath();
      if (element.kind === "rect") context.roundRect(box.x, box.y, box.w, box.h, 6);
      else
        context.ellipse(
          box.x + box.w / 2,
          box.y + box.h / 2,
          box.w / 2,
          box.h / 2,
          0,
          0,
          Math.PI * 2,
        );
      context.stroke();
      return;
    }
    case "arrow": {
      context.lineWidth = STROKE[element.width];
      const [left, right] = arrowHead(element.from, element.to, 8 + STROKE[element.width] * 2);
      context.beginPath();
      context.moveTo(element.from.x, element.from.y);
      context.lineTo(element.to.x, element.to.y);
      context.moveTo(left.x, left.y);
      context.lineTo(element.to.x, element.to.y);
      context.lineTo(right.x, right.y);
      context.stroke();
      return;
    }
    case "text": {
      const size = TEXT_SIZE[element.width];
      context.font = `500 ${size}px ${palette.font}`;
      context.textBaseline = "top";
      element.text.split("\n").forEach((line, index) => {
        context.fillText(line, element.x, element.y + index * size * 1.3);
      });
      return;
    }
  }
}

/** Renders the drawing as a PNG, cropped to what was drawn; `null` when nothing was. */
export async function renderPng(drawing: Drawing, palette: Palette): Promise<Uint8Array | null> {
  const area = exportArea(drawing);
  if (!area) return null;
  const scale = exportScale(area);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(area.w * scale));
  canvas.height = Math.max(1, Math.ceil(area.h * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This system could not draw the canvas as an image.");
  context.fillStyle = palette.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
  for (const element of drawing.elements) draw(context, element, palette);
  context.globalAlpha = 1;
  for (const marker of markers(drawing)) {
    const x = marker.at.x - MARKER_RADIUS;
    const y = marker.at.y - MARKER_RADIUS;
    context.fillStyle = palette.marker;
    context.beginPath();
    context.arc(x, y, MARKER_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = palette.markerText;
    context.font = `600 12px ${palette.font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(marker.number), x, y + 0.5);
    context.textAlign = "start";
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This system could not draw the canvas as an image.");
  return new Uint8Array(await blob.arrayBuffer());
}
