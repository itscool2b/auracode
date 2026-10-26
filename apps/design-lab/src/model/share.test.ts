import { describe, expect, it } from "vitest";
import { shareStructure } from "./share";

describe("shareStructure", () => {
  it("returns the previous object when nothing changed", () => {
    const previous = { a: [1, { b: "x" }], c: null };
    const next = { a: [1, { b: "x" }], c: null };
    expect(shareStructure(previous, next)).toBe(previous);
  });

  it("reuses unchanged branches and rebuilds changed ones", () => {
    const previous = {
      items: [
        { id: 1, text: "done" },
        { id: 2, text: "stre" },
      ],
      meta: { n: 1 },
    };
    const next = {
      items: [
        { id: 1, text: "done" },
        { id: 2, text: "stream" },
      ],
      meta: { n: 1 },
    };
    const shared = shareStructure(previous, next);
    expect(shared).toEqual(next);
    expect(shared).not.toBe(previous);
    expect(shared.items[0]).toBe(previous.items[0]);
    expect(shared.items[1]).not.toBe(previous.items[1]);
    expect(shared.meta).toBe(previous.meta);
  });

  it("treats a grown array as changed but keeps its old elements", () => {
    const previous = { items: [{ id: 1 }] };
    const next = { items: [{ id: 1 }, { id: 2 }] };
    const shared = shareStructure(previous, next);
    expect(shared.items).not.toBe(previous.items);
    expect(shared.items[0]).toBe(previous.items[0]);
  });

  it("notices added and removed keys", () => {
    const previous: Record<string, unknown> = { a: 1 };
    expect(shareStructure(previous, { a: 1, b: undefined })).not.toBe(previous);
    expect(shareStructure({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
  });

  it("walks only plain data", () => {
    class Box {
      constructor(readonly value: number) {}
    }
    const previous = { box: new Box(1) };
    const next = { box: new Box(1) };
    expect(shareStructure(previous, next).box).toBe(next.box);
    expect(shareStructure(undefined, next)).toBe(next);
  });
});
