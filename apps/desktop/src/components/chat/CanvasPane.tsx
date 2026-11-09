import "./canvas.css";
import {
  BrushCleaning,
  Circle,
  Eraser,
  Highlighter,
  ImagePlus,
  Maximize,
  Mic,
  MousePointer2,
  MoveUpRight,
  PenTool,
  Redo2,
  Square,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { paletteOf, renderPng } from "../../lib/canvas/export";
import {
  addElement,
  arrowHead,
  bounds,
  type Drawing,
  type Element,
  EMPTY,
  elementAt,
  History,
  INK_NAMES,
  INK_TOKENS,
  INKS,
  type Ink,
  loadDrawing,
  markers,
  messageText,
  moveElements,
  normalized,
  outline,
  type Point,
  removeElements,
  replaceElement,
  STROKE,
  saveDrawing,
  shapeAt,
  simplify,
  strokePath,
  strokeWidth,
  summary,
  TEXT_SIZE,
  type Tool,
  WIDTH_NAMES,
  WIDTHS,
  type Width,
  within,
  withLabels,
} from "../../lib/canvas/model";
import { type DictationApi, DictationController } from "../../lib/dictation";
import { errorMessage } from "../../lib/errors";

/** What the canvas needs from the composer below it, registered by the composer itself. */
export interface CanvasComposer {
  /** Adds the drawing as an image attachment, replacing `replace` while it is still attached. */
  addImage(bytes: Uint8Array, replace: string | null): Promise<string | null>;
  /** Puts `text` in the draft, in place of `previous` where the draft still holds it. */
  putText(text: string, previous: string | null): void;
  /** The message already holds its eight attachments. */
  full(): boolean;
}

/** The chat's link between its canvas and its composer. */
export class CanvasBridge {
  composer: CanvasComposer | null = null;
}

const TOOLS: readonly { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: "select", label: "Select", key: "V", icon: <MousePointer2 size={16} /> },
  { id: "pen", label: "Pen", key: "P", icon: <PenTool size={16} /> },
  { id: "highlighter", label: "Highlighter", key: "H", icon: <Highlighter size={16} /> },
  { id: "rect", label: "Rectangle", key: "R", icon: <Square size={16} /> },
  { id: "ellipse", label: "Ellipse", key: "O", icon: <Circle size={16} /> },
  { id: "arrow", label: "Arrow", key: "A", icon: <MoveUpRight size={16} /> },
  { id: "text", label: "Text", key: "T", icon: <Type size={16} /> },
  { id: "eraser", label: "Eraser", key: "E", icon: <Eraser size={16} /> },
];

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

