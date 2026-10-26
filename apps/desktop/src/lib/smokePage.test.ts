import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeSegment,
  firstDifference,
  itemSignature,
  POLL_MS,
  StepError,
  waitFor,
} from "./smokePage";

describe("itemSignature", () => {
  const read =
    (values: Record<string, string>) =>
    (name: string): string =>
      values[name] ?? "";

  it("names each item by its kind and the state transcripts are compared by", () => {
    expect(itemSignature("tool", read({ "tool-kind": "read", status: "completed" }))).toBe(
      "tool:read:completed",
    );
    expect(itemSignature("permission", read({ "resolved-by": "auto", decision: "allow" }))).toBe(
      "permission:auto:allow",
    );
    expect(itemSignature("permission", read({}))).toBe("permission:open");
    expect(itemSignature("question", read({ "resolved-by": "user", answer: "select:1" }))).toBe(
      "question:user:select:1",
    );
    expect(itemSignature("question", read({}))).toBe("question:open");
    expect(itemSignature("notice", read({ level: "warning" }))).toBe("notice:warning");
    expect(itemSignature("error", read({ "error-kind": "agent_exited" }))).toBe(
      "error:agent_exited",
    );
    expect(itemSignature("thought", read({ completed: "true" }))).toBe("thought");
    expect(itemSignature("thought", read({ completed: "false" }))).toBe("thought:open");
    expect(itemSignature("message", read({ completed: "false" }))).toBe("message");
    expect(itemSignature("user", read({}))).toBe("user");
  });
});

describe("describeSegment", () => {
  it("writes a turn, a running turn and what came between turns in one line each", () => {
    expect(
      describeSegment({
        kind: "turn",
        prompt: "/ask",
        stopReason: "end_turn",
        items: ["question:user:select:1", "message"],
        plan: [],
      }),
    ).toBe('turn "/ask" ended end_turn: question:user:select:1, message');
    expect(
      describeSegment({
        kind: "turn",
        prompt: "Tidy up",
        stopReason: "",
        items: ["thought:open"],
        plan: ["completed", "in_progress"],
      }),
    ).toBe('turn "Tidy up" running: thought:open; plan completed, in_progress');
    expect(
      describeSegment({ kind: "outside", prompt: "", stopReason: "", items: [], plan: [] }),
    ).toBe("between turns: nothing");
  });
});

describe("firstDifference", () => {
  it("says where two transcripts first differ, and what each side has there", () => {
    expect(firstDifference(["a", "b"], ["a", "b"])).toBeNull();
    expect(firstDifference(["a", "b", "c"], ["a", "x", "c"])).toBe(
      "segment 2 of 3: expected b, but the page shows x",
    );
    expect(firstDifference(["a", "b"], ["a"])).toBe(
      "segment 2 of 2: expected b, but the transcript ends before it",
    );
    expect(firstDifference(["a"], ["a", "extra"])).toBe(
      "segment 2 of 1: nothing expected, but the page shows extra",
    );
  });
});

/** A MutationObserver the test fires by hand: `mutate()` is the page changing. */
class FakeObserver {
  static live: FakeObserver[] = [];
  readonly #callback: () => void;

  constructor(callback: () => void) {
    this.#callback = callback;
  }

  observe(): void {
    FakeObserver.live.push(this);
  }

  disconnect(): void {
    FakeObserver.live = FakeObserver.live.filter((observer) => observer !== this);
  }

  static mutate(): void {
    for (const observer of [...FakeObserver.live]) observer.#callback();
  }
}

describe("waitFor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {});
    vi.stubGlobal("MutationObserver", FakeObserver);
    FakeObserver.live = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("answers at once when the page already shows what it waits for", async () => {
    await expect(waitFor("a value", () => 42)).resolves.toBe(42);
    expect(FakeObserver.live).toEqual([]);
  });

  it("wakes on a page change without waiting for a poll", async () => {
    let ready = false;
    const waiting = waitFor("the change", () => ready && "seen");
    ready = true;
    FakeObserver.mutate();
    await expect(waiting).resolves.toBe("seen");
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeObserver.live).toEqual([]);
  });

  /** Timers of a hidden page run at most once a second; the observer does not depend on them. */
  it("also polls, for changes the observer does not see", async () => {
    let polls = 0;
    const waiting = waitFor("three polls", () => {
      polls += 1;
      return polls >= 3;
    });
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    await expect(waiting).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends with the probe's error when the page can no longer turn out right", async () => {
    let broken = false;
    const waiting = waitFor("anything", () => {
      if (broken) throw new StepError("sending failed: queue full");
      return null;
    });
    broken = true;
    FakeObserver.mutate();
    await expect(waiting).rejects.toThrow("sending failed: queue full");
    expect(FakeObserver.live).toEqual([]);
  });

  it("times out naming what it waited for, asked at the timeout", async () => {
    let shown = "nothing";
    const waiting = waitFor(
      () => `the queue to empty (it shows ${shown})`,
      () => null,
      1500,
    );
    const outcome = expect(waiting).rejects.toThrow(
      'timed out after 1.5 s waiting for the queue to empty (it shows "/echo one" (held))',
    );
    shown = '"/echo one" (held)';
    await vi.advanceTimersByTimeAsync(1500);
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeObserver.live).toEqual([]);
  });
});
