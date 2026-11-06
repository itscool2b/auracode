import { describe, expect, it } from "vitest";
import type { ChatSummary } from "../bindings";
import { boardOf, boardSummary, FINISHED_WINDOW_MS, laneOf, stateLine } from "./dashboard";

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

  it("says why a card needs you, in sentence case", () => {
    expect(stateLine(chat("a", { needs_attention: true }))).toBe("Waiting for your answer");
    expect(stateLine(chat("b", { folder_state: "missing" }))).toBe("Folder missing");
    expect(stateLine(chat("c", { status: "auth_required" }))).toBe("Needs you to sign in");
    expect(stateLine(chat("d", { status: "ready" }))).toBe("Finished its turn");
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
