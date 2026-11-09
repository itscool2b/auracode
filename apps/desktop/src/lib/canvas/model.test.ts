import { describe, expect, it } from "vitest";
import { exportArea, exportScale, MAX_EXPORT } from "./export";
import {
  addElement,
  type Drawing,
  EMPTY,
  type Element,
  elementAt,
  History,
  loadDrawing,
  MAX_SAVED,
  markers,
  messageText,
  moveElements,
  narrate,
  outline,
  removeElements,
  saveDrawing,
  shapeAt,
  simplify,
  strokePath,
  summary,
  within,
} from "./model";

const box = (id: string, x: number, y: number, at = 0): Element => ({
  id,
  kind: "rect",
  ink: "ink",
  width: 2,
  at,
  x,
  y,
  w: 100,
  h: 50,
});
const label = (id: string, x: number, y: number, text: string, at = 0): Element => ({
  id,
  kind: "text",
  ink: "ink",
  width: 1,
  at,
  x,
  y,
  text,
});
const arrow = (id: string, start: string | null, end: string | null, at = 0): Element => ({
  id,
  kind: "arrow",
  ink: "blue",
  width: 2,
  at,
  from: { x: 100, y: 25 },
  to: { x: 200, y: 25 },
  start,
  end,
});
const stroke = (id: string, at = 0): Element => ({
  id,
  kind: "stroke",
  ink: "red",
  width: 1,
  at,
  points: [
    { x: 0, y: 200 },
    { x: 50, y: 210 },
    { x: 100, y: 200 },
  ],
  highlighter: false,
  pressure: 0.5,
});
const drawing = (...elements: Element[]): Drawing => ({ ...EMPTY, elements });

describe("a canvas drawing", () => {
  it("is read as labelled shapes, the arrows between them, free text and strokes", () => {
    const flow = drawing(
      box("a", 0, 0),
      label("la", 10, 15, "API gateway"),
      box("b", 200, 0),
      label("lb", 210, 15, "Queue"),
      arrow("ab", "a", "b"),
      label("note", 0, 120, "retry three times"),
      box("c", 0, 300),
      stroke("s"),
    );
    expect(outline(flow)).toEqual([
      'box "API gateway"',
      'box "Queue"',
      "box 3",
      'arrow from "API gateway" to "Queue"',
      'text "retry three times"',
      "1 freehand stroke",
    ]);
    expect(summary(flow)).toBe("3 shapes, 1 arrow, 3 texts, 1 stroke");
    expect(summary(EMPTY)).toBe("Empty");
  });

  it("finds an arrow's ends by the shapes under them when they were not attached", () => {
    const loose = drawing(box("a", 0, 0), box("b", 200, 0), arrow("ab", null, null));
    expect(outline(loose)).toContain("arrow from box 1 to box 2");
    expect(outline(drawing(arrow("x", null, null)))).toEqual(["arrow"]);
  });

  it("moves attached arrow ends with their shapes and lets go of removed ones", () => {
    const flow = drawing(box("a", 0, 0), box("b", 200, 0), arrow("ab", "a", "b"));
    const moved = moveElements(flow, new Set(["b"]), 50, 10);
    const line = moved.elements.find((element) => element.id === "ab");
    expect(line?.kind === "arrow" && line.from).toEqual({ x: 100, y: 25 });
    expect(line?.kind === "arrow" && line.to).toEqual({ x: 250, y: 35 });
    const removed = removeElements(flow, new Set(["b"]));
    const kept = removed.elements.find((element) => element.id === "ab");
    expect(removed.elements).toHaveLength(2);
    expect(kept?.kind === "arrow" && kept.end).toBeNull();
  });

  it("hit tests the topmost element, shapes for arrows, and marquee areas", () => {
    const flow = drawing(box("a", 0, 0), stroke("s"), label("t", 10, 10, "on top"));
    expect(elementAt(flow, { x: 12, y: 12 }, 2)?.id).toBe("t");
    expect(elementAt(flow, { x: 50, y: 211 }, 4)?.id).toBe("s");
    expect(elementAt(flow, { x: 500, y: 500 }, 4)).toBeNull();
    expect(shapeAt(flow, { x: 12, y: 12 }, 0)?.id).toBe("a");
    expect(within(flow, { x: -10, y: 150, w: 200, h: 100 })).toEqual(["s"]);
    expect(within(flow, { x: 120, y: 260, w: -150, h: -80 })).toEqual(["s"]);
  });

  it("undoes and redoes whole drawings, forgetting the undone after a new change", () => {
    const history = new History(2);
    let current = EMPTY;
    for (const id of ["a", "b", "c"]) {
      history.push(current);
      current = addElement(current, box(id, 0, 0));
    }
    expect(history.canUndo).toBe(true);
    current = history.undo(current) ?? current;
    expect(current.elements.map((element) => element.id)).toEqual(["a", "b"]);
    current = history.redo(current) ?? current;
    expect(current.elements).toHaveLength(3);
    current = history.undo(current) ?? current;
    history.push(current);
    expect(history.canRedo).toBe(false);
    // The limit keeps only the newest states to return to.
    expect(history.undo(current)?.elements).toHaveLength(2);
    expect(history.undo(current)?.elements).toHaveLength(1);
    expect(history.undo(current)).toBeNull();
  });

  it("smooths freehand points into one path and thins dense ones", () => {
    expect(strokePath([])).toBe("");
    expect(strokePath([{ x: 1, y: 1 }])).toMatch(/^M1 1L/);
    expect(
      strokePath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ]),
    ).toBe("M0 0Q10 10 15 5L20 0");
    const dense = Array.from({ length: 50 }, (_, index) => ({ x: index * 0.2, y: 0 }));
    const thin = simplify(dense, 2);
    expect(thin[0]).toEqual(dense[0]);
    expect(thin[thin.length - 1]).toEqual(dense[dense.length - 1]);
    expect(thin.length).toBeLessThan(10);
  });
});

