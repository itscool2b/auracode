import { describe, expect, it } from "vitest";
import type { RenderedItem, RenderedSegment, TurnEnd } from "./transcript";
import { changedFiles, workedLabel, workFold } from "./workFold";

const user = (key: string): RenderedItem => ({ kind: "user", key, text: "Fix the sidebar" });
const message = (key: string, text = "Done."): RenderedItem => ({
  kind: "message",
  key,
  text,
  completed: true,
});
const tool = (
  key: string,
  toolKind: "read" | "edit" | "delete" | "move" | "execute" = "read",
  path = "src/App.tsx",
  display: "completed" | "failed" = "completed",
): RenderedItem =>
  ({
    kind: "tool",
    key,
    id: key,
    toolKind,
    title: `${toolKind} ${path}`,
    status: display,
    locations: [{ path, line: null }],
    rawInput: null,
    toolName: null,
    content: [],
    truncated: null,
    display,
  }) as RenderedItem;
const ended: TurnEnd = {
  stopReason: "end_turn",
  usage: null,
  durationMs: 102_000,
  recovered: false,
};
const segment = (items: readonly RenderedItem[], end: TurnEnd | null = ended): RenderedSegment => ({
  key: "turn:1",
  turnId: "1",
  partial: false,
  items,
  plan: null,
  usage: null,
  end,
});

describe("the Worked for fold", () => {
  it("folds a finished turn's work before its final answer", () => {
    const turn = segment([
      user("u"),
      message("m1", "Let me look at the sidebar first."),
      tool("t1"),
      tool("t2", "edit"),
      message("m2", "Okay, now the styles."),
      tool("t3", "edit", "src/chat.css"),
      message("answer", "The sidebar scans better now."),
    ]);
    expect(workFold(turn)).toEqual({ from: 1, to: 6, steps: 3 });
  });

  it("keeps the whole answer when it arrives as several messages", () => {
    const turn = segment([
      user("u"),
      tool("t"),
      message("a1", "First part."),
      message("a2", "More."),
    ]);
    expect(workFold(turn)).toEqual({ from: 1, to: 2, steps: 1 });
  });

  it("does not fold a turn that is only an answer, or only messages", () => {
    expect(workFold(segment([user("u"), message("a")]))).toBeNull();
    expect(workFold(segment([user("u"), message("a"), message("b")]))).toBeNull();
  });

  it("does not fold a turn that ended on work, ended otherwise, or still runs", () => {
    expect(workFold(segment([user("u"), message("m"), tool("t")]))).toBeNull();
    expect(
      workFold(
        segment([user("u"), tool("t"), message("a")], { ...ended, stopReason: "cancelled" }),
      ),
    ).toBeNull();
    expect(workFold(segment([user("u"), tool("t"), message("a")], null))).toBeNull();
    expect(workFold({ ...segment([tool("t"), message("a")]), turnId: null })).toBeNull();
  });

  it("folds what loaded of a turn too long for one history page, without a step count", () => {
    // Cut inside its work: the prompt and earlier steps did not load.
    const cut = (items: readonly RenderedItem[], end: TurnEnd | null = ended) => ({
      ...segment(items, end),
      partial: true,
    });
    expect(
      workFold(cut([tool("t1"), message("m", "Now the tests."), tool("t2"), message("a")])),
    ).toEqual({ from: 0, to: 3, steps: null });
    // A message of the person's in the loaded part is a steer, so the work stays in view.
    expect(workFold(cut([user("steer"), tool("t"), message("a")]))).toBeNull();
    // The cut fell inside the answer, or the turn ended otherwise: nothing to fold.
    expect(workFold(cut([message("a1"), message("a2")]))).toBeNull();
    expect(
      workFold(cut([tool("t"), message("a")], { ...ended, stopReason: "cancelled" })),
    ).toBeNull();
  });

  it("keeps errors, waiting requests and the person's own steers in view", () => {
    const error = {
      kind: "error",
      key: "e",
      errorKind: "agent",
      message: "Tool failed",
      detail: null,
      recoverable: true,
    } as unknown as RenderedItem;
    expect(workFold(segment([user("u"), tool("t"), error, message("a")]))).toBeNull();
    const waiting = {
      kind: "permission",
      key: "p",
      request: { request_id: "r" },
      resolution: null,
    } as unknown as RenderedItem;
    expect(workFold(segment([user("u"), tool("t"), waiting, message("a")]))).toBeNull();
    expect(workFold(segment([user("u"), tool("t"), user("steer"), message("a")]))).toBeNull();
    const answered = { ...waiting, resolution: { decision: { type: "cancelled" }, by: "user" } };
    expect(workFold(segment([user("u"), answered as RenderedItem, message("a")]))).toEqual({
      from: 1,
      to: 2,
      steps: 1,
    });
  });

  it("does not fold onto an empty answer", () => {
    expect(workFold(segment([user("u"), tool("t"), message("a", "  ")]))).toBeNull();
  });

  it("lists the files the turn changed, once each, without failed calls or reads", () => {
    const turn = segment([
      user("u"),
      tool("r", "read", "README.md"),
      tool("e1", "edit", "src/App.tsx"),
      tool("e2", "edit", "src/chat.css"),
      tool("e3", "edit", "src/App.tsx"),
      tool("x", "edit", "src/broken.ts", "failed"),
      tool("d", "delete", "old.txt"),
      message("a"),
    ]);
    expect(changedFiles(turn)).toEqual(["src/App.tsx", "src/chat.css", "old.txt"]);
  });

  it("says how long the work took and how many steps it was", () => {
    const format = (ms: number) => `${ms / 1000} s`;
    expect(workedLabel(12, 102_000, format)).toBe("Worked for 102 s · 12 steps");
    expect(workedLabel(1, null, format)).toBe("Worked · 1 step");
    // Only part of the turn loaded: its time, which the turn's end records whole, and no count.
    expect(workedLabel(null, 7_240_000, format)).toBe("Worked for 7240 s");
    expect(workedLabel(null, null, format)).toBe("Worked");
  });
});
