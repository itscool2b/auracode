/**
 * Canvas (docs/superpowers/plans/2026-11-09-canvas.md): a drawing as a small vector model, its
 * history, hit testing, and the two texts that travel with it: the outline (what the drawing shows,
 * readable without vision) and the narration (what the person said while drawing, numbered by the
 * shapes drawn while each phrase was spoken). Nothing here touches the page or the agent.
 */

/** The item at `index`, which the caller has bounds-checked. */
function item<T>(list: readonly T[], index: number): T {
  return list[index] as T;
}

export type Tool =
  | "select"
  | "pen"
  | "highlighter"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "eraser";

/** Colours are the theme's tokens, so a drawing repaints with the theme and appearance. */
export type Ink = "ink" | "red" | "yellow" | "green" | "blue" | "magenta" | "cyan";
export const INKS: readonly Ink[] = ["ink", "red", "yellow", "green", "blue", "magenta", "cyan"];
export const INK_TOKENS: Readonly<Record<Ink, string>> = {
  ink: "--g-fg-1",
  red: "--g-ansi-red",
  yellow: "--g-ansi-yellow",
  green: "--g-ansi-green",
  blue: "--g-ansi-blue",
  magenta: "--g-ansi-magenta",
  cyan: "--g-ansi-cyan",
};
export const INK_NAMES: Readonly<Record<Ink, string>> = {
  ink: "Ink",
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  magenta: "Magenta",
  cyan: "Cyan",
};

export type Width = 1 | 2 | 3;
export const WIDTHS: readonly Width[] = [1, 2, 3];
/** Line widths in drawing units, and the text size each width sets. */
export const STROKE: Readonly<Record<Width, number>> = { 1: 2, 2: 4, 3: 8 };
export const TEXT_SIZE: Readonly<Record<Width, number>> = { 1: 14, 2: 18, 3: 26 };
export const WIDTH_NAMES: Readonly<Record<Width, string>> = { 1: "Thin", 2: "Medium", 3: "Bold" };

export interface Point {
  readonly x: number;
  readonly y: number;
}

interface Base {
  readonly id: string;
  readonly ink: Ink;
  readonly width: Width;
  /** When it was drawn, for the narration. */
  readonly at: number;
}

export type Element =
  | (Base & {
      readonly kind: "stroke";
      readonly points: readonly Point[];
      readonly highlighter: boolean;
      /** The stylus's mean pressure, 0 to 1 (0.5 for a mouse). */
      readonly pressure: number;
    })
  | (Base & {
      readonly kind: "rect" | "ellipse";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    })
  | (Base & {
      readonly kind: "arrow";
      readonly from: Point;
      readonly to: Point;
      /** The shapes it starts and ends on, which it follows when they move. */
      readonly start: string | null;
      readonly end: string | null;
    })
  | (Base & {
      readonly kind: "text";
      readonly x: number;
      readonly y: number;
      readonly text: string;
    });

/** A phrase of the narration and when it settled. */
export interface Phrase {
  readonly text: string;
  readonly at: number;
}

export interface Drawing {
  readonly elements: readonly Element[];
  readonly narration: readonly Phrase[];
  /** When the narration began: shapes drawn before it belong to no phrase. */
  readonly narratedFrom: number | null;
}

export const EMPTY: Drawing = { elements: [], narration: [], narratedFrom: null };

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A text element's box: Geist runs about 0.56em wide per character. */
export function textBox(element: Extract<Element, { kind: "text" }>): Box {
  const size = TEXT_SIZE[element.width];
  const lines = element.text.split("\n");
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return { x: element.x, y: element.y, w: longest * size * 0.56, h: lines.length * size * 1.3 };
}