describe("a narrated drawing", () => {
  const narrated: Drawing = {
    elements: [
      box("early", 0, 0, 5),
      box("gateway", 0, 100, 15),
      arrow("flow", "gateway", null, 25),
      box("queue", 200, 100, 26),
    ],
    narration: [
      { text: "this is the API gateway", at: 20 },
      { text: "  requests go to the queue ", at: 30 },
      { text: "and that is all", at: 40 },
    ],
    narratedFrom: 10,
  };

  it("gives each phrase the shapes drawn while it was said", () => {
    expect(narrate(narrated)).toEqual([
      { number: 1, text: "this is the API gateway", ids: ["gateway"] },
      { number: 2, text: "requests go to the queue", ids: ["flow", "queue"] },
      { number: 3, text: "and that is all", ids: [] },
    ]);
    expect(markers(narrated)).toEqual([
      { number: 1, at: { x: 0, y: 100 } },
      { number: 2, at: { x: 100, y: 25 } },
    ]);
  });

  it("puts the outline and the numbered narration in the message", () => {
    const text = messageText(narrated, true);
    expect(text).toContain("The attached canvas shows:\n- box 1\n- box 2");
    expect(text).toContain(
      "While drawing I said (the numbers match the canvas):\n1. this is the API gateway\n2. requests go to the queue\n3. and that is all",
    );
    expect(messageText(narrated, false)).toContain("not attached: this agent cannot see images");
    expect(messageText(EMPTY, true)).toBe("");
  });
});

describe("a canvas export", () => {
  it("covers what was drawn with padding, within the composer's image limit", () => {
    expect(exportArea(EMPTY)).toBeNull();
    const area = exportArea(drawing(box("a", 0, 0)));
    expect(area).toEqual({ x: -32, y: -32, w: 164, h: 114 });
    expect(exportScale({ w: 100, h: 50 })).toBe(2);
    expect(exportScale({ w: 4096, h: 100 }) * 4096).toBe(MAX_EXPORT);
  });
});

describe("a saved drawing", () => {
  const storage = () => {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
  };

  it("is kept per chat, forgotten when empty, and refused when too large", () => {
    const store = storage();
    const flow = drawing(box("a", 0, 0));
    expect(saveDrawing(store, "c1", flow)).toBeNull();
    expect(loadDrawing(store, "c1").elements).toHaveLength(1);
    expect(loadDrawing(store, "c2")).toEqual(EMPTY);
    expect(saveDrawing(store, "c1", EMPTY)).toBeNull();
    expect(store.items.size).toBe(0);
    const huge = drawing(label("t", 0, 0, "x".repeat(MAX_SAVED)));
    expect(saveDrawing(store, "c1", huge)).toMatch(/too large/);
    store.items.set("auracode.canvas.c3", "{not json");
    expect(loadDrawing(store, "c3")).toEqual(EMPTY);
  });
});
