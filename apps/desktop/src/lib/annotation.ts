/**
 * What Annotate sends (docs/superpowers/plans/2026-11-09-browser.md): the person's note, then each
 * picked element as an agent can find it in the code (its tag, text, selector, component, size,
 * styles and markup), and a screenshot cropped around it with the selection drawn on.
 */
import type { BrowserPick, PickedElement, PickRect } from "../bindings";

export interface Annotation {
  readonly pick: BrowserPick;
  /** The picked elements: the first click's, then any Shift-clicked onto the note. */
  readonly elements: readonly PickedElement[];
}

const round = (value: number | null | undefined) => Math.round(value ?? 0);

/** `<button.cta> "Get started"`: an element in a line. */
export function elementLabel(element: PickedElement): string {
  const classes = (element.classes ?? []).slice(0, 2);
  const tag = `<${element.tag}${element.id ? `#${element.id}` : ""}${classes.length ? `.${classes.join(".")}` : ""}>`;
  const text = (element.text ?? "").trim();
  return text ? `${tag} "${text.length > 60 ? `${text.slice(0, 60)}…` : text}"` : tag;
}

function rectLine(rect: PickRect, pick: BrowserPick): string {
  return `${round(rect.width)}×${round(rect.height)} at (${round(rect.x)}, ${round(rect.y)}) in a ${round(pick.viewport.width)}×${round(pick.viewport.height)} view`;
}

/** The message: the note, then where it points. */
export function annotationText(note: string, annotation: Annotation, withImage: boolean): string {
  const { pick, elements } = annotation;
  const lines: string[] = [];
  const said = note.trim();
  if (said) lines.push(said, "");
  const page = pick.title ? `"${pick.title}" (${pick.url})` : pick.url;
  lines.push(`Annotated in the browser on ${page}:`);
  elements.forEach((element, index) => {
    lines.push(`${elements.length > 1 ? `${index + 1}. ` : "- "}${elementLabel(element)}`);
    const indent = "   ";
    if (element.selector) lines.push(`${indent}Selector: ${element.selector}`);
    if (element.component) {
      const stack = (element.component.stack ?? []).join(" › ");
      lines.push(
        `${indent}Component: ${element.component.name}${stack ? ` (${element.component.framework || "component"}: ${stack})` : ""}`,
      );
    }
    lines.push(`${indent}${rectLine(element.rect, pick)}`);
    const styles = Object.entries(element.styles ?? {})
      .filter(([, value]) => value)
      .map(([name, value]) => `${name} ${value}`);
    if (styles.length) lines.push(`${indent}Styles: ${styles.join("; ")}`);
    if (element.html) lines.push(`${indent}HTML: ${element.html}`);
  });
  if (pick.mode === "area" && pick.area) {
    lines.push(`The area marked: ${rectLine(pick.area, pick)}.`);
  }
  if (withImage) lines.push("The attached image shows it outlined on the page.");
  return lines.join("\n");
}

/** Every box the annotation marks: the area, then each element. */
export function marks(annotation: Annotation): readonly PickRect[] {
  const boxes: PickRect[] = [];
  if (annotation.pick.mode === "area" && annotation.pick.area) boxes.push(annotation.pick.area);
  else for (const element of annotation.elements) boxes.push(element.rect);
  return boxes;
}

/**
 * The part of the page the image shows: the marks with room around them, at least `least` so the
 * agent sees their surroundings, inside the view.
 */
export function cropBox(
  annotation: Annotation,
  least: { width: number; height: number } = { width: 560, height: 360 },
  pad = 32,
): PickRect {
  const view = annotation.pick.viewport;
  const width = Math.max(1, view.width ?? 1);
  const height = Math.max(1, view.height ?? 1);
  const boxes = marks(annotation);
  if (!boxes.length) return { x: 0, y: 0, width, height };
  let left = Math.min(...boxes.map((box) => box.x ?? 0)) - pad;
  let top = Math.min(...boxes.map((box) => box.y ?? 0)) - pad;
  let right = Math.max(...boxes.map((box) => (box.x ?? 0) + (box.width ?? 0))) + pad;
  let bottom = Math.max(...boxes.map((box) => (box.y ?? 0) + (box.height ?? 0))) + pad;
  const grow = (low: number, high: number, wanted: number, limit: number): [number, number] => {
    const missing = wanted - (high - low);
    if (missing <= 0) return [low, high];
    let start = low - missing / 2;
    let end = high + missing / 2;
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > limit) {
      start -= end - limit;
      end = limit;
    }
    return [Math.max(0, start), Math.min(limit, end)];
  };
  [left, right] = grow(left, right, Math.min(least.width, width), width);
  [top, bottom] = grow(top, bottom, Math.min(least.height, height), height);
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(width, Math.max(left + 1, right));
  bottom = Math.min(height, Math.max(top + 1, bottom));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The image the agent gets: the screenshot cropped to `cropBox`, the marks drawn in `accent`. */
export async function annotationImage(
  annotation: Annotation,
  accent: string,
  limit = 2048,
): Promise<Uint8Array | null> {
  const source = annotation.pick.screenshot;
  if (!source) return null;
  const picture = new Image();
  picture.src = source;
  try {
    await picture.decode();
  } catch {
    return null;
  }
  const view = annotation.pick.viewport;
  const ratio = picture.naturalWidth / Math.max(1, view.width ?? 1);
  const crop = cropBox(annotation);
  const scale = Math.min(
    1,
    limit / Math.max((crop.width ?? 1) * ratio, (crop.height ?? 1) * ratio),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((crop.width ?? 1) * ratio * scale));
  canvas.height = Math.max(1, Math.round((crop.height ?? 1) * ratio * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(
    picture,
    (crop.x ?? 0) * ratio,
    (crop.y ?? 0) * ratio,
    (crop.width ?? 1) * ratio,
    (crop.height ?? 1) * ratio,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const unit = ratio * scale;
  context.strokeStyle = accent;
  context.fillStyle = accent;
  context.lineWidth = Math.max(2, 2 * unit);
  const boxes = marks(annotation);
  boxes.forEach((box, index) => {
    const x = ((box.x ?? 0) - (crop.x ?? 0)) * unit;
    const y = ((box.y ?? 0) - (crop.y ?? 0)) * unit;
    context.strokeRect(x, y, (box.width ?? 0) * unit, (box.height ?? 0) * unit);
    if (boxes.length > 1) {
      const radius = 10 * unit;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.save();
      context.fillStyle = "white";
      context.font = `600 ${Math.round(12 * unit)}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), x, y);
      context.restore();
    }
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