export function bounds(element: Element): Box {
  switch (element.kind) {
    case "stroke": {
      const xs = element.points.map((point) => point.x);
      const ys = element.points.map((point) => point.y);
      const pad = strokeWidth(element) / 2;
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
    }
    case "rect":
    case "ellipse":
      return normalized(element);
    case "arrow": {
      const x = Math.min(element.from.x, element.to.x);
      const y = Math.min(element.from.y, element.to.y);
      return {
        x,
        y,
        w: Math.max(element.from.x, element.to.x) - x,
        h: Math.max(element.from.y, element.to.y) - y,
      };
    }
    case "text":
      return textBox(element);
  }
}

/** A box whose width and height are never negative. */
export function normalized(box: Box): Box {
  return {
    x: Math.min(box.x, box.x + box.w),
    y: Math.min(box.y, box.y + box.h),
    w: Math.abs(box.w),
    h: Math.abs(box.h),
  };
}

export function union(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function strokeWidth(element: Extract<Element, { kind: "stroke" }>): number {
  const base = STROKE[element.width] * (element.highlighter ? 3 : 1);
  // A stylus pressed harder draws up to half again as wide; a light touch down to half.
  return base * (0.5 + element.pressure);
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function inside(point: Point, box: Box, slack = 0): boolean {
  return (
    point.x >= box.x - slack &&
    point.x <= box.x + box.w + slack &&
    point.y >= box.y - slack &&
    point.y <= box.y + box.h + slack
  );
}

/** Whether `point` touches the element, within `tolerance` drawing units. */
export function hits(element: Element, point: Point, tolerance: number): boolean {
  switch (element.kind) {
    case "stroke": {
      const reach = tolerance + strokeWidth(element) / 2;
      const points = element.points;
      if (points.length === 1)
        return Math.hypot(point.x - item(points, 0).x, point.y - item(points, 0).y) <= reach;
      for (let index = 1; index < points.length; index += 1)
        if (distanceToSegment(point, item(points, index - 1), item(points, index)) <= reach)
          return true;
      return false;
    }
    case "arrow":
      return (
        distanceToSegment(point, element.from, element.to) <= tolerance + STROKE[element.width]
      );
    case "rect":
    case "ellipse":
    case "text":
      return inside(point, bounds(element), tolerance);
  }
}

/** The topmost element under `point`. */
export function elementAt(drawing: Drawing, point: Point, tolerance: number): Element | null {
  for (let index = drawing.elements.length - 1; index >= 0; index -= 1)
    if (hits(item(drawing.elements, index), point, tolerance)) return item(drawing.elements, index);
  return null;
}

/** The topmost shape (rectangle or ellipse) an arrow end at `point` attaches to. */
export function shapeAt(drawing: Drawing, point: Point, tolerance: number): Element | null {
  for (let index = drawing.elements.length - 1; index >= 0; index -= 1) {
    const element = item(drawing.elements, index);
    if (
      (element.kind === "rect" || element.kind === "ellipse") &&
      inside(point, bounds(element), tolerance)
    )
      return element;
  }
  return null;
}

/** The elements whose boxes meet `area` (a marquee selection). */
export function within(drawing: Drawing, area: Box): string[] {
  const box = normalized(area);
  return drawing.elements
    .filter((element) => {
      const own = bounds(element);
      return (
        own.x <= box.x + box.w &&
        own.x + own.w >= box.x &&
        own.y <= box.y + box.h &&
        own.y + own.h >= box.y
      );
    })
    .map((element) => element.id);
}

function shifted(element: Element, dx: number, dy: number): Element {
  switch (element.kind) {
    case "stroke":
      return {
        ...element,
        points: element.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      };
    case "arrow":
      return {
        ...element,
        from: { x: element.from.x + dx, y: element.from.y + dy },
        to: { x: element.to.x + dx, y: element.to.y + dy },
      };
    default:
      return { ...element, x: element.x + dx, y: element.y + dy };
  }
}

/** Moves the elements `ids`; an arrow attached to a moved shape takes that end along. */
export function moveElements(
  drawing: Drawing,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): Drawing {
  return {
    ...drawing,
    elements: drawing.elements.map((element) => {
      if (ids.has(element.id)) return shifted(element, dx, dy);
      if (element.kind !== "arrow") return element;
      const start = element.start !== null && ids.has(element.start);
      const end = element.end !== null && ids.has(element.end);
      if (!start && !end) return element;
      return {
        ...element,
        from: start ? { x: element.from.x + dx, y: element.from.y + dy } : element.from,
        to: end ? { x: element.to.x + dx, y: element.to.y + dy } : element.to,
      };
    }),
  };
}

/** Removes the elements `ids`; arrows that pointed at them stay, unattached. */
export function removeElements(drawing: Drawing, ids: ReadonlySet<string>): Drawing {
  return {
    ...drawing,
    elements: drawing.elements
      .filter((element) => !ids.has(element.id))
      .map((element) =>
        element.kind === "arrow" &&
        ((element.start !== null && ids.has(element.start)) ||
          (element.end !== null && ids.has(element.end)))
          ? {
              ...element,
              start: element.start !== null && ids.has(element.start) ? null : element.start,
              end: element.end !== null && ids.has(element.end) ? null : element.end,
            }
          : element,
      ),
  };
}

export function addElement(drawing: Drawing, element: Element): Drawing {
  return { ...drawing, elements: [...drawing.elements, element] };
}

export function replaceElement(drawing: Drawing, element: Element): Drawing {
  return {
    ...drawing,
    elements: drawing.elements.map((existing) => (existing.id === element.id ? element : existing)),
  };
}

/**
 * A smooth SVG path through the points: quadratic curves through the midpoints, so a freehand line
 * has no corners where the pointer sampled it.
 */
export function strokePath(points: readonly Point[]): string {
  if (!points.length) return "";
  const round = (value: number) => Math.round(value * 100) / 100;
  if (points.length === 1) {
    const { x, y } = item(points, 0);
    return `M${round(x)} ${round(y)}L${round(x + 0.01)} ${round(y)}`;
  }
  let path = `M${round(item(points, 0).x)} ${round(item(points, 0).y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = item(points, index);
    const next = item(points, index + 1);
    path += `Q${round(point.x)} ${round(point.y)} ${round((point.x + next.x) / 2)} ${round((point.y + next.y) / 2)}`;
  }
  const last = item(points, points.length - 1);
  return `${path}L${round(last.x)} ${round(last.y)}`;
}

/** Drops points closer than `spacing` to the last kept one, keeping the stroke's ends. */
export function simplify(points: readonly Point[], spacing: number): Point[] {
  if (points.length <= 2) return [...points];
  const kept: Point[] = [item(points, 0)];
  for (let index = 1; index < points.length - 1; index += 1) {
    const last = item(kept, kept.length - 1);
    if (Math.hypot(item(points, index).x - last.x, item(points, index).y - last.y) >= spacing)
      kept.push(item(points, index));
  }
  kept.push(item(points, points.length - 1));
  return kept;
}

/** The arrowhead's two barbs at `to`, as line ends. */
export function arrowHead(from: Point, to: Point, size: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) },
  ];
}

/** Undo and redo over whole drawings, bounded. */
export class History {
  #past: Drawing[] = [];
  #future: Drawing[] = [];
  constructor(readonly limit = 200) {}
  get canUndo(): boolean {
    return this.#past.length > 0;
  }
  get canRedo(): boolean {
    return this.#future.length > 0;
  }
  /** Records `before` as the state to return to, and forgets what was undone. */
  push(before: Drawing): void {
    this.#past.push(before);
    if (this.#past.length > this.limit) this.#past.shift();
    this.#future = [];
  }
  undo(current: Drawing): Drawing | null {
    const previous = this.#past.pop();
    if (!previous) return null;
    this.#future.push(current);
    return previous;
  }
  redo(current: Drawing): Drawing | null {
    const next = this.#future.pop();
    if (!next) return null;
    this.#past.push(current);
    return next;
  }
}

/** A phrase of the narration with the shapes drawn while it was said, and its marker's number. */
export interface NarratedPhrase {
  readonly number: number;
  readonly text: string;
  readonly ids: readonly string[];
}

/**
 * The narration, numbered: each phrase takes the elements drawn after the previous phrase settled
 * and up to its own settling (phrases settle just after they are said, so these are the shapes
 * drawn while saying it). Elements drawn before the narration began belong to none.
 */
export function narrate(drawing: Drawing): NarratedPhrase[] {
  const phrases = [...drawing.narration]
    .filter((phrase) => phrase.text.trim() !== "")
    .sort((a, b) => a.at - b.at);
  let from = drawing.narratedFrom ?? Number.NEGATIVE_INFINITY;
  return phrases.map((phrase, index) => {
    const ids = drawing.elements
      .filter((element) => element.at > from && element.at <= phrase.at)
      .map((element) => element.id);
    from = phrase.at;
    return { number: index + 1, text: phrase.text.trim(), ids };
  });
}

/** Where each numbered phrase's marker goes: at the top left of what was drawn while saying it. */
export function markers(drawing: Drawing): { number: number; at: Point }[] {
  const byId = new Map(drawing.elements.map((element) => [element.id, element]));
  return narrate(drawing).flatMap((phrase) => {
    const box = union(
      phrase.ids.flatMap((id) => {
        const element = byId.get(id);
        return element ? [bounds(element)] : [];
      }),
    );
    return box ? [{ number: phrase.number, at: { x: box.x, y: box.y } }] : [];
  });
}

function quoted(text: string): string {
  return `"${text.replace(/\s+/g, " ").trim()}"`;
}

/**
 * What the drawing shows, as a short list an agent can read without seeing it: shapes by their
 * labels (text written inside them), the arrows between them, free text and freehand strokes.
 */
export function outline(drawing: Drawing): string[] {
  const shapes = drawing.elements.filter(
    (element): element is Extract<Element, { kind: "rect" | "ellipse" }> =>
      element.kind === "rect" || element.kind === "ellipse",
  );
  const texts = drawing.elements.filter(
    (element): element is Extract<Element, { kind: "text" }> =>
      element.kind === "text" && element.text.trim() !== "",
  );
  const labels = new Map<string, string[]>();
  const labelled = new Set<string>();
  for (const text of texts) {
    const box = textBox(text);
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    // The smallest shape around the text's centre is the one it labels.
    const around = shapes
      .filter((shape) => inside(centre, bounds(shape)))
      .sort((a, b) => bounds(a).w * bounds(a).h - bounds(b).w * bounds(b).h)[0];
    if (!around) continue;
    labels.set(around.id, [...(labels.get(around.id) ?? []), text.text]);
    labelled.add(text.id);
  }
  const counts = { rect: 0, ellipse: 0 };
  const names = new Map<string, string>();
  for (const shape of shapes) {
    counts[shape.kind] += 1;
    const label = labels.get(shape.id);
    names.set(
      shape.id,
      label
        ? quoted(label.join(" "))
        : `${shape.kind === "rect" ? "box" : "oval"} ${counts[shape.kind]}`,
    );
  }
  const lines: string[] = [];
  for (const shape of shapes) {
    const kind = shape.kind === "rect" ? "box" : "oval";
    const name = names.get(shape.id) ?? kind;
    lines.push(labels.has(shape.id) ? `${kind} ${name}` : name);
  }
  const end = (point: Point, bound: string | null) => {
    const shape =
      (bound && shapes.find((candidate) => candidate.id === bound)) ||
      shapes.find((candidate) => inside(point, bounds(candidate), 4));
    return shape ? names.get(shape.id) : null;
  };
  for (const element of drawing.elements) {
    if (element.kind !== "arrow") continue;
    const from = end(element.from, element.start);
    const to = end(element.to, element.end);
    lines.push(
      from && to
        ? `arrow from ${from} to ${to}`
        : from
          ? `arrow from ${from}`
          : to
            ? `arrow to ${to}`
            : "arrow",
    );
  }
  for (const text of texts) if (!labelled.has(text.id)) lines.push(`text ${quoted(text.text)}`);
  const strokes = drawing.elements.filter((element) => element.kind === "stroke").length;
  if (strokes) lines.push(strokes === 1 ? "1 freehand stroke" : `${strokes} freehand strokes`);
  return lines;
}

/**
 * The text Add to message puts in the draft: the outline, then the numbered narration. `image`
 * says whether the drawing itself is attached (an agent without image support gets only this).
 */
export function messageText(drawing: Drawing, image: boolean): string {
  const lines = outline(drawing);
  const narration = narrate(drawing);
  const parts: string[] = [];
  if (lines.length)
    parts.push(
      [
        image
          ? "The attached canvas shows:"
          : "My canvas (not attached: this agent cannot see images) shows:",
        ...lines.map((line) => `- ${line}`),
      ].join("\n"),
    );
  if (narration.length)
    parts.push(
      [
        image && narration.some((phrase) => phrase.ids.length)
          ? "While drawing I said (the numbers match the canvas):"
          : "While drawing I said:",
        ...narration.map((phrase) => `${phrase.number}. ${phrase.text}`),
      ].join("\n"),
    );
  return parts.join("\n\n");
}

/** A short count of what the drawing holds, for the screen reader and the toolbar. */
export function summary(drawing: Drawing): string {
  const count = (kinds: Element["kind"][]) =>
    drawing.elements.filter((element) => kinds.includes(element.kind)).length;
  const parts: string[] = [];
  const shapes = count(["rect", "ellipse"]);
  const arrows = count(["arrow"]);
  const texts = count(["text"]);
  const strokes = count(["stroke"]);
  if (shapes) parts.push(`${shapes} ${shapes === 1 ? "shape" : "shapes"}`);
  if (arrows) parts.push(`${arrows} ${arrows === 1 ? "arrow" : "arrows"}`);
  if (texts) parts.push(`${texts} ${texts === 1 ? "text" : "texts"}`);
  if (strokes) parts.push(`${strokes} ${strokes === 1 ? "stroke" : "strokes"}`);
  return parts.length ? parts.join(", ") : "Empty";
}

const STORAGE = "auracode.canvas.";
/** A saved drawing is at most this large. */
export const MAX_SAVED = 2 * 1024 * 1024;

function valid(value: unknown): value is Drawing {
  if (!value || typeof value !== "object") return false;
  const drawing = value as Drawing;
  return Array.isArray(drawing.elements) && Array.isArray(drawing.narration);
}

/** The chat's saved drawing on this device; anything unreadable reads as empty. */
export function loadDrawing(storage: Pick<Storage, "getItem"> | null, chatId: string): Drawing {
  try {
    const text = storage?.getItem(STORAGE + chatId);
    if (!text) return EMPTY;
    const value: unknown = JSON.parse(text);
    if (!valid(value)) return EMPTY;
    return {
      elements: value.elements,
      narration: value.narration,
      narratedFrom: value.narratedFrom ?? null,
    };
  } catch {
    return EMPTY;
  }
}

/** Saves the drawing, or says why it could not: too large, or the storage refused it. */
export function saveDrawing(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  chatId: string,
  drawing: Drawing,
): string | null {
  if (!storage) return null;
  try {
    if (!drawing.elements.length && !drawing.narration.length) {
      storage.removeItem(STORAGE + chatId);
      return null;
    }
    const text = JSON.stringify(drawing);
    if (text.length > MAX_SAVED)
      return "This drawing is too large to keep on this device. Clear part of it to keep the rest.";
    storage.setItem(STORAGE + chatId, text);
    return null;
  } catch {
    return "This drawing could not be kept on this device.";
  }
}