interface View {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** What a pointer is doing between down and up. */
type Gesture =
  | { kind: "draw"; element: Element; pressures: number[] }
  | { kind: "move"; from: Point; moved: Point; before: Drawing; ids: ReadonlySet<string> }
  | { kind: "marquee"; from: Point; to: Point }
  | { kind: "erase"; before: Drawing; removed: Set<string> }
  | { kind: "pan"; from: { x: number; y: number }; view: View };

interface TextEdit {
  readonly id: string | null;
  readonly at: Point;
  readonly value: string;
  readonly ink: Ink;
  readonly width: Width;
}

const IDLE_STATE = { state: "idle" } as const;
const IDLE = () => IDLE_STATE;
const IGNORE = () => () => {};

let next = 0;
const newId = () => `${Date.now().toString(36)}-${(next++).toString(36)}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** One drawing element in the theme's colours. */
function Shape({ element, selected }: { readonly element: Element; readonly selected: boolean }) {
  const colour = `var(${INK_TOKENS[element.ink]})`;
  const common = { "data-id": element.id, "data-selected": selected ? "" : undefined };
  switch (element.kind) {
    case "stroke":
      return (
        <path
          {...common}
          d={strokePath(element.points)}
          fill="none"
          stroke={colour}
          strokeWidth={strokeWidth(element)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={element.highlighter ? 0.35 : 1}
        />
      );
    case "rect": {
      const box = normalized(element);
      return (
        <rect
          {...common}
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx={6}
          fill="none"
          stroke={colour}
          strokeWidth={STROKE[element.width]}
        />
      );
    }
    case "ellipse": {
      const box = normalized(element);
      return (
        <ellipse
          {...common}
          cx={box.x + box.w / 2}
          cy={box.y + box.h / 2}
          rx={box.w / 2}
          ry={box.h / 2}
          fill="none"
          stroke={colour}
          strokeWidth={STROKE[element.width]}
        />
      );
    }
    case "arrow": {
      const [left, right] = arrowHead(element.from, element.to, 8 + STROKE[element.width] * 2);
      return (
        <g
          {...common}
          stroke={colour}
          strokeWidth={STROKE[element.width]}
          strokeLinecap="round"
          fill="none"
        >
          <line x1={element.from.x} y1={element.from.y} x2={element.to.x} y2={element.to.y} />
          <polyline
            points={`${left.x},${left.y} ${element.to.x},${element.to.y} ${right.x},${right.y}`}
            strokeLinejoin="round"
          />
        </g>
      );
    }
    case "text": {
      const size = TEXT_SIZE[element.width];
      return (
        <text
          {...common}
          x={element.x}
          y={element.y}
          fill={colour}
          fontSize={size}
          className="canvas-text"
        >
          {element.text.split("\n").map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one text have no other identity
            <tspan key={index} x={element.x} dy={index === 0 ? size : size * 1.3}>
              {line || " "}
            </tspan>
          ))}
        </text>
      );
    }
  }
}

/**
 * The canvas (docs/superpowers/plans/2026-11-09-canvas.md): it takes the transcript's place above
 * a live composer. The person draws, types or says the context, and Add to message puts the
 * drawing (as an image), its outline and the numbered narration in the composer.
 */
export function CanvasPane({
  chatId,
  bridge,
  images,
  dictation: dictationApi,
  onClose,
  saved = storage(),
}: {
  readonly chatId: string;
  readonly bridge: CanvasBridge;
  /** Whether the agent sees images: `null` until its session says. */
  readonly images: boolean | null;
  readonly dictation?: DictationApi;
  readonly onClose: () => void;
  readonly saved?: Storage | null;
}) {
  const [drawing, setDrawing] = useState<Drawing>(() => loadDrawing(saved, chatId));
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const [history] = useState(() => new History());
  const [tool, setTool] = useState<Tool>("pen");
  const [ink, setInk] = useState<Ink>("ink");
  const [width, setWidth] = useState<Width>(2);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [editing, setEditingState] = useState<TextEdit | null>(null);
  // The edit open now: Enter and the blur that follows it commit it once.
  const editingRef = useRef<TextEdit | null>(null);
  const setEditing = useCallback((value: TextEdit | null) => {
    editingRef.current = value;
    setEditingState(value);
  }, []);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [space, setSpace] = useState(false);
  const [, setRevision] = useState(0);
  const added = useRef<{ image: string | null; text: string | null }>({ image: null, text: null });
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<SVGSVGElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const outlineId = useId();

  // The drawing stays with the chat on this device.
  useEffect(() => {
    const failed = saveDrawing(saved, chatId, drawing);
    if (failed) setNote(failed);
  }, [saved, chatId, drawing]);

  const commit = useCallback(
    (next: Drawing) => {
      history.push(drawingRef.current);
      drawingRef.current = next;
      setDrawing(next);
      setRevision((value) => value + 1);
    },
    [history],
  );
  const undo = useCallback(() => {
    const previous = history.undo(drawingRef.current);
    if (!previous) return;
    drawingRef.current = previous;
    setDrawing(previous);
    setSelection(new Set());
  }, [history]);
  const redo = useCallback(() => {
    const following = history.redo(drawingRef.current);
    if (!following) return;
    drawingRef.current = following;
    setDrawing(following);
    setSelection(new Set());
  }, [history]);

  // Talk: the narration's own dictation. Each phrase that settles is kept with when it did.
  const narration = useRef({ settled: "" });
  const controller = useMemo(
    () =>
      dictationApi
        ? new DictationController(dictationApi, (finished) => {
            const settled = narration.current.settled;
            const rest = finished.startsWith(settled)
              ? finished.slice(settled.length)
              : settled
                ? ""
                : finished;
            narration.current.settled = "";
            if (rest.trim()) {
              const current = drawingRef.current;
              const updated = {
                ...current,
                narration: [...current.narration, { text: rest.trim(), at: Date.now() }],
              };
              drawingRef.current = updated;
              setDrawing(updated);
            }
          })
        : null,
    [dictationApi],
  );
  useEffect(() => {
    controller?.activate();
    return () => controller?.dispose();
  }, [controller]);
  const talk = useSyncExternalStore(
    controller?.subscribe ?? IGNORE,
    controller?.getSnapshot ?? IDLE,
  );
  useEffect(() => {
    if (talk.state !== "listening" && talk.state !== "finishing") return;
    const settled = talk.text.settled;
    const previous = narration.current.settled;
    if (settled.length <= previous.length || !settled.startsWith(previous)) return;
    narration.current.settled = settled;
    const phrase = settled.slice(previous.length).trim();
    if (!phrase) return;
    const current = drawingRef.current;
    const updated = {
      ...current,
      narration: [...current.narration, { text: phrase, at: Date.now() }],
    };
    drawingRef.current = updated;
    setDrawing(updated);
  }, [talk]);
  const talking =
    talk.state === "starting" ||
    talk.state === "listening" ||
    talk.state === "finishing" ||
    talk.state === "cancelling";
  const startTalk = () => {
    if (!controller) return;
    narration.current.settled = "";
    if (drawingRef.current.narratedFrom === null) {
      const updated = { ...drawingRef.current, narratedFrom: Date.now() };
      drawingRef.current = updated;
      setDrawing(updated);
    }
    void controller.open();
  };

  const toPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = surface.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - view.x) / view.zoom,
        y: (clientY - rect.top - view.y) / view.zoom,
      };
    },
    [view],
  );
  const tolerance = 6 / view.zoom;

  const zoomTo = useCallback((zoom: number, around?: { x: number; y: number }) => {
    setView((current) => {
      const clamped = Math.min(4, Math.max(0.25, zoom));
      const rect = surface.current?.getBoundingClientRect();
      const anchor = around ?? { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
      const scale = clamped / current.zoom;
      return {
        zoom: clamped,
        x: anchor.x - (anchor.x - current.x) * scale,
        y: anchor.y - (anchor.y - current.y) * scale,
      };
    });
  }, []);
  const fit = useCallback(() => {
    const rect = surface.current?.getBoundingClientRect();
    const box = drawingRef.current.elements.length
      ? drawingRef.current.elements.map(bounds).reduce((all, own) => ({
          x: Math.min(all.x, own.x),
          y: Math.min(all.y, own.y),
          w: Math.max(all.x + all.w, own.x + own.w) - Math.min(all.x, own.x),
          h: Math.max(all.y + all.h, own.y + own.h) - Math.min(all.y, own.y),
        }))
      : null;
    if (!rect || !box) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const zoom = Math.min(
      2,
      Math.max(0.25, Math.min((rect.width - 96) / box.w, (rect.height - 96) / box.h)),
    );
    setView({
      zoom,
      x: rect.width / 2 - (box.x + box.w / 2) * zoom,
      y: rect.height / 2 - (box.y + box.h / 2) * zoom,
    });
  }, []);

  // The wheel pans, and with Ctrl zooms around the pointer; the page itself does not scroll.
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = node.getBoundingClientRect();
        setView((current) => {
          const zoom = Math.min(
            4,
            Math.max(0.25, current.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)),
          );
          const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          const scale = zoom / current.zoom;
          return {
            zoom,
            x: anchor.x - (anchor.x - current.x) * scale,
            y: anchor.y - (anchor.y - current.y) * scale,
          };
        });
      } else
        setView((current) => ({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        }));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);

  const setGestureBoth = (value: Gesture | null) => {
    gestureRef.current = value;
    setGesture(value);
  };

  const commitText = useCallback(
    (edit: TextEdit | null) => {
      if (!edit || editingRef.current !== edit) return;
      setEditing(null);
      const text = edit.value.replace(/\s+$/, "");
      const current = drawingRef.current;
      if (edit.id) {
        const existing = current.elements.find((element) => element.id === edit.id);
        if (existing?.kind !== "text") return;
        if (!text) commit(removeElements(current, new Set([edit.id])));
        else if (text !== existing.text) commit(replaceElement(current, { ...existing, text }));
        return;
      }
      if (!text) return;
      commit(
        addElement(current, {
          id: newId(),
          kind: "text",
          ink: edit.ink,
          width: edit.width,
          at: Date.now(),
          x: edit.at.x,
          y: edit.at.y,
          text,
        }),
      );
    },
    [commit, setEditing],
  );

  useLayoutEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);

  const down = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (editing) {
      commitText(editing);
      return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    // The canvas places focus itself: the mousedown after this would move it to the frame, away
    // from a text box this press opens.
    event.preventDefault();
    host.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPoint(event.clientX, event.clientY);
    if (event.button === 1 || space) {
      setGestureBoth({ kind: "pan", from: { x: event.clientX, y: event.clientY }, view });
      return;
    }
    const at = Date.now();
    const pressure = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5;
    switch (tool) {
      case "pen":
      case "highlighter":
        setGestureBoth({
          kind: "draw",
          pressures: [pressure],
          element: {
            id: newId(),
            kind: "stroke",
            ink,
            width,
            at,
            points: [point],
            highlighter: tool === "highlighter",
            pressure,
          },
        });
        return;
      case "rect":
      case "ellipse":
        setGestureBoth({
          kind: "draw",
          pressures: [],
          element: { id: newId(), kind: tool, ink, width, at, x: point.x, y: point.y, w: 0, h: 0 },
        });
        return;
      case "arrow":
        setGestureBoth({
          kind: "draw",
          pressures: [],
          element: {
            id: newId(),
            kind: "arrow",
            ink,
            width,
            at,
            from: point,
            to: point,
            start: shapeAt(drawingRef.current, point, tolerance)?.id ?? null,
            end: null,
          },
        });
        return;
      case "text": {
        const existing = elementAt(drawingRef.current, point, tolerance);
        if (existing?.kind === "text")
          setEditing({
            id: existing.id,
            at: { x: existing.x, y: existing.y },
            value: existing.text,
            ink: existing.ink,
            width: existing.width,
          });
        else setEditing({ id: null, at: point, value: "", ink, width });
        return;
      }
      case "eraser": {
        const before = drawingRef.current;
        const hit = elementAt(before, point, tolerance);
        const removed = new Set<string>(hit ? [hit.id] : []);
        if (hit) setDrawing(removeElements(before, removed));
        setGestureBoth({ kind: "erase", before, removed });
        return;
      }
      case "select": {
        const hit = elementAt(drawingRef.current, point, tolerance);
        if (!hit) {
          if (!event.shiftKey) setSelection(new Set());
          setGestureBoth({ kind: "marquee", from: point, to: point });
          return;
        }
        const chosen = new Set(selection);
        if (event.shiftKey) {
          if (chosen.has(hit.id)) chosen.delete(hit.id);
          else chosen.add(hit.id);
        } else if (!chosen.has(hit.id)) {
          chosen.clear();
          chosen.add(hit.id);
        }
        setSelection(chosen);
        setGestureBoth({
          kind: "move",
          from: point,
          moved: { x: 0, y: 0 },
          before: drawingRef.current,
          ids: withLabels(drawingRef.current, chosen),
        });
        return;
      }
    }
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = gestureRef.current;
    if (!current) return;
    if (current.kind === "pan") {
      setView({
        ...current.view,
        x: current.view.x + event.clientX - current.from.x,
        y: current.view.y + event.clientY - current.from.y,
      });
      return;
    }
    const point = toPoint(event.clientX, event.clientY);
    switch (current.kind) {
      case "draw": {
        const element = current.element;
        if (element.kind === "stroke") {
          const pressure = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5;
          const pressures = [...current.pressures, pressure];
          setGestureBoth({
            ...current,
            pressures,
            element: {
              ...element,
              points: [...element.points, point],
              pressure: pressures.reduce((sum, value) => sum + value, 0) / pressures.length,
            },
          });
        } else if (element.kind === "rect" || element.kind === "ellipse") {
          let w = point.x - element.x;
          let h = point.y - element.y;
          if (event.shiftKey) {
            const side = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * side;
            h = Math.sign(h || 1) * side;
          }
          setGestureBoth({ ...current, element: { ...element, w, h } });
        } else if (element.kind === "arrow") {
          let to = point;
          if (event.shiftKey) {
            // Straight lines snap to 45 degrees.
            const angle =
              Math.round(
                Math.atan2(point.y - element.from.y, point.x - element.from.x) / (Math.PI / 4),
              ) *
              (Math.PI / 4);
            const length = Math.hypot(point.x - element.from.x, point.y - element.from.y);
            to = {
              x: element.from.x + Math.cos(angle) * length,
              y: element.from.y + Math.sin(angle) * length,
            };
          }
          setGestureBoth({ ...current, element: { ...element, to } });
        }
        return;
      }
      case "move": {
        const dx = point.x - current.from.x;
        const dy = point.y - current.from.y;
        setDrawing(moveElements(current.before, current.ids, dx, dy));
        gestureRef.current = { ...current, moved: { x: dx, y: dy } };
        return;
      }
      case "marquee":
        setGestureBoth({ ...current, to: point });
        return;
      case "erase": {
        const hit = elementAt(drawingRef.current, point, tolerance);
        if (!hit) return;
        current.removed.add(hit.id);
        const updated = removeElements(drawingRef.current, new Set([hit.id]));
        drawingRef.current = updated;
        setDrawing(updated);
        return;
      }
    }
  };

  const up = () => {
    const current = gestureRef.current;
    setGestureBoth(null);
    if (!current) return;
    switch (current.kind) {
      case "draw": {
        let element = current.element;
        if (element.kind === "stroke")
          element = { ...element, points: simplify(element.points, 1.5 / view.zoom) };
        if (
          (element.kind === "rect" || element.kind === "ellipse") &&
          Math.abs(element.w) < 3 &&
          Math.abs(element.h) < 3
        )
          return;
        if (element.kind === "arrow") {
          if (Math.hypot(element.to.x - element.from.x, element.to.y - element.from.y) < 4) return;
          const end = shapeAt(drawingRef.current, element.to, tolerance)?.id ?? null;
          element = { ...element, end: end === element.start ? null : end };
        }
        if (element.kind === "rect" || element.kind === "ellipse")
          element = { ...element, ...normalized(element) };
        commit(addElement(drawingRef.current, element));
        return;
      }
      case "move":
        if (current.moved.x === 0 && current.moved.y === 0) {
          setDrawing(current.before);
          return;
        }
        history.push(current.before);
        drawingRef.current = moveElements(
          current.before,
          current.ids,
          current.moved.x,
          current.moved.y,
        );
        setDrawing(drawingRef.current);
        setRevision((value) => value + 1);
        return;
      case "marquee": {
        const area = {
          x: current.from.x,
          y: current.from.y,
          w: current.to.x - current.from.x,
          h: current.to.y - current.from.y,
        };
        if (Math.abs(area.w) > 2 || Math.abs(area.h) > 2)
          setSelection(new Set(within(drawingRef.current, area)));
        return;
      }
      case "erase":
        if (current.removed.size) {
          history.push(current.before);
          setRevision((value) => value + 1);
        }
        return;
      case "pan":
        return;
    }
  };

  const removeSelection = useCallback(() => {
    if (!selection.size) return;
    commit(removeElements(drawingRef.current, withLabels(drawingRef.current, selection)));
    setSelection(new Set());
  }, [commit, selection]);

  const clear = () => {
    if (!drawingRef.current.elements.length && !drawingRef.current.narration.length) return;
    commit(EMPTY);
    setSelection(new Set());
    setNote("Cleared. Undo brings the drawing back.");
  };

  const add = async () => {
    const composer = bridge.composer;
    const current = drawingRef.current;
    if (!composer) {
      setNote("The message box is not ready yet. Try again in a moment.");
      return;
    }
    if (!current.elements.length && !current.narration.length) {
      setNote("Draw something first.");
      return;
    }
    setAdding(true);
    try {
      let image: string | null = null;
      let why: string | null = null;
      if (images === false)
        why = "This agent cannot see images, so the outline went in without the drawing.";
      else if (composer.full() && !added.current.image)
        why = "The message already has eight attachments, so only the outline went in.";
      else if (current.elements.length && host.current) {
        const bytes = await renderPng(current, paletteOf(host.current));
        if (bytes) image = await composer.addImage(bytes, added.current.image);
        if (!image) why = "The drawing could not be attached, so only the outline went in.";
      }
      const text = messageText(current, image !== null);
      composer.putText(text, added.current.text);
      added.current = { image, text: text || null };
      setNote(why ?? "Added to your message. Edit it there before you send.");
    } catch (error) {
      setNote(errorMessage(error));
    } finally {
      setAdding(false);
    }
  };

  const keys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input, [contenteditable]") || event.altKey) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (modifier && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (modifier) return;
    if (event.key === " " && !space && target === host.current) {
      event.preventDefault();
      setSpace(true);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selection.size) {
      event.preventDefault();
      removeSelection();
      return;
    }
    if (event.key === "Escape" && (selection.size || gestureRef.current)) {
      event.preventDefault();
      event.stopPropagation();
      setSelection(new Set());
      return;
    }
    const nudge = (
      { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<
        string,
        [number, number]
      >
    )[event.key];
    if (nudge && selection.size && target === host.current) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const ids = withLabels(drawingRef.current, selection);
      commit(moveElements(drawingRef.current, ids, nudge[0] * step, nudge[1] * step));
      return;
    }
    if (target.closest(".canvas-toolbar")) return;
    const chosen = TOOLS.find((item) => item.key.toLowerCase() === key);
    if (chosen) {
      event.preventDefault();
      setTool(chosen.id);
    }
  };

  const transform = `translate(${view.x} ${view.y}) scale(${view.zoom})`;
  const live = gesture?.kind === "draw" ? gesture.element : null;
  const marquee =
    gesture?.kind === "marquee"
      ? normalized({
          x: gesture.from.x,
          y: gesture.from.y,
          w: gesture.to.x - gesture.from.x,
          h: gesture.to.y - gesture.from.y,
        })
      : null;
  const selected = drawing.elements.filter((element) => selection.has(element.id));
  const lines = outline(drawing);
  const narrated = drawing.narration.length > 0;
  const numbers = markers(drawing);
  const empty = !drawing.elements.length && !narrated;
  const words =
    talk.state === "listening" || talk.state === "finishing"
      ? `${talk.text.settled}${talk.text.stable}${talk.text.tentative}`.trim()
      : "";

  return (
    <section className="canvas-pane" aria-label="Canvas">
      <div
        ref={host}
        className="canvas-frame"
        role="application"
        aria-label="Canvas drawing: V, P, H, R, O, A, T and E choose tools; Space pans; Delete removes the selection"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the drawing takes the canvas's keys (role application)
        tabIndex={0}
        onKeyDown={keys}
        onKeyUp={(event) => {
          if (event.key === " ") setSpace(false);
        }}
        onBlur={() => setSpace(false)}
        data-tool={tool}
        data-panning={space || gesture?.kind === "pan" ? "" : undefined}
      >
        <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
          <fieldset className="g-segmented g-segmented-quiet canvas-group" aria-label="Tool">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="g-segment canvas-tool"
                aria-pressed={tool === item.id}
                aria-label={item.label}
                aria-keyshortcuts={item.key}
                title={`${item.label} (${item.key})`}
                onClick={() => setTool(item.id)}
              >
                {item.icon}
              </button>
            ))}
          </fieldset>
          <fieldset className="canvas-group canvas-inks" aria-label="Colour">
            {INKS.map((name) => (
              <button
                key={name}
                type="button"
                className="canvas-swatch"
                aria-pressed={ink === name}
                aria-label={INK_NAMES[name]}
                title={INK_NAMES[name]}
                style={{ "--canvas-swatch": `var(${INK_TOKENS[name]})` } as CSSProperties}
                onClick={() => setInk(name)}
              />
            ))}
          </fieldset>
          <fieldset className="g-segmented g-segmented-quiet canvas-group" aria-label="Line width">
            {WIDTHS.map((value) => (
              <button
                key={value}
                type="button"
                className="g-segment canvas-tool"
                aria-pressed={width === value}
                aria-label={WIDTH_NAMES[value]}
                title={WIDTH_NAMES[value]}
                onClick={() => setWidth(value)}
              >
                <span className="canvas-width" data-width={value} aria-hidden="true" />
              </button>
            ))}
          </fieldset>
          <fieldset className="canvas-group" aria-label="History">
            <button
              type="button"
              className="g-button g-button-ghost g-button-icon g-button-28"
              aria-label="Undo"
              aria-keyshortcuts="Control+Z"
              title="Undo (Ctrl+Z)"
              disabled={!history.canUndo}
              onClick={undo}
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              className="g-button g-button-ghost g-button-icon g-button-28"
              aria-label="Redo"
              aria-keyshortcuts="Control+Shift+Z Control+Y"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!history.canRedo}
              onClick={redo}
            >
              <Redo2 size={16} />
            </button>
            <button
              type="button"
              className="g-button g-button-ghost g-button-icon g-button-28"
              aria-label="Clear the canvas"
              title="Clear the canvas"
              disabled={empty}
              onClick={clear}
            >
              <BrushCleaning size={16} />
            </button>
          </fieldset>
          <fieldset className="canvas-group" aria-label="Zoom">
            <button
              type="button"
              className="g-button g-button-ghost g-button-icon g-button-28"
              aria-label="Zoom out"
              title="Zoom out (Ctrl+wheel)"
              disabled={view.zoom <= MIN_ZOOM}
              onClick={() =>
                zoomTo([...ZOOMS].reverse().find((zoom) => zoom < view.zoom - 0.01) ?? MIN_ZOOM)
              }
            >
              <ZoomOut size={16} />
            </button>
            <span className="canvas-zoom" aria-live="polite">
              {Math.round(view.zoom * 100)}%
            </span>
            <button
              type="button"
              className="g-button g-button-ghost g-button-icon g-button-28"
              aria-label="Zoom in"
              title="Zoom in (Ctrl+wheel)"
              disabled={view.zoom >= MAX_ZOOM}
              onClick={() => zoomTo(ZOOMS.find((zoom) => zoom > view.zoom + 0.01) ?? MAX_ZOOM)}
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              className="g-button g-button-ghost g-button-icon g-button-28"
              aria-label="Fit the drawing"
              title="Fit the drawing"
              onClick={fit}
            >
              <Maximize size={16} />
            </button>
          </fieldset>
          <div className="canvas-end">
            {controller ? (
              <button
                type="button"
                className="g-button g-button-ghost g-button-28 canvas-talk-button"
                aria-pressed={talking}
                title="Talk while you draw: what you say is numbered by what you draw while saying it"
                disabled={talking}
                onClick={startTalk}
              >
                <Mic size={16} />
                Talk
              </button>
            ) : null}
            <button
              type="button"
              className="g-button g-button-primary g-button-28 canvas-add"
              disabled={adding || empty || talking}
              title={
                empty
                  ? "Draw something first"
                  : "Add the drawing, its outline and what you said to your message"
              }
              onClick={() => void add()}
            >
              <ImagePlus size={16} />
              Add to message
            </button>
            <button
              type="button"
              className="g-button g-button-ghost g-button-icon g-button-28"
              aria-label="Close the canvas"
              title="Close the canvas (the drawing stays)"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <svg
          ref={surface}
          className="canvas-surface"
          role="img"
          aria-label={`Drawing: ${summary(drawing)}`}
          aria-describedby={outlineId}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onDoubleClick={(event) => {
            if (tool !== "select") return;
            const hit = elementAt(
              drawingRef.current,
              toPoint(event.clientX, event.clientY),
              tolerance,
            );
            if (hit?.kind === "text")
              setEditing({
                id: hit.id,
                at: { x: hit.x, y: hit.y },
                value: hit.text,
                ink: hit.ink,
                width: hit.width,
              });
          }}
        >
          <g transform={transform}>
            {drawing.elements.map((element) =>
              editing?.id === element.id ? null : (
                <Shape key={element.id} element={element} selected={selection.has(element.id)} />
              ),
            )}
            {live ? <Shape element={live} selected={false} /> : null}
            {selected.map((element) => {
              const box = bounds(element);
              const pad = 4 / view.zoom;
              return (
                <rect
                  key={`selected-${element.id}`}
                  className="canvas-selection"
                  x={box.x - pad}
                  y={box.y - pad}
                  width={box.w + pad * 2}
                  height={box.h + pad * 2}
                  rx={4 / view.zoom}
                  strokeWidth={1.5 / view.zoom}
                />
              );
            })}
            {marquee ? (
              <rect
                className="canvas-marquee"
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                strokeWidth={1 / view.zoom}
              />
            ) : null}
            {numbers.map((marker) => (
              <g
                key={`marker-${marker.number}`}
                className="canvas-marker"
                transform={`translate(${marker.at.x - 11} ${marker.at.y - 11})`}
              >
                <circle r={11} />
                <text textAnchor="middle" dominantBaseline="central">
                  {marker.number}
                </text>
              </g>
            ))}
          </g>
        </svg>
        {editing ? (
          <textarea
            ref={editor}
            className="canvas-editor"
            aria-label="Text on the canvas"
            value={editing.value}
            rows={Math.max(1, editing.value.split("\n").length)}
            style={
              {
                left: view.x + editing.at.x * view.zoom,
                top: view.y + editing.at.y * view.zoom,
                "--canvas-editor-size": `${TEXT_SIZE[editing.width] * view.zoom}px`,
                "--canvas-swatch": `var(${INK_TOKENS[editing.ink]})`,
              } as CSSProperties
            }
            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitText(editing);
                host.current?.focus({ preventScroll: true });
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setEditing(null);
                host.current?.focus({ preventScroll: true });
              }
            }}
            onBlur={() => commitText(editing)}
          />
        ) : null}
        {empty && !editing ? (
          <p className="canvas-empty" aria-hidden="true">
            Draw a flow, sketch an idea, or press Talk and say it while you draw.
          </p>
        ) : null}
      </div>
      {talking || narrated || talk.state === "failed" ? (
        <fieldset className="canvas-narration" aria-label="What you said">
          {talking ? (
            <>
              <p className="canvas-words" aria-live="polite">
                {words || (talk.state === "starting" ? "Opening the microphone" : "Listening")}
              </p>
              <button
                type="button"
                className="g-button g-button-ghost g-button-28"
                onClick={() => void controller?.cancel()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="g-button g-button-primary g-button-28"
                disabled={talk.state !== "listening"}
                onClick={() => void controller?.stop()}
              >
                Finish
              </button>
            </>
          ) : talk.state === "failed" ? (
            <>
              <p className="canvas-words ui-error" role="alert">
                {talk.message}
              </p>
              <button
                type="button"
                className="g-button g-button-ghost g-button-28"
                onClick={() => controller?.dismiss()}
              >
                Dismiss
              </button>
            </>
          ) : (
            <>
              <ol className="canvas-phrases">
                {drawing.narration.map((phrase, index) => (
                  <li key={`${phrase.at}-${phrase.text}`}>
                    <span className="canvas-phrase-number">{index + 1}</span>
                    {phrase.text}
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="g-button g-button-ghost g-button-28"
                onClick={() => commit({ ...drawingRef.current, narration: [], narratedFrom: null })}
              >
                Clear what you said
              </button>
            </>
          )}
        </fieldset>
      ) : null}
      {note ? (
        <p className="canvas-note" role="status">
          {note}
        </p>
      ) : null}
      <div id={outlineId} className="canvas-outline" hidden>
        {lines.length ? lines.join(". ") : "Nothing drawn yet."}
      </div>
    </section>
  );
}
