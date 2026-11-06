import { describe, expect, it } from "vitest";
import type { ChatSummary } from "../bindings";
import {
  boardOf,
  boardSummary,
  FINISHED_WINDOW_MS,
  laneOf,
  SETTLE_MS,
  stateLine,
} from "./dashboard";

const NOW = 1_800_000_000_000;

const chat = (id: string, extra: Partial<ChatSummary> = {}): ChatSummary => ({
  id,
  title: id,
  agent_id: "claude",
  agent_name: "Claude Code",
  folder: "C:\\work\\auracode",
  folder_state: "ok",
  status: "ready",
  needs_attention: false,
  created_at: NOW - 60_000,
  updated_at: NOW - 60_000,
  ...extra,
});

describe("the Dashboard's lanes", () => {
  it("puts a chat that waits on you under Needs you, even while its agent runs", () => {
    expect(laneOf(chat("a", { status: "running", needs_attention: true }), NOW)).toBe("attention");
  });

  it("puts failed starts, sign-ins and lost folders under Needs you", () => {
    expect(laneOf(chat("a", { status: "failed" }), NOW)).toBe("attention");
    expect(laneOf(chat("b", { status: "auth_required" }), NOW)).toBe("attention");
    expect(laneOf(chat("c", { folder_state: "missing" }), NOW)).toBe("attention");
  });

  it("puts running, starting and stopping agents under Working", () => {
    for (const status of ["running", "starting", "cancelling", "stopping"] as const)
      expect(laneOf(chat(status, { status }), NOW)).toBe("working");
  });

  it("keeps a quiet chat under Finished for a day after its last activity", () => {
    expect(laneOf(chat("a", { updated_at: NOW - FINISHED_WINDOW_MS }), NOW)).toBe("finished");
    expect(laneOf(chat("b", { status: "stopped", updated_at: NOW - 5_000 }), NOW)).toBe("finished");
    expect(laneOf(chat("c", { updated_at: NOW - FINISHED_WINDOW_MS - 1 }), NOW)).toBeNull();
  });

  it("orders each lane by latest activity and leaves old chats off the board", () => {
    const board = boardOf(
      [
        chat("older", { updated_at: NOW - 3 * 60_000 }),
        chat("newer", { updated_at: NOW - 60_000 }),
        chat("ancient", { updated_at: NOW - 3 * FINISHED_WINDOW_MS }),
        chat("busy", { status: "running" }),
      ],
      NOW,
    );
    expect(board.finished.map((c) => c.id)).toEqual(["newer", "older"]);
    expect(board.working.map((c) => c.id)).toEqual(["busy"]);
    expect(board.attention).toEqual([]);
  });

  it("keeps a lane's order while its agents work, and puts a chat that changes lane first", () => {
    const arrivals = new Map();
    const a = chat("a", { status: "running", updated_at: NOW - 3_000 });
    const b = chat("b", { status: "running", updated_at: NOW - 2_000 });
    expect(boardOf([a, b], NOW, undefined, arrivals).working.map((c) => c.id)).toEqual(["b", "a"]);
    // Streaming touches "a" again and again: it keeps its place.
    const touched = { ...a, updated_at: NOW + 500 };
    expect(boardOf([touched, b], NOW + 500, undefined, arrivals).working.map((c) => c.id)).toEqual([
      "b",
      "a",
    ]);
    // "b" finishes: once that settles it arrives at the top of Finished, above an earlier one.
    const earlier = chat("earlier", { updated_at: NOW - 1_000 });
    const finishedB = { ...b, status: "ready" as const, updated_at: NOW + 900 };
    const settling = boardOf([touched, finishedB, earlier], NOW + 1_000, undefined, arrivals);
    expect(settling.working.map((c) => c.id)).toEqual(["b", "a"]);
    const done = boardOf(
      [touched, finishedB, earlier],
      NOW + 1_000 + SETTLE_MS,
      undefined,
      arrivals,
    );
    expect(done.finished.map((c) => c.id)).toEqual(["b", "earlier"]);
    expect(done.working.map((c) => c.id)).toEqual(["a"]);
    // A chat no longer on the board is forgotten.
    boardOf([touched], NOW + 5_000, undefined, arrivals);
    expect([...arrivals.keys()]).toEqual(["a"]);
  });

  it("keeps a card in Working while its agent passes through ready between two turns", () => {
    const arrivals = new Map();
    const a = chat("a", { status: "starting" });
    expect(boardOf([a], NOW, undefined, arrivals).working).toHaveLength(1);
    // Ready for a moment, then the queued prompt runs: the card never leaves Working.
    for (const [status, at] of [
      ["ready", NOW + 200],
      ["running", NOW + 400],
      ["ready", NOW + 3_000],
      ["running", NOW + 3_300],
    ] as const) {
      const board = boardOf([{ ...a, status }], at, undefined, arrivals);
      expect(
        board.working.map((c) => c.id),
        `${status} at ${at - NOW}`,
      ).toEqual(["a"]);
      expect(board.finished).toEqual([]);
    }
    // Needs you never waits.
    const asked = boardOf([{ ...a, needs_attention: true }], NOW + 3_400, undefined, arrivals);
    expect(asked.attention.map((c) => c.id)).toEqual(["a"]);
  });

  it("says why a card needs you, in sentence case", () => {
    expect(stateLine(chat("a", { needs_attention: true }))).toBe("Waiting for your answer");
    expect(stateLine(chat("b", { folder_state: "missing" }))).toBe("Folder missing");
    expect(stateLine(chat("c", { status: "auth_required" }))).toBe("Needs you to sign in");
    expect(stateLine(chat("d", { status: "ready" }))).toBe("Finished its turn");
  });

  it("puts a chat working in its terminal under Working, though its session shows as stopped", () => {
    const inTerminal = (id: string) => (id === "t" ? ("working" as const) : null);
    const terminal = chat("t", { status: "stopped", updated_at: NOW - 3 * FINISHED_WINDOW_MS });
    expect(laneOf(terminal, NOW, inTerminal)).toBe("working");
    expect(stateLine(terminal, inTerminal)).toBe("Working in the terminal");
    // Needing an answer still comes first.
    expect(laneOf(chat("t", { needs_attention: true }), NOW, inTerminal)).toBe("attention");
  });

  it("does not call a terminal whose agent waits at its prompt working", () => {
    const inTerminal = (id: string) => (id === "t" ? ("open" as const) : null);
    // Open for days without a word: still on the board, under Finished, saying where it is.
    const terminal = chat("t", { status: "stopped", updated_at: NOW - 3 * FINISHED_WINDOW_MS });
    expect(laneOf(terminal, NOW, inTerminal)).toBe("finished");
    expect(stateLine(terminal, inTerminal)).toBe("Open in the terminal");
    const board = boardOf([terminal], NOW, inTerminal);
    expect(boardSummary(board)).toBe("1 finished in the last day.");
    // Gone quiet a moment ago, its card still shown under Working says so too, without flicker.
    expect(stateLine(terminal, inTerminal, "working")).toBe("Working in the terminal");
  });

  it("sums the board up in one line", () => {
    const board = boardOf(
      [chat("a", { needs_attention: true }), chat("b", { status: "running" }), chat("c")],
      NOW,
    );
    expect(boardSummary(board)).toBe("1 needs you, 1 working, 1 finished in the last day.");
    expect(boardSummary(boardOf([], NOW))).toMatch(/^Nothing is running/);
  });
});
